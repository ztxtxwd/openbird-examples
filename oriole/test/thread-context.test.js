import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMarked } from 'zwsteg';

import { fetchThreadsContext } from '../src/thread-context.js';

test('fetches root matters from Lark history via openChatId without fetching thread details', async () => {
  const calls = [];
  const lark = {
    async listMessages(chatId, options) {
      calls.push({ chatId, options });
      return [
        {
          message_id: 'reply-msg-1',
          parent_id: 'root-msg-1',
          body: {
            content: JSON.stringify({ text: '补充说明' }),
          },
          create_time: '200',
        },
        {
          message_id: 'root-msg-1',
          body: {
            content: JSON.stringify({ text: '赵天雄问：明天几点出发' }),
          },
          create_time: '100',
        },
      ];
    },
  };

  const context = await fetchThreadsContext({ openChatId: 'open-chat-1' }, lark);

  assert.match(context, /\[root-msg-1\] 赵天雄问：明天几点出发/);
  assert.equal(context.includes('reply-msg-1'), false);
  assert.deepEqual(calls, [
    {
      chatId: 'open-chat-1',
      options: { pageSize: 50 },
    },
  ]);
});

test('restores hidden ids from Lark history messages back into {{}} markers', async () => {
  const lark = {
    async listMessages() {
      return [
        {
          message_id: 'root-msg-1',
          body: {
            content: JSON.stringify({
              text: encodeMarked('用户{{u1}}询问明天几点出发{{om_root_1}}'),
            }),
          },
          create_time: '100',
        },
      ];
    },
  };

  const context = await fetchThreadsContext({ openChatId: 'open-chat-1' }, lark);

  assert.match(context, /\[root-msg-1\] 用户\{\{u1\}\}询问明天几点出发\{\{om_root_1\}\}/);
});
