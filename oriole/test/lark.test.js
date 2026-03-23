import test from 'node:test';
import assert from 'node:assert/strict';

import { createLarkClient } from '../src/lark.js';

test('listMessages aggregates iterator pages and forwards startTime', async () => {
  const calls = [];
  const fakeClient = {
    im: {
      v1: {
        message: {
          async listWithIterator(payload) {
            calls.push(payload);
            return {
              async *[Symbol.asyncIterator]() {
                yield {
                  items: [
                    { message_id: 'm1', create_time: '300' },
                    { message_id: 'm2', create_time: '200' },
                  ],
                };
                yield {
                  items: [
                    { message_id: 'm3', create_time: '100' },
                  ],
                };
              },
            };
          },
        },
      },
    },
  };

  const lark = createLarkClient(
    { appId: 'app-id', appSecret: 'app-secret' },
    { client: fakeClient },
  );

  const messages = await lark.listMessages('open-chat-1', {
    pageSize: 2,
    startTime: '1608594809',
  });

  assert.deepEqual(messages, [
    { message_id: 'm1', create_time: '300' },
    { message_id: 'm2', create_time: '200' },
    { message_id: 'm3', create_time: '100' },
  ]);

  assert.deepEqual(calls, [
    {
      params: {
        container_id_type: 'chat',
        container_id: 'open-chat-1',
        sort_type: 'ByCreateTimeDesc',
        page_size: 2,
        start_time: '1608594809',
      },
    },
  ]);
});
