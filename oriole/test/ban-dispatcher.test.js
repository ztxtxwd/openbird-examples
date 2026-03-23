import test from 'node:test';
import assert from 'node:assert/strict';
import { createBanDispatcher, getBanQueueKey } from '../src/ban-dispatcher.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('getBanQueueKey prefers thread_id and falls back to message_id', () => {
  assert.equal(getBanQueueKey({ data: { thread_id: 'th-1', message_id: 'm-1' } }), 'th-1');
  assert.equal(getBanQueueKey({ data: { message_id: 'm-2' } }), 'm-2');
});

test('dispatch serializes events with the same queue key', async () => {
  const blocker = createDeferred();
  const order = [];
  const dispatcher = createBanDispatcher({
    run: async ({ queueKey }) => {
      order.push(`start:${queueKey}:${order.length}`);
      if (order.length === 1) {
        await blocker.promise;
      }
      order.push(`end:${queueKey}:${order.length}`);
    },
  });

  const first = dispatcher.dispatch({ data: { thread_id: 'th-1' } });
  const second = dispatcher.dispatch({ data: { thread_id: 'th-1' } });

  await Promise.resolve();
  assert.deepEqual(order, ['start:th-1:0']);

  blocker.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    'start:th-1:0',
    'end:th-1:1',
    'start:th-1:2',
    'end:th-1:3',
  ]);
});
