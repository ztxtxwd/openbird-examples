import { createServer } from 'openbird-webhook-node';
import { handleSignal } from './lin.js';
import { decode } from 'zwsteg';

// 用于去重的事件 ID 集合
const processedEvents = new Set();
const inFlightEventIds = new Set();

export async function startWebhookServer(options = {}) {
  const { listen = true, host = '127.0.0.1' } = options ?? {};
  let workbench = null;
  let openbird = null;
  let lark = null;
  let ban = null;
  const pendingEvents = [];
  const pendingEventIds = new Set();
  let replayPromise = null;
  let replayRequested = false;
  let lin = {
    dispatch(event) {
      return handleSignal(event, workbench, openbird, lark);
    },
  };

  const receiver = createServer();

  function bufferEvent(event, reason) {
    if (event.event_id && pendingEventIds.has(event.event_id)) {
      console.log(`  ⏭️  Event already buffered: ${event.event_id}`);
      return;
    }

    if (event.event_id) {
      pendingEventIds.add(event.event_id);
    }

    pendingEvents.push(event);
    console.log(`  ⏸️  Buffering event: ${reason}`);
  }

  function canReplayBufferedEvents() {
    return Boolean(workbench && ban);
  }

  async function replayBufferedEvents() {
    if (!canReplayBufferedEvents() || pendingEvents.length === 0) {
      return;
    }

    if (replayPromise) {
      replayRequested = true;
      return replayPromise;
    }

    replayPromise = (async () => {
      do {
        replayRequested = false;
        const bufferedEvents = pendingEvents.splice(0);
        console.log(`  🔁 Replaying ${bufferedEvents.length} buffered event(s)`);

        for (const event of bufferedEvents) {
          if (event.event_id) {
            pendingEventIds.delete(event.event_id);
          }
          await onEvent(event);
        }
      } while (replayRequested && pendingEvents.length > 0);
    })();

    try {
      await replayPromise;
    } finally {
      replayPromise = null;
    }
  }

  async function onEvent(event) {
    if (event.event_id && (
      processedEvents.has(event.event_id)
      || inFlightEventIds.has(event.event_id)
      || pendingEventIds.has(event.event_id)
    )) {
      console.log(`⏭️  Skipping duplicate event: ${event.event_id}`);
      return;
    }

    if (event.event_id) {
      inFlightEventIds.add(event.event_id);
    }

    console.log(`📨 Received event: ${event.type}`);

    let handled = false;
    try {
      handled = await handleEvent(event);
      if (handled && event.event_id) {
        processedEvents.add(event.event_id);
      }
    } finally {
      if (event.event_id) {
        inFlightEventIds.delete(event.event_id);
      }
    }
  }

  receiver.on('*', onEvent);

  let port = 0;
  if (listen) {
    const server = await receiver.listen(0, host);
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 3000;
  }

  async function handleEvent(event) {

    const { data } = event;

    if (data.chat) {
      console.log(`  📍 Chat: ${data.chat.type} (${data.chat.id})`);
    }

    if (data.sender) {
      console.log(`  👤 Sender: ${data.sender.type} (${data.sender.id})`);
    }

    if (data.content) {
      console.log(`  💬 Content: ${data.content.type}`);
      if (data.content.type === 'text') {
        console.log(`  📝 Text: ${decode(data.content.text).text}`);
      }
    }

    if (data.thread_id) {
      console.log(`  🧵 Thread: ${data.thread_id}`);
    }

    if (!workbench) {
      console.log('  ⏭️  Workbench not ready yet');
      bufferEvent(event, 'Workbench not ready yet');
      return false;
    }

    const chatId = data.chat?.id || data.chat_id;
    const isWorkbenchChat = chatId === workbench.chatId || chatId === workbench.openChatId;
    // 路由：工作台消息 → Ban，外部消息 → Lin
    if (isWorkbenchChat) {
      console.log('  🔀 → Ban（办）');
      if (!ban) {
        console.log('  ⏭️  Ban not ready yet');
        bufferEvent(event, 'Ban not ready yet');
        return false;
      }

      await ban.dispatch(event);
      return true;

    } else {
      // 忽略工作台外 Bot 自己发的消息
      if (data.sender?.type === 'bot') {
        console.log('  ⏭️  Ignoring bot message');
        return true;
      }

      console.log('  🔀 → Lin（拎）');
      await lin.dispatch(event);
      return true;
    }
  }

  return {
    port,
    url: `http://${host}:${port}/`,
    setWorkbench(nextWorkbench) {
      workbench = nextWorkbench;
      return replayBufferedEvents();
    },
    setOpenbird(nextOpenbird) {
      openbird = nextOpenbird;
    },
    setLark(nextLark) {
      lark = nextLark;
    },
    setBan(nextBan) {
      ban = nextBan;
      return replayBufferedEvents();
    },
    setLin(nextLin) {
      lin = nextLin;
    },
    __testHandleEvent(event) {
      return onEvent(event);
    },
    close() {
      return receiver.close();
    },
  };
}
