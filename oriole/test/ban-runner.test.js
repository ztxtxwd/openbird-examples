import test from 'node:test';
import assert from 'node:assert/strict';
import { runBan } from '../src/ban-runner.js';

async function* emptyQuery() {
  yield { result: 'ignored' };
}

test('runBan stays silent when no side effects happen', async () => {
  const replies = [];
  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({
      queueKey: 'root-1',
      threadTranscript: '',
      recentRootSummary: '',
      availableTools: '',
      currentMessage: '',
    }),
    queryImpl: emptyQuery,
    createOpenBirdServer: () => ({ type: 'sdk', name: 'openbird', instance: {} }),
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.deepEqual(replies, []);
});

test('runBan writes fallback receipt when side effects happened without visible log', async () => {
  const replies = [];

  async function* queryImpl() {
    yield { result: 'done' };
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({
      queueKey: 'root-1',
      threadTranscript: '',
      recentRootSummary: '',
      availableTools: '',
      currentMessage: '',
    }),
    queryImpl,
    createOpenBirdServer: (_openbird, { onToolCall }) => {
      onToolCall({ name: 'pin_session', sideEffecting: true, result: { success: true } });
      return { type: 'sdk', name: 'openbird', instance: {} };
    },
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /pin_session/);
});

test('runBan fallback receipt distinguishes completed and failed side effects', async () => {
  const replies = [];

  async function* queryImpl() {
    yield { result: 'done' };
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({
      queueKey: 'root-1',
      threadTranscript: '',
      recentRootSummary: '',
      availableTools: '',
      currentMessage: '',
    }),
    queryImpl,
    createOpenBirdServer: (_openbird, { onToolCall }) => {
      onToolCall({ name: 'pin_session', sideEffecting: true, result: { success: true } });
      onToolCall({ name: 'archive_thread', sideEffecting: true, result: { success: false } });
      return { type: 'sdk', name: 'openbird', instance: {} };
    },
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /已完成/);
  assert.match(replies[0].text, /pin_session/);
  assert.match(replies[0].text, /失败/);
  assert.match(replies[0].text, /archive_thread/);
});

test('runBan includes currentMessage, threadTranscript, recentRootSummary, availableTools in prompt', async () => {
  let capturedPrompt = null;

  async function* queryImpl({ prompt }) {
    capturedPrompt = prompt;
    yield { result: 'done' };
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage() {} },
    openbird: { tools: [{ name: 'tool-a' }, { name: 'tool-b' }] },
    buildContext: async () => ({
      queueKey: 'root-1',
      currentMessage: 'CURRENT_MESSAGE_X',
      threadTranscript: 'THREAD_TRANSCRIPT_Y',
      recentRootSummary: 'RECENT_ROOT_SUMMARY_Z',
      availableTools: 'tool-a, tool-b',
    }),
    queryImpl,
    createOpenBirdServer: () => ({ type: 'sdk', name: 'openbird', instance: {} }),
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(typeof capturedPrompt, 'string');
  assert.match(capturedPrompt, /CURRENT_MESSAGE_X/);
  assert.match(capturedPrompt, /THREAD_TRANSCRIPT_Y/);
  assert.match(capturedPrompt, /RECENT_ROOT_SUMMARY_Z/);
  assert.match(capturedPrompt, /tool-a, tool-b/);
});

test('runBan does not write fallback receipt when visible log is already written', async () => {
  const replies = [];

  async function* queryImpl() {
    yield { result: 'done' };
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({
      queueKey: 'root-1',
      threadTranscript: '',
      recentRootSummary: '',
      availableTools: '',
      currentMessage: '',
    }),
    queryImpl,
    createOpenBirdServer: (_openbird, { onToolCall }) => {
      onToolCall({ name: 'pin_session', sideEffecting: true, result: { success: true } });
      return { type: 'sdk', name: 'openbird', instance: {} };
    },
    createWorkbenchServer: ({ state }) => {
      state.visibleLogWritten = true;
      return { type: 'sdk', name: 'workbench', instance: {}, state };
    },
  });

  assert.deepEqual(replies, []);
});

test('runBan replies "还没有办成" when failing before any side effects', async () => {
  const replies = [];

  async function* queryImpl() {
    throw new Error('boom');
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({
      queueKey: 'root-1',
      threadTranscript: '',
      recentRootSummary: '',
      availableTools: '',
      currentMessage: '',
    }),
    queryImpl,
    createOpenBirdServer: () => ({ type: 'sdk', name: 'openbird', instance: {} }),
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /还没有办成/);
  assert.match(replies[0].text, /boom/);
});

test('runBan replies "还没有办成" when initialization fails before any side effects', async () => {
  const replies = [];

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => {
      throw new Error('context explode');
    },
    queryImpl: emptyQuery,
    createOpenBirdServer: () => ({ type: 'sdk', name: 'openbird', instance: {} }),
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 'root-1');
  assert.match(replies[0].text, /还没有办成/);
  assert.match(replies[0].text, /context explode/);
});

test('runBan replies with completed actions and failure reason when failing after side effects', async () => {
  const replies = [];

  async function* queryImpl() {
    throw new Error('network down');
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({
      queueKey: 'root-1',
      threadTranscript: '',
      recentRootSummary: '',
      availableTools: '',
      currentMessage: '',
    }),
    queryImpl,
    createOpenBirdServer: (_openbird, { onToolCall }) => {
      onToolCall({ name: 'pin_session', sideEffecting: true, result: { success: true } });
      onToolCall({ name: 'archive_thread', sideEffecting: true, result: { success: true } });
      return { type: 'sdk', name: 'openbird', instance: {} };
    },
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /pin_session/);
  assert.match(replies[0].text, /archive_thread/);
  assert.match(replies[0].text, /network down/);
});
