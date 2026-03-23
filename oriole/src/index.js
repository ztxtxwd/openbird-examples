import 'dotenv/config';
import { startWebhookServer } from './webhook.js';
import { createOpenBirdClient } from './mcp-client.js';
import { createLarkClient } from './lark.js';
import { loadConfig } from './workbench.js';
import { createBan } from './ban.js';

async function main() {
  console.log('🐦 Oriole starting...');
  let webhook;
  let openbird;
  let shuttingDown = false;

  const config = await loadConfig();

  if (!process.env.OPENBIRD_COOKIE) {
    throw new Error('OPENBIRD_COOKIE is required (set in config env or shell)');
  }

  console.log(`📍 Workbench: chatId=${config.chatId}, openChatId=${config.openChatId}`);

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await Promise.allSettled([openbird?.close(), webhook?.close()]);
  };

  try {
    const lark = createLarkClient(config);
    console.log('🤖 Lark client initialized');

    const workbench = {
      chatId: config.chatId,
      openChatId: config.openChatId,
    };

    webhook = await startWebhookServer();
    console.log(`🔗 Webhook receiver listening on ${webhook.url}`);

    webhook.setWorkbench(workbench);
    webhook.setLark(lark);

    openbird = await createOpenBirdClient(webhook.url);
    console.log(`🔌 Connected to OpenBird MCP (${openbird.tools.length} tools)`);
    webhook.setOpenbird(openbird);

    const ban = createBan({ workbench, lark, openbird });
    await webhook.setBan(ban);

    process.on('SIGINT', async () => {
      await shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await shutdown();
      process.exit(0);
    });

    console.log(`✅ Oriole is running on port ${webhook.port}`);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
