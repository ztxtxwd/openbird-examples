import { execSync } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

const REQUIRED_TOOLS = [
  'create_group',
  'patch_group_chat',
  'pin_session',
];

export async function createOpenBirdClient(webhookUrl) {
  killOrphanedOpenbird();

  const transport = new StdioClientTransport({
    command: 'pnpx',
    args: ['openbird@latest'],
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
  const toolNames = new Set(tools.map((tool) => tool.name));

  for (const toolName of REQUIRED_TOOLS) {
    if (!toolNames.has(toolName)) {
      throw new Error(`OpenBird MCP tool is not available: ${toolName}`);
    }
  }

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
