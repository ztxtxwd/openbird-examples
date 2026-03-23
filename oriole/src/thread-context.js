import { decode } from 'zwsteg';

const CHAT_HISTORY_COUNT = 50;
const MAX_CONTEXT_THREADS = 20;

function normalizeMessageText(text) {
  return typeof text === 'string' && text.trim() ? text : '(无文本内容)';
}

function toNumericTimestamp(timestamp) {
  return Number.isFinite(timestamp) ? timestamp : Number(timestamp) || 0;
}

function restoreMarkedText(text) {
  const { segments } = decode(text);
  return segments
    .map(({ text: segmentText, isSecret }) => (
      isSecret ? `{{${segmentText}}}` : segmentText
    ))
    .join('');
}

function extractMessageText(message) {
  const rawContent = message?.body?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    return '(无文本内容)';
  }

  try {
    const parsedContent = JSON.parse(rawContent);
    return normalizeMessageText(restoreMarkedText(parsedContent?.text));
  } catch {
    return '(无文本内容)';
  }
}

export function isRootMatterMessage(message) {
  const parentId = message?.parent_id;

  if (parentId == null) {
    return true;
  }

  const normalizedParentId = String(parentId).trim();
  return normalizedParentId === '' || normalizedParentId === '0';
}

function sortRootMessages(messages) {
  return [...messages].sort(
    (left, right) => toNumericTimestamp(right.create_time) - toNumericTimestamp(left.create_time),
  );
}

export async function fetchThreadsContext(workbench, lark) {
  try {
    const messages = await lark.listMessages(workbench.openChatId, {
      pageSize: CHAT_HISTORY_COUNT,
    });

    if (!Array.isArray(messages)) {
      return '暂无事儿';
    }

    const rootMessages = sortRootMessages(
      messages.filter((message) => isRootMatterMessage(message)),
    ).slice(0, MAX_CONTEXT_THREADS);

    if (rootMessages.length === 0) {
      return '暂无事儿';
    }

    return rootMessages
      .map((message) => `- [${message.message_id}] ${extractMessageText(message)}`)
      .join('\n');
  } catch {
    return '（无法获取事儿列表）';
  }
}
