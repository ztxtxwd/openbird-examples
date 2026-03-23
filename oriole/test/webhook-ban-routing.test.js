import test from 'node:test';
import assert from 'node:assert/strict';
import { startWebhookServer } from '../src/webhook.js';
import { createBan } from '../src/ban.js';

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
