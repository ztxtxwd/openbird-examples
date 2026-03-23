import { execSync } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Kill orphaned openbird processes left by previous node --watch restarts 
function killOrphanedOpenbird() {
  try {
    const output = execSync('pgrep -f "node.*openbird"', { encoding: 'utf8' });
    const pids = output.trim().split('\n').map(Number).filter(Boolean);
    for (const pid of pids) {
      if (pid !== process.pid) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
    }
    if (pids.length > 0) {
      console.log(`🧹 Killed ${pids.length} orphaned openbird process(es)`);
    }
  } catch {
    // pgrep returns non-zero when no matches — that's fine
  }
}

export async function createOpenBirdClient(webhookUrl) {
  killOrphanedOpenbird();

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/root/projects/openbird/main/bin/openbird.js'],
    env: { 
      ...process.env,
      OPENBIRD_COOKIE: process.env.OPENBIRD_COOKIE,
      OPENBIRD_WEBHOOK_URL: webhookUrl,
    },
    stderr: 'inherit',
  });

  const client = new Client({ name: 'oriole', version: '0.1.0' });
  // Ensure child process is killed when parent exits for any reason.
  // process.on('exit') is synchronous-only — transport.close() is async and won't
  // complete, so we kill the PID directly.
  process.on('exit', () => {
    const pid = transport.pid;
    if (pid) { try { process.kill(pid); } catch {} }
  });
    
  await client.connect(transport);

  const { tools } = await client.listTools();

  return {
    async callTool(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return parseToolResult(result);
    },
    async close() {
      await client.close();
    },
    tools,
  };
}

export function classifyOpenBirdTool(tool) {
  const annotations = tool?.annotations ?? {};
  return annotations.readOnlyHint !== true && annotations.readOnly !== true;
}

export async function callObservedOpenBirdTool({
  openbird,
  name,
  args = {},
  onToolCall = () => {},
}) {
  const tool = (openbird.tools ?? []).find((candidate) => candidate.name === name);
  const sideEffecting = classifyOpenBirdTool(tool);

  try {
    const result = await openbird.callTool(name, args);
    onToolCall({
      name,
      args,
      result,
      tool,
      sideEffecting,
    });
    return result;
  } catch (error) {
    onToolCall({
      name,
      args,
      result: {
        success: false,
        error: error?.message || String(error),
      },
      tool,
      sideEffecting,
    });
    throw error;
  }
}

export function createOpenBirdMcpServer(openbird, { onToolCall = () => {} } = {}) {
  const server = new McpServer(
    { name: 'openbird-adapter', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: openbird.tools ?? [],
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callObservedOpenBirdTool({
      openbird,
      name: request.params.name,
      args: request.params.arguments ?? {},
      onToolCall,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: result?.success === false,
    };
  });

  return { type: 'sdk', name: 'openbird', instance: server };
}

function parseToolResult(result) {
  const textParts = (result.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text);

  if (textParts.length === 0) {
    return result;
  }

  const text = textParts.join('\n');

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: `Tool returned non-JSON text: ${text}`,
    };
  }
}
