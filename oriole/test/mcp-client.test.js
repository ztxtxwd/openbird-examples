import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenBirdTool,
  callObservedOpenBirdTool,
  createOpenBirdMcpServer,
} from '../src/mcp-client.js';

function getRegisteredRequestHandler(mcpServer, method) {
  // The SDK stores registered handlers on the underlying Protocol implementation.
  // This lets us unit test without standing up a transport.
  const handler = mcpServer?.server?._requestHandlers?.get(method);
  assert.equal(typeof handler, 'function', `Missing request handler for ${method}`);
  return handler;
}

test('classifyOpenBirdTool treats readOnly annotations as non-side-effecting', () => {
  assert.equal(
    classifyOpenBirdTool({ name: 'get_user', annotations: { readOnly: true } }),
    false,
  );
  assert.equal(classifyOpenBirdTool({ name: 'pin_session' }), true);
});

test('callObservedOpenBirdTool forwards calls and reports side effects', async () => {
  const seen = [];
  const openbird = {
    tools: [{ name: 'pin_session' }],
    async callTool(name, args) {
      seen.push({ name, args });
      return { success: true, data: { pinned: true } };
    },
  };

  const observed = [];
  const result = await callObservedOpenBirdTool({
    openbird,
    name: 'pin_session',
    args: { chatId: 'chat-1' },
    onToolCall: (entry) => observed.push(entry),
  });

  assert.deepEqual(seen, [{ name: 'pin_session', args: { chatId: 'chat-1' } }]);
  assert.equal(result.success, true);
  assert.equal(observed[0].sideEffecting, true);
});

test('createOpenBirdMcpServer list-tools exposes all openbird.tools with metadata', async () => {
  const openbird = {
    tools: [
      {
        name: 'get_user',
        description: 'Get a user',
        inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
        annotations: { readOnly: true },
      },
      {
        name: 'pin_session',
        description: 'Pin a chat session',
        inputSchema: { type: 'object', properties: { chatId: { type: 'string' } } },
        annotations: { readOnly: false },
      },
    ],
    async callTool() {
      throw new Error('unexpected');
    },
  };

  const adapter = createOpenBirdMcpServer(openbird);
  assert.equal(adapter.type, 'sdk');
  assert.equal(adapter.name, 'openbird');

  const listTools = getRegisteredRequestHandler(adapter.instance, 'tools/list');
  const result = await listTools({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {});

  assert.equal(Array.isArray(result.tools), true);
  assert.equal(result.tools.length, 2);
  assert.deepEqual(result.tools, [
    {
      name: 'get_user',
      description: 'Get a user',
      inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
      annotations: { readOnly: true },
    },
    {
      name: 'pin_session',
      description: 'Pin a chat session',
      inputSchema: { type: 'object', properties: { chatId: { type: 'string' } } },
      annotations: { readOnly: false },
    },
  ]);
});

test('createOpenBirdMcpServer call-tool forwards, wraps JSON text, and records sideEffecting', async () => {
  const seen = [];
  const openbird = {
    tools: [
      { name: 'get_user', annotations: { readOnly: true } },
      { name: 'pin_session', annotations: { readOnly: false } },
    ],
    async callTool(name, args) {
      seen.push({ name, args });
      return { success: true, data: { name, args } };
    },
  };

  const observed = [];
  const adapter = createOpenBirdMcpServer(openbird, {
    onToolCall: (entry) => observed.push(entry),
  });

  const callTool = getRegisteredRequestHandler(adapter.instance, 'tools/call');
  const result = await callTool(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_user', arguments: { userId: 'u-1' } },
    },
    {},
  );

  assert.deepEqual(seen, [{ name: 'get_user', args: { userId: 'u-1' } }]);
  assert.equal(result.isError, false);
  assert.equal(result.content?.[0]?.type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), { success: true, data: { name: 'get_user', args: { userId: 'u-1' } } });

  assert.equal(observed.length, 1);
  assert.equal(observed[0].name, 'get_user');
  assert.deepEqual(observed[0].args, { userId: 'u-1' });
  assert.equal(observed[0].sideEffecting, false);
});

test('createOpenBirdMcpServer call-tool marks isError when tool success === false', async () => {
  const openbird = {
    tools: [{ name: 'pin_session', annotations: { readOnly: false } }],
    async callTool() {
      return { success: false, error: 'nope' };
    },
  };

  const adapter = createOpenBirdMcpServer(openbird);
  const callTool = getRegisteredRequestHandler(adapter.instance, 'tools/call');
  const result = await callTool(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'pin_session', arguments: { chatId: 'chat-1' } },
    },
    {},
  );

  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { success: false, error: 'nope' });
});

