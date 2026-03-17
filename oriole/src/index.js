import 'dotenv/config';
import { startWebhookServer } from './webhook.js';
import { createOpenBirdClient } from './mcp-client.js';
import { initializeWorkbench } from './workbench.js';

async function main() {
  console.log('🐦 Oriole starting...');
  let webhook;
  let openbird;
  let shuttingDown = false;

  // 检查必需的环境变量
  if (!process.env.OPENBIRD_COOKIE) {
    throw new Error('OPENBIRD_COOKIE is required');
  }

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await Promise.allSettled([openbird?.close(), webhook?.close()]);
  };

  try {
    webhook = await startWebhookServer();
    console.log(`🔗 Webhook receiver listening on ${webhook.url}`);

    openbird = await createOpenBirdClient(webhook.url);
    console.log(`🔌 Connected to OpenBird MCP (${openbird.tools.length} tools)`);

    const workbench = await initializeWorkbench(openbird);
    webhook.setWorkbench(workbench);

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
