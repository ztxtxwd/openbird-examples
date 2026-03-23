#!/usr/bin/env node

/**
 * OpenBird Basic Usage Example
 *
 * This example demonstrates the two integration surfaces OpenBird provides:
 *
 *   1. Webhook server  — receives real-time Feishu messages via HTTP POST
 *   2. MCP client      — calls Feishu API tools (send message, search, etc.)
 *
 * ── Quick start ──────────────────────────────────────────────────────
 *
 *   # 1. Copy .env.example and fill in your cookie
 *   cp .env.example .env
 *   # edit .env → set OPENBIRD_COOKIE
 *
 *   # 2. Run
 *   npm start
 *
 * ─────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'openbird-webhook-node';

// ── 0. Preflight check ──────────────────────────────────────────────

if (!process.env.OPENBIRD_COOKIE) {
  console.error('Error: OPENBIRD_COOKIE is not set.');
  console.error('Copy .env.example to .env and paste your Feishu cookie.');
  process.exit(1);
}

// ── 1. Start webhook receiver (openbird-webhook-node) ───────────────

const receiver = createServer();

receiver.on('im.message.receive_v1', (event) => {
  const { data } = event;
  const sender = data.sender?.id ?? '?';
  const chat = data.chat?.id ?? '?';
  const chatType = data.chat?.type ?? '?';
  const contentType = data.content?.type ?? '?';
  const text = data.content?.text ?? '';
  const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;

  console.log(
    `[message] ${chatType} | chat=${chat} | from=${sender} | ${contentType}: ${preview}`
  );
});

receiver.on('im.message.reaction_v1', (event) => {
  const reactions = event.data.messageReactions || [];
  for (const mr of reactions) {
    const types = mr.reactions?.map(r => `${r.type}(${r.count})`).join(', ') || '';
    console.log(`[reaction] msg=${mr.messageId} | ${types}`);
  }
});

receiver.on('im.*', (event) => {
  // Skip events already handled above
  if (event.type === 'im.message.receive_v1' || event.type === 'im.message.reaction_v1') return;
  console.log(`[event] ${event.type}`, JSON.stringify(event.data).slice(0, 120));
});

receiver.on('feed.*', (event) => {
  console.log(`[event] ${event.type}`, JSON.stringify(event.data).slice(0, 120));
});

receiver.on('calendar.*', (event) => {
  console.log(`[event] ${event.type}`, JSON.stringify(event.data).slice(0, 120));
});

receiver.on('system.*', (event) => {
  console.log(`[event] ${event.type}`, JSON.stringify(event.data).slice(0, 120));
});

// Listen on a random free port
const httpServer = await receiver.listen(0, '127.0.0.1');
const webhookPort = httpServer.address().port;
const webhookUrl = `http://127.0.0.1:${webhookPort}/`;

// ── 2. Spawn OpenBird & connect MCP client ──────────────────────────

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['openbird@latest','-y'],
  env: {
    ...process.env,
    OPENBIRD_COOKIE: process.env.OPENBIRD_COOKIE,
    OPENBIRD_WEBHOOK_URL: webhookUrl,
  },
  stderr: 'inherit',  // OpenBird logs go to our stderr
});

const client = new Client({ name: 'example-client', version: '1.0.0' });
// Ensure child process is killed when parent exits for any reason
process.on('exit', () => {
  try { transport.close(); } catch {}
});
await client.connect(transport);
console.log('[example] MCP client connected to OpenBird');

// ── 3. List available tools ─────────────────────────────────────────

const { tools } = await client.listTools();
console.log(`[example] ${tools.length} tools available:`);
for (const tool of tools) {
  console.log(`  - ${tool.name}: ${tool.description}`);
}

// ── 4. Demo: call a tool ────────────────────────────────────────────

console.log('\n[example] Calling get_calendar_events ...');
try {
  const result = await client.callTool({ name: 'get_calendar_events', arguments: {} });
  console.log('[example] Result:', JSON.stringify(result.content, null, 2));
} catch (err) {
  console.error('[example] Tool call failed:', err.message);
}

// ── 5. Wait for incoming messages ───────────────────────────────────

console.log('\n[example] Listening for incoming Feishu messages (Ctrl+C to quit) ...\n');

process.on('SIGINT', async () => {
  console.log('\n[example] Shutting down ...');
  await client.close();
  await receiver.close();
  process.exit(0);
});
