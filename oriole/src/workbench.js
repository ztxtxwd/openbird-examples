import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SETTINGS_DIR = path.join(os.homedir(), '.oriole');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

export async function initializeWorkbench(openbird) {
  // 尝试加载已有配置
  const existing = await loadSettings();
  if (existing?.chatId) {
    console.log('✅ Workbench already initialized');
    console.log(`  📍 Chat ID: ${existing.chatId}`);
    return { chatId: existing.chatId, webhookUrl: existing.webhookUrl };
  }

  console.log('🔧 Initializing workbench...');

  // 第一步：创建话题群
  const groupResult = await openbird.callTool('create_group', {
    name: 'Oriole 工作台',
    description: 'Oriole 工作台',
    chat_mode: 1,
  });

  if (!groupResult?.success || !groupResult.chatId) {
    throw new Error(groupResult?.error || 'Failed to create workbench group');
  }

  const chatId = groupResult.chatId;
  console.log(`  ✅ Created workbench group: ${chatId}`);

  // 第二步：创建 Webhook 机器人
  const botResult = await openbird.callTool('create_webhook_bot', {
    chat_id: chatId,
    name: 'Oriole',
    description: 'Oriole Agent',
  });

  if (!botResult?.success || !botResult.data?.bot_id) {
    throw new Error(botResult?.error || 'Failed to create webhook bot');
  }

  const botId = botResult.data.bot_id;
  console.log(`  ✅ Created webhook bot: ${botId}`);

  // 第三步：获取 Webhook 信息
  const infoResult = await openbird.callTool('get_webhook_bot_info', {
    bot_id: botId,
  });

  if (!infoResult?.success || !infoResult.data?.webhook) {
    throw new Error(infoResult?.error || 'Failed to get webhook bot info');
  }

  const webhookUrl = infoResult.data.webhook;
  console.log(`  ✅ Got webhook URL`);

  // 第四步：将工作台信息写入群描述
  const metadata = {
    type: 'oriole-workbench',
    chatId,
    botId,
    webhookUrl,
    createdAt: Date.now(),
  };

  const patchResult = await openbird.callTool('patch_group_chat', {
    chat_id: chatId,
    description: JSON.stringify(metadata),
  });

  if (!patchResult?.success) {
    throw new Error(patchResult?.error || 'Failed to persist workbench metadata');
  }

  // 第五步：置顶工作台
  const pinResult = await openbird.callTool('pin_session', {
    chat_id: chatId,
  });

  if (!pinResult?.success) {
    console.log(`  ⚠️  Pin session failed (non-critical): ${pinResult?.error || 'unknown'}`);
  }

  // 保存配置
  const settings = {
    chatId,
    botId,
    webhookUrl,
  };

  await saveSettings(settings);
  console.log(`  💾 Settings saved to ${SETTINGS_FILE}`);

  // 第六步：通过 Webhook 发送欢迎消息
  await sendWebhookMessage(webhookUrl, 'Oriole 工作台已初始化 ✅');

  return settings;
}

export async function sendWebhookMessage(webhookUrl, text) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text },
    }),
  });

  if (!res.ok) {
    console.log(`  ⚠️  Webhook message failed: ${res.status}`);
  }
}

async function loadSettings() {
  try {
    const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function saveSettings(settings) {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}
