import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SETTINGS_DIR = path.join(os.homedir(), '.oriole');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

const REQUIRED_FIELDS = ['appId', 'appSecret', 'chatId', 'openChatId'];

export async function loadConfig() {
  let config;
  try {
    const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
    config = JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${SETTINGS_FILE}\nCreate it with: ${JSON.stringify({ appId: '', appSecret: '', chatId: '', openChatId: '' }, null, 2)}`);
    }
    throw error;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!config[field]) {
      throw new Error(`Missing required config field "${field}" in ${SETTINGS_FILE}`);
    }
  }

  return config;
}
