import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  classifyOpenBirdTool,
  callObservedOpenBirdTool,
  createOpenBirdMcpServer,
} from '../src/mcp-client.js';

async function withConnectedOpenBirdAdapter({ openbird, onToolCall = () => {} }, run) {
  const adapter = createOpenBirdMcpServer(openbird, { onToolCall });
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    adapter.instance.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    return await run({ adapter, client });
  } finally {
    await Promise.all([
      client.close(),
      adapter.instance.close(),
    ]);
  }
}

test('classifyOpenBirdTool treats readOnlyHint annotations as non-side-effecting', () => {
  assert.equal(
    classifyOpenBirdTool({ name: 'get_user', annotations: { readOnlyHint: true } }),
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
  assert.equal(observed.length, 1);
  assert.equal(observed[0].sideEffecting, true);
});

test('callObservedOpenBirdTool records throwing tool calls before rethrowing', async () => {
  const openbird = {
    tools: [{ name: 'pin_session', annotations: { readOnlyHint: false } }],
    async callTool() {
      throw new Error('tool blew up');
    },
  };

  const observed = [];
  await assert.rejects(
    callObservedOpenBirdTool({
      openbird,
      name: 'pin_session',
      args: { chatId: 'chat-1' },
      onToolCall: (entry) => observed.push(entry),
    }),
    /tool blew up/,
  );

  assert.equal(observed.length, 1);
  assert.equal(observed[0].name, 'pin_session');
  assert.equal(observed[0].sideEffecting, true);
  assert.deepEqual(observed[0].result, {
    success: false,
    error: 'tool blew up',
  });
});

test('createOpenBirdMcpServer list-tools exposes the full openbird tool catalog', async () => {
  const openbird = {
    tools: [
      {
        name: 'get_user',
        description: 'Get a user',
        inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        annotations: { readOnlyHint: true },
        _meta: { source: 'openbird' },
      },
      {
        name: 'pin_session',
        description: 'Pin a chat session',
        inputSchema: { type: 'object', properties: { chatId: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
        annotations: { readOnlyHint: false },
        _meta: { source: 'openbird' },
      },
    ],
    async callTool() {
      throw new Error('unexpected');
    },
  };

  await withConnectedOpenBirdAdapter({ openbird }, async ({ adapter, client }) => {
    assert.equal(adapter.type, 'sdk');
    assert.equal(adapter.name, 'openbird');

    const result = await client.listTools();
    assert.deepEqual(result, { tools: openbird.tools });
  });
});

test('createOpenBirdMcpServer call-tool forwards, wraps JSON text, and records sideEffecting', async () => {
  const seen = [];
  const openbird = {
    tools: [
      { name: 'get_user', annotations: { readOnlyHint: true } },
      { name: 'pin_session', annotations: { readOnlyHint: false } },
    ],
    async callTool(name, args) {
      seen.push({ name, args });
      return { success: true, data: { name, args } };
    },
  };

  const observed = [];
  await withConnectedOpenBirdAdapter(
    {
      openbird,
      onToolCall: (entry) => observed.push(entry),
    },
    async ({ client }) => {
      const result = await client.callTool({
        name: 'get_user',
        arguments: { userId: 'u-1' },
      });

      assert.deepEqual(seen, [{ name: 'get_user', args: { userId: 'u-1' } }]);
      assert.equal(result.isError, false);
      assert.equal(result.content?.[0]?.type, 'text');
      assert.deepEqual(
        JSON.parse(result.content[0].text),
        { success: true, data: { name: 'get_user', args: { userId: 'u-1' } } },
      );

      assert.equal(observed.length, 1);
      assert.equal(observed[0].name, 'get_user');
      assert.deepEqual(observed[0].args, { userId: 'u-1' });
      assert.equal(observed[0].sideEffecting, false);
    },
  );
});

test('createOpenBirdMcpServer call-tool marks isError when tool success === false', async () => {
  const openbird = {
    tools: [{ name: 'pin_session', annotations: { readOnlyHint: false } }],
    async callTool() {
      return { success: false, error: 'nope' };
    },
  };

  await withConnectedOpenBirdAdapter({ openbird }, async ({ client }) => {
    const result = await client.callTool({
      name: 'pin_session',
      arguments: { chatId: 'chat-1' },
    });

    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { success: false, error: 'nope' });
  });
});
