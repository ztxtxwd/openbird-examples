import { decode } from 'zwsteg';
import { isRootMatterMessage } from './thread-context.js';

function restoreMarkedText(text = '') {
  const { segments } = decode(text);
  return segments
    .map(({ text: segmentText, isSecret }) => (isSecret ? `{{${segmentText}}}` : segmentText))
    .join('');
}

function extractMessageText(message) {
  const raw = message?.body?.content;
  if (typeof raw !== 'string' || !raw.trim()) {
    return '(无文本内容)';
  }

  try {
    const parsed = JSON.parse(raw);
    const decoded = restoreMarkedText(parsed?.text ?? '');
    return decoded.trim() || '(无文本内容)';
  } catch {
    return '(无文本内容)';
  }
}

function formatEntry(message) {
  return `- [${message.message_id}] ${extractMessageText(message)}`;
}

export async function buildBanContext({ event, workbench, lark, openbirdTools = [] }) {
  const queueKey = event?.data?.thread_id ?? event?.data?.message_id;
  const messages = await lark.listMessages(workbench.openChatId, { pageSize: 50 });
  const ordered = Array.isArray(messages) ? [...messages] : [];

  ordered.sort((first, second) => Number(first.create_time) - Number(second.create_time));

  const threadMessages = queueKey
    ? ordered.filter((message) => message.message_id === queueKey || message.parent_id === queueKey)
    : [];

  const rootMessages = ordered.filter(isRootMatterMessage);

  return {
    queueKey,
    threadTranscript: threadMessages.map(formatEntry).join('\n'),
    recentRootSummary: rootMessages.map(formatEntry).join('\n'),
    availableTools: openbirdTools.map((tool) => tool.name).join(', '),
    currentMessage: extractMessageText({ body: event?.data?.body }),
  };
}
