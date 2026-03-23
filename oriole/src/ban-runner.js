import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildBanContext } from './ban-context.js';
import { createOpenBirdMcpServer } from './mcp-client.js';
import { createBanWorkbenchServer } from './ban-workbench-tools.js';

function buildSystemPrompt() {
  return [
    '你是 Ban（办），负责处理工作台中的消息。',
    '当前触发你的消息，就是这一次要处理的一件事。',
    '你可以调用多个工具。',
    '如果没有事情可做，可以忽略。',
    '如果最新消息只是你自己刚发的回执或状态更新，应忽略该消息（避免自我触发循环）。',
    '默认优先在当前线程回复。',
    '如果产生真实外部副作用，必须在工作台留下可见记录（通过 workbench 工具写出）。',
  ].join('\n');
}

function formatToolNames(entries) {
  const names = (entries ?? [])
    .map((entry) => entry?.name)
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim());

  if (names.length === 0) {
    return '(未知操作)';
  }

  return names.join('、');
}

function splitSideEffects(entries = []) {
  return entries.reduce((groups, entry) => {
    if (entry?.result?.success === false) {
      groups.failed.push(entry);
    } else {
      groups.completed.push(entry);
    }
    return groups;
  }, { completed: [], failed: [] });
}

function formatFallbackReceipt(state) {
  const { completed, failed } = splitSideEffects(state.sideEffects);
  const lines = ['已执行外部操作。'];

  if (completed.length > 0) {
    lines.push(`已完成：${formatToolNames(completed)}`);
  }

  if (failed.length > 0) {
    lines.push(`失败：${formatToolNames(failed)}`);
  }

  return lines.join('\n');
}

function formatFailureMessage({ error, state }) {
  const reason = error?.message || String(error);
  const { completed, failed } = splitSideEffects(state.sideEffects);

  if (completed.length === 0 && failed.length === 0) {
    return `Ban 执行失败：${reason}\n还没有办成。`;
  }

  const lines = [`Ban 执行失败：${reason}`];

  if (completed.length > 0) {
    lines.push(`已完成外部操作：${formatToolNames(completed)}`);
  }

  if (failed.length > 0) {
    lines.push(`已失败的外部操作：${formatToolNames(failed)}`);
  }

  lines.push(`失败原因：${reason}`);
  return lines.join('\n');
}

function buildUserPrompt(context) {
  return [
    '## 当前消息',
    context.currentMessage || '(无文本内容)',
    '',
    '## 当前线程',
    context.threadTranscript || '(无历史消息)',
    '',
    '## 最近事儿',
    context.recentRootSummary || '(无最近事儿)',
    '',
    '## 可用工具',
    context.availableTools || '(无工具)',
  ].join('\n');
}

export async function runBan({
  event,
  workbench,
  lark,
  openbird,
  queryImpl = query,
  buildContext = buildBanContext,
  createOpenBirdServer = createOpenBirdMcpServer,
  createWorkbenchServer = createBanWorkbenchServer,
} = {}) {
  const state = {
    visibleLogWritten: false,
    lastStatusMessageId: null,
    sideEffects: [],
  };
  const fallbackReplyTarget = event?.data?.thread_id ?? event?.data?.message_id;
  let context = null;

  try {
    context = await buildContext({
      event,
      workbench,
      lark,
      openbirdTools: openbird?.tools ?? [],
    });

    const openbirdServer = createOpenBirdServer(openbird, {
      onToolCall: (entry) => {
        if (entry?.sideEffecting) {
          state.sideEffects.push(entry);
        }
      },
    });

    const workbenchServer = createWorkbenchServer({
      workbench,
      lark,
      currentThreadId: context.queueKey,
      state,
    });

    const systemPrompt = buildSystemPrompt();
    const prompt = `${systemPrompt}\n\n${buildUserPrompt(context)}`;

    for await (const _message of queryImpl({
      prompt,
      options: {
        systemPrompt,
        mcpServers: {
          openbird: openbirdServer,
          workbench: workbenchServer,
        },
        maxTurns: 8,
        pathToClaudeCodeExecutable: '/root/.local/bin/claude',
      },
    })) {
      // Stream is consumed for side effects; no extra handling required here.
    }
  } catch (error) {
    const replyTarget = context?.queueKey ?? fallbackReplyTarget;

    if (!replyTarget) {
      throw error;
    }

    await lark.replyMessage(replyTarget, formatFailureMessage({ error, state }));
    return state;
  }

  if (state.sideEffects.length > 0 && !state.visibleLogWritten) {
    await lark.replyMessage(context.queueKey, formatFallbackReceipt(state));
  }

  return state;
}
