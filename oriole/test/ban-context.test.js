import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMarked } from 'zwsteg';

import { buildBanContext } from '../src/ban-context.js';

test('buildBanContext assembles current thread and restores hidden ids', async () => {
  const lark = {
    async listMessages() {
      return [
        {
          message_id: 'reply-1',
          parent_id: 'root-1',
          create_time: '200',
          body: { content: JSON.stringify({ text: '补充说明' }) },
        },
        {
          message_id: 'root-1',
          create_time: '100',
          body: {
            content: JSON.stringify({
              text: encodeMarked('用户{{u-1}}询问进度{{msg-1}}'),
            }),
          },
        },
      ];
    },
  };

  const context = await buildBanContext({
    event: {
      data: {
        message_id: 'root-1',
        body: {
          content: JSON.stringify({
            text: encodeMarked('用户{{u-1}}询问进度{{msg-1}}'),
          }),
        },
      },
    },
    workbench: { openChatId: 'open-chat-1' },
    lark,
    openbirdTools: [{ name: 'pin_session' }],
  });

  assert.equal(context.queueKey, 'root-1');
  assert.match(context.threadTranscript, /用户\{\{u-1\}\}询问进度\{\{msg-1\}\}/);
  assert.match(context.threadTranscript, /补充说明/);
  assert.match(context.recentRootSummary, /\[root-1\]/);
  assert.match(context.availableTools, /pin_session/);
  assert.match(context.currentMessage, /用户\{\{u-1\}\}询问进度\{\{msg-1\}\}/);
});

test('queueKey prefers thread_id when both thread_id and message_id exist', async () => {
  const lark = {
    async listMessages() {
      return [];
    },
  };

  const context = await buildBanContext({
    event: {
      data: {
        thread_id: 'thread-123',
        message_id: 'root-1',
        body: {
          content: JSON.stringify({ text: 'thread body' }),
        },
      },
    },
    workbench: { openChatId: 'open-chat-1' },
    lark,
    openbirdTools: [],
  });

  assert.equal(context.queueKey, 'thread-123');
});

test('buildBanContext fetches messages via listMessages with the expected chatId and pageSize', async () => {
  const calls = [];
  const lark = {
    async listMessages(chatId, options) {
      calls.push({ chatId, options });
      return [];
    },
  };

  await buildBanContext({
    event: {
      data: {
        message_id: 'root-1',
        body: { content: JSON.stringify({ text: 'check call' }) },
      },
    },
    workbench: { openChatId: 'open-chat-1' },
    lark,
    openbirdTools: [],
  });

  assert.deepEqual(calls, [
    { chatId: 'open-chat-1', options: { pageSize: 50 } },
  ]);
});

test('threadTranscript orders entries by ascending create_time', async () => {
  const lark = {
    async listMessages() {
      return [
        {
          message_id: 'reply-2',
          parent_id: 'root-1',
          create_time: '300',
          body: { content: JSON.stringify({ text: '后续' }) },
        },
        {
          message_id: 'root-1',
          create_time: '100',
          body: { content: JSON.stringify({ text: '根消息' }) },
        },
        {
          message_id: 'reply-1',
          parent_id: 'root-1',
          create_time: '200',
          body: { content: JSON.stringify({ text: '中间回复' }) },
        },
      ];
    },
  };

  const context = await buildBanContext({
    event: {
      data: {
        message_id: 'root-1',
        body: { content: JSON.stringify({ text: '事件消息' }) },
      },
    },
    workbench: { openChatId: 'open-chat-1' },
    lark,
    openbirdTools: [],
  });

  const lines = context.threadTranscript.split('\n').filter(Boolean);
  assert.equal(lines[0].startsWith('- [root-1]'), true);
  assert.equal(lines[1].startsWith('- [reply-1]'), true);
  assert.equal(lines[2].startsWith('- [reply-2]'), true);
});

test('recentRootSummary lists only root messages even when replies or unrelated roots exist', async () => {
  const lark = {
    async listMessages() {
      return [
        {
          message_id: 'reply-1',
          parent_id: 'root-1',
          create_time: '200',
          body: { content: JSON.stringify({ text: 'root-1 追加' }) },
        },
        {
          message_id: 'root-1',
          create_time: '100',
          body: { content: JSON.stringify({ text: '根-1' }) },
        },
        {
          message_id: 'reply-2',
          parent_id: 'root-2',
          create_time: '250',
          body: { content: JSON.stringify({ text: 'root-2 追加' }) },
        },
        {
          message_id: 'root-2',
          create_time: '50',
          body: { content: JSON.stringify({ text: '根-2' }) },
        },
      ];
    },
  };

  const context = await buildBanContext({
    event: {
      data: {
        message_id: 'root-1',
        body: { content: JSON.stringify({ text: '事件消息' }) },
      },
    },
    workbench: { openChatId: 'open-chat-1' },
    lark,
    openbirdTools: [],
  });

  assert.match(context.recentRootSummary, /root-1/);
  assert.match(context.recentRootSummary, /root-2/);
  assert.equal(context.recentRootSummary.includes('reply-1'), false);
  assert.equal(context.recentRootSummary.includes('reply-2'), false);
});
