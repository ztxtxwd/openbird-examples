import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBanWorkbenchHandlers,
  createBanWorkbenchServer,
} from '../src/ban-workbench-tools.js';

test('replyInCurrentThread writes a thread reply and marks visible logging', async () => {
  const calls = [];
  const state = { visibleLogWritten: false, lastStatusMessageId: null };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async replyMessage(messageId, text) {
        calls.push({ type: 'reply', messageId, text });
        return { message_id: 'reply-1' };
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  await handlers.replyInCurrentThread({ content: '已执行 pin_session' });

  assert.deepEqual(calls, [{ type: 'reply', messageId: 'root-1', text: '已执行 pin_session' }]);
  assert.equal(state.visibleLogWritten, true);
  assert.equal(state.lastStatusMessageId, 'reply-1');
});

test('postTopLevelMessage writes into the open chat and updates state', async () => {
  const calls = [];
  const state = { visibleLogWritten: false, lastStatusMessageId: null };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async sendMessage(chatId, text) {
        calls.push({ type: 'send', chatId, text });
        return { message_id: 'send-1' };
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  await handlers.postTopLevelMessage({ content: '顶层内容' });

  assert.deepEqual(calls, [{ type: 'send', chatId: 'open-chat-1', text: '顶层内容' }]);
  assert.equal(state.visibleLogWritten, true);
  assert.equal(state.lastStatusMessageId, 'send-1');
});

test('editStatusMessage edits saved status message and records visible log', async () => {
  const calls = [];
  const state = { visibleLogWritten: false, lastStatusMessageId: 'status-1' };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async editMessage(messageId, text) {
        calls.push({ messageId, text });
        return { message_id: messageId };
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  const result = await handlers.editStatusMessage({ content: '更新状态' });

  assert.deepEqual(calls, [{ messageId: 'status-1', text: '更新状态' }]);
  assert.equal(state.visibleLogWritten, true);
  assert.equal(state.lastStatusMessageId, 'status-1');
  assert.equal(result.message_id, 'status-1');
});

test('editStatusMessage throws when no tracked status message exists', async () => {
  const state = { visibleLogWritten: false, lastStatusMessageId: null };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async editMessage() {
        throw new Error('should not be called');
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  await assert.rejects(
    handlers.editStatusMessage({ content: '无法执行' }),
    { message: 'No Ban-owned status message is available to edit' },
  );

  assert.equal(state.visibleLogWritten, false);
});

test('createBanWorkbenchServer exposes three tools and delegates reply handler', async () => {
  const calls = [];
  const state = { visibleLogWritten: false, lastStatusMessageId: null };
  const server = createBanWorkbenchServer({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async replyMessage(messageId, text) {
        calls.push({ type: 'reply', messageId, text });
        return { message_id: 'reply-tool-1' };
      },
      async sendMessage() {
        throw new Error('should not be called');
      },
      async editMessage() {
        throw new Error('should not be called');
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  assert.equal(server.type, 'sdk');
  assert.equal(server.name, 'ban-workbench');
  assert.deepEqual(
    Object.keys(server.instance._registeredTools).sort(),
    ['edit_status_message', 'post_top_level_message', 'reply_in_current_thread'],
  );

  const result = await server.instance._registeredTools.reply_in_current_thread.handler({
    content: '来自 tool 的回复',
  });

  assert.deepEqual(calls, [{ type: 'reply', messageId: 'root-1', text: '来自 tool 的回复' }]);
  assert.deepEqual(result, {
    content: [{ type: 'text', text: JSON.stringify({ message_id: 'reply-tool-1' }) }],
  });
  assert.equal(state.visibleLogWritten, true);
  assert.equal(state.lastStatusMessageId, 'reply-tool-1');
});

test('editStatusMessage targets the latest visible Ban message under Task 3 contract', async () => {
  const calls = [];
  const state = { visibleLogWritten: false, lastStatusMessageId: null };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async sendMessage(chatId, text) {
        calls.push({ type: 'send', chatId, text });
        return { message_id: 'send-1' };
      },
      async replyMessage(messageId, text) {
        calls.push({ type: 'reply', messageId, text });
        return { message_id: 'reply-1' };
      },
      async editMessage(messageId, text) {
        calls.push({ type: 'edit', messageId, text });
        return { message_id: messageId };
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  await handlers.postTopLevelMessage({ content: '顶层状态' });
  await handlers.replyInCurrentThread({ content: '线程内更新' });
  await handlers.editStatusMessage({ content: '编辑最近可见消息' });

  assert.deepEqual(calls, [
    { type: 'send', chatId: 'open-chat-1', text: '顶层状态' },
    { type: 'reply', messageId: 'root-1', text: '线程内更新' },
    { type: 'edit', messageId: 'reply-1', text: '编辑最近可见消息' },
  ]);
  assert.equal(state.visibleLogWritten, true);
  assert.equal(state.lastStatusMessageId, 'reply-1');
});

test('replyInCurrentThread keeps state untouched when the Lark call fails', async () => {
  const state = { visibleLogWritten: false, lastStatusMessageId: 'status-1' };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async replyMessage() {
        throw new Error('reply failed');
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  await assert.rejects(
    handlers.replyInCurrentThread({ content: '不会成功' }),
    { message: 'reply failed' },
  );

  assert.equal(state.visibleLogWritten, false);
  assert.equal(state.lastStatusMessageId, 'status-1');
});
