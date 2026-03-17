import { createServer } from 'openbird-webhook-node';

// 用于去重的事件 ID 集合
const processedEvents = new Set();

export async function startWebhookServer() {
  let workbench = null;

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
    await handleEvent(event, workbench);
  });

  const server = await receiver.listen(0, '127.0.0.1');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    setWorkbench(nextWorkbench) {
      workbench = nextWorkbench;
    },
    close() {
      return receiver.close();
    },
  };
}

async function handleEvent(event, workbench) {
  if (!workbench) {
    console.log('  ⏭️  Workbench is not ready yet');
    return;
  }

  const { data } = event;

  if (data.conversation) {
    console.log(`  📍 Conversation: ${data.conversation.type} (${data.conversation.id})`);
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

  const chatId = data.conversation?.id || data.chat_id;

  if (chatId === workbench.chatId) {
    console.log('  🔀 → Ban（办）');
    // TODO: implement Ban
  } else {
      console.log('  🔀 → Lin（拎）');
    // TODO: implement Lin
  }
}
