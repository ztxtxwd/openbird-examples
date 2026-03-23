import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatterHandler, getDefaultThreadsStartTime } from '../src/lin.js';

test('createMatterHandler only sends the matter message and leaves thread creation to the first reply', async () => {
  const calls = [];
  const content = '外部工单{{ticket-1}}需要跟进';

  const lark = {
    async sendMessage(chatId, text) {
      calls.push({ type: 'sendMessage', chatId, text });
      return { message_id: 'om_root_1' };
    },

    async editMessage(messageId, text) {
      calls.push({ type: 'editMessage', messageId, text });
      return { message_id: messageId };
    },
  };

  const openbird = {
    async callTool(name, args) {
      calls.push({ type: 'openbird', name, args });
      return { success: true };
    },
  };

  const handler = createMatterHandler({
    workbench: { openChatId: 'open-chat-1' },
    openbird,
    lark,
  });

  const result = await handler({ content });

  assert.equal(result.content[0].text, `已创建事儿: ${content}`);
  assert.deepEqual(calls.map(({ type, name }) => name ?? type), [
    'sendMessage',
  ]);
  assert.equal(calls[0].chatId, 'open-chat-1');
  assert.equal(typeof calls[0].text, 'string');
  assert.equal(calls[0].text.includes('ticket-1'), false);
});

test('getDefaultThreadsStartTime returns the unix timestamp for one hour ago', () => {
  const now = 1_708_000_000_000;

  assert.equal(getDefaultThreadsStartTime(now), '1707996400');
});
