import { createServer } from 'openbird-webhook-node';
import { handleSignal } from './lin.js';
import { decode } from 'zwsteg';

// 用于去重的事件 ID 集合
const processedEvents = new Set();

export async function startWebhookServer(options = {}) {
  const { listen = true, host = '127.0.0.1' } = options ?? {};
  let workbench = null;
  let openbird = null;
  let lark = null;
  let ban = null;
  let lin = {
    dispatch(event) {
      return handleSignal(event, workbench, openbird, lark);
    },
  };

  const receiver = createServer();

  async function onEvent(event) {
    if (event.event_id && processedEvents.has(event.event_id)) {
      console.log(`⏭️  Skipping duplicate event: ${event.event_id}`);
      return;
    }

    if (event.event_id) {
      processedEvents.add(event.event_id);
    }

    console.log(`📨 Received event: ${event.type}`);

    await handleEvent(event);
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
      return;
    }

    const chatId = data.chat?.id || data.chat_id;
    const isWorkbenchChat = chatId === workbench.chatId || chatId === workbench.openChatId;
    // 路由：工作台消息 → Ban，外部消息 → Lin
    if (isWorkbenchChat) {
      console.log('  🔀 → Ban（办）');
      if (!ban) {
        console.log('  ⏭️  Ban not ready yet');
        return;
      }

      await ban.dispatch(event);
      return;

    } else {
      // 忽略工作台外 Bot 自己发的消息
      if (data.sender?.type === 'bot') {
        console.log('  ⏭️  Ignoring bot message');
        return;
      }

      console.log('  🔀 → Lin（拎）');
      await lin.dispatch(event);
    }
  }

  return {
    port,
    url: `http://${host}:${port}/`,
    setWorkbench(nextWorkbench) {
      workbench = nextWorkbench;
    },
    setOpenbird(nextOpenbird) {
      openbird = nextOpenbird;
    },
    setLark(nextLark) {
      lark = nextLark;
    },
    setBan(nextBan) {
      ban = nextBan;
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
