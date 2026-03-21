import { createServer } from 'openbird-webhook-node';
import { handleSignal } from './lin.js';

// 用于去重的事件 ID 集合
const processedEvents = new Set();

export async function startWebhookServer() {
  let workbench = null;
  let openbird = null;
  let lark = null;

  const receiver = createServer();

  receiver.on('*', async (event) => {
    if (event.event_id && processedEvents.has(event.event_id)) {
      console.log(`⏭️  Skipping duplicate event: ${event.event_id}`);
      return;
    }

    if (event.event_id) {
      processedEvents.add(event.event_id);
    }

    console.log(`📨 Received event: ${event.type}`);
    await handleEvent(event);
  });

  const server = await receiver.listen(0, '127.0.0.1');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;

  async function handleEvent(event) {
    console.log(event._enriched);

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
        console.log(`  📝 Text: ${data.content.text}`);
      }
    }

    if (data.thread_id) {
      console.log(`  🧵 Thread: ${data.thread_id}`);
    }

    // 忽略 Bot 自己发的消息
    if (data.sender?.type === 'bot') {
      console.log('  ⏭️  Ignoring bot message');
      return;
    }

    if (!workbench) {
      console.log('  ⏭️  Workbench not ready yet');
      return;
    }

    const chatId = data.chat?.id || data.chat_id;
    console.log("chatId",chatId)
    console.log("workbench.chatId",workbench.chatId)
    // 路由：工作台消息 → Ban，外部消息 → Lin
    if (chatId === workbench.chatId) {
      console.log('  🔀 → Ban（办）');
      // TODO: implement Ban
    } else {
      console.log('  🔀 → Lin（拎）');
      console.log(event)
      // await handleSignal(event, workbench, openbird, lark);
    }
  }

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    setWorkbench(nextWorkbench) {
      workbench = nextWorkbench;
    },
    setOpenbird(nextOpenbird) {
      openbird = nextOpenbird;
    },
    setLark(nextLark) {
      lark = nextLark;
    },
    close() {
      return receiver.close();
    },
  };
}
