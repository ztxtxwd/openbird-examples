import test from 'node:test';
import assert from 'node:assert/strict';
import { startWebhookServer } from '../src/webhook.js';
import { createBan } from '../src/ban.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test('startWebhookServer() returns an object that supports setBan() injection', async () => {
  const webhook = await startWebhookServer({ listen: false });
  try {
    assert.equal(typeof webhook.setBan, 'function');
  } finally {
    await webhook.close();
  }
});

test('workbench bot messages are routed to Ban instead of being dropped', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setBan({
      async dispatch(event) {
        seen.push(event.data.message_id);
      },
    });

    await webhook.__testHandleEvent({
      type: 'message.receive_v1',
      data: {
        chat: { id: 'workbench-chat', type: 'p2p' },
        sender: { type: 'bot', id: 'bot-1' },
        message_id: 'msg-1',
      },
    });

    assert.deepEqual(seen, ['msg-1']);
  } finally {
    await webhook.close();
  }
});

test('workbench human messages are routed to Ban', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setBan({
      async dispatch(event) {
        seen.push(event.data.message_id);
      },
    });

    await webhook.__testHandleEvent({
      type: 'message.receive_v1',
      data: {
        chat: { id: 'workbench-chat', type: 'p2p' },
        sender: { type: 'user', id: 'user-1' },
        message_id: 'msg-2',
      },
    });

    assert.deepEqual(seen, ['msg-2']);
  } finally {
    await webhook.close();
  }
});

test('workbench messages routed by openChatId also reach Ban', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setBan({
      async dispatch(event) {
        seen.push(event.data.message_id);
      },
    });
    webhook.setLin({
      async dispatch() {
        throw new Error('should not route to Lin');
      },
    });

    await webhook.__testHandleEvent({
      type: 'message.receive_v1',
      data: {
        chat: { id: 'open-chat-1', type: 'p2p' },
        sender: { type: 'user', id: 'user-2' },
        message_id: 'msg-open-1',
      },
    });

    assert.deepEqual(seen, ['msg-open-1']);
  } finally {
    await webhook.close();
  }
});

test('workbench bot messages routed by openChatId also reach Ban', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setBan({
      async dispatch(event) {
        seen.push(event.data.message_id);
      },
    });

    await webhook.__testHandleEvent({
      type: 'message.receive_v1',
      data: {
        chat: { id: 'open-chat-1', type: 'p2p' },
        sender: { type: 'bot', id: 'bot-2' },
        message_id: 'msg-open-bot-1',
      },
    });

    assert.deepEqual(seen, ['msg-open-bot-1']);
  } finally {
    await webhook.close();
  }
});

test('workbench event_id is not consumed before Ban is ready', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];
  const event = {
    event_id: 'evt-workbench-1',
    type: 'message.receive_v1',
    data: {
      chat: { id: 'workbench-chat', type: 'p2p' },
      sender: { type: 'user', id: 'user-3' },
      message_id: 'msg-ready-1',
    },
  };

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });

    await webhook.__testHandleEvent(event);

    webhook.setBan({
      async dispatch(nextEvent) {
        seen.push(nextEvent.data.message_id);
      },
    });

    await webhook.__testHandleEvent(event);

    assert.deepEqual(seen, ['msg-ready-1']);
  } finally {
    await webhook.close();
  }
});

test('workbench messages received before Ban is ready are replayed after setBan()', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];
  const event = {
    event_id: 'evt-workbench-buffered-1',
    type: 'message.receive_v1',
    data: {
      chat: { id: 'workbench-chat', type: 'p2p' },
      sender: { type: 'user', id: 'user-buffered-1' },
      message_id: 'msg-buffered-1',
    },
  };

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });

    await webhook.__testHandleEvent(event);
    assert.deepEqual(seen, []);

    await webhook.setBan({
      async dispatch(nextEvent) {
        seen.push(nextEvent.data.message_id);
      },
    });

    assert.deepEqual(seen, ['msg-buffered-1']);
  } finally {
    await webhook.close();
  }
});

test('buffered events wait until Ban is ready before replay begins', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];
  const event = {
    event_id: 'evt-buffered-before-workbench-1',
    type: 'message.receive_v1',
    data: {
      chat: { id: 'outside-chat', type: 'p2p' },
      sender: { type: 'user', id: 'user-outside-1' },
      message_id: 'msg-outside-1',
    },
  };

  try {
    webhook.setLin({
      async dispatch(nextEvent) {
        seen.push(nextEvent.data.message_id);
      },
    });

    await webhook.__testHandleEvent(event);
    assert.deepEqual(seen, []);

    await webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    assert.deepEqual(seen, []);

    await webhook.setBan({
      async dispatch() {
        throw new Error('should not route outside messages to Ban');
      },
    });

    assert.deepEqual(seen, ['msg-outside-1']);
  } finally {
    await webhook.close();
  }
});

test('concurrent duplicate event_id is dispatched only once', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const blocker = createDeferred();
  const seen = [];
  const event = {
    event_id: 'evt-workbench-2',
    type: 'message.receive_v1',
    data: {
      chat: { id: 'workbench-chat', type: 'p2p' },
      sender: { type: 'user', id: 'user-4' },
      message_id: 'msg-ready-2',
    },
  };

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setBan({
      async dispatch(nextEvent) {
        seen.push(nextEvent.data.message_id);
        await blocker.promise;
      },
    });

    const first = webhook.__testHandleEvent(event);
    await Promise.resolve();
    const second = webhook.__testHandleEvent(event);
    await Promise.resolve();

    assert.deepEqual(seen, ['msg-ready-2']);

    blocker.resolve();
    await Promise.all([first, second]);

    assert.deepEqual(seen, ['msg-ready-2']);
  } finally {
    await webhook.close();
  }
});

test('non-workbench bot messages are ignored (do not reach Lin)', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setLin({
      async dispatch(event) {
        seen.push(event.data.message_id);
      },
    });

    await webhook.__testHandleEvent({
      type: 'message.receive_v1',
      data: {
        chat: { id: 'other-chat', type: 'p2p' },
        sender: { type: 'bot', id: 'bot-1' },
        message_id: 'msg-3',
      },
    });

    assert.deepEqual(seen, []);
  } finally {
    await webhook.close();
  }
});

test('non-workbench human messages are routed to Lin', async () => {
  const webhook = await startWebhookServer({ listen: false });
  const seen = [];

  try {
    webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
    webhook.setLin({
      async dispatch(event) {
        seen.push(event.data.message_id);
      },
    });

    await webhook.__testHandleEvent({
      type: 'message.receive_v1',
      data: {
        chat: { id: 'other-chat', type: 'p2p' },
        sender: { type: 'user', id: 'user-1' },
        message_id: 'msg-4',
      },
    });

    assert.deepEqual(seen, ['msg-4']);
  } finally {
    await webhook.close();
  }
});

test('createBan() returns an object with dispatch(event)', async () => {
  const ban = createBan({});
  assert.equal(typeof ban.dispatch, 'function');
});

test('createBan().dispatch() rejects when event has no thread_id/message_id', async () => {
  const ban = createBan({});
  await assert.rejects(() => ban.dispatch({ type: 'noop', data: {} }), /thread_id or message_id/i);
});
