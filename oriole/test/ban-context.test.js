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
