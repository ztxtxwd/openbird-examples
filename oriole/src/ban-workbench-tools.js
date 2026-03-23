import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

function markVisibleLogWritten(state) {
  state.visibleLogWritten = true;
}

export function createBanWorkbenchHandlers({ workbench, lark, currentThreadId, state }) {
  return {
    async replyInCurrentThread({ content }) {
      const result = await lark.replyMessage(currentThreadId, content);
      markVisibleLogWritten(state);
      state.lastStatusMessageId = result?.message_id ?? state.lastStatusMessageId;
      return result;
    },
    async postTopLevelMessage({ content }) {
      const result = await lark.sendMessage(workbench.openChatId, content);
      markVisibleLogWritten(state);
      state.lastStatusMessageId = result?.message_id ?? state.lastStatusMessageId;
      return result;
    },
    async editStatusMessage({ content }) {
      if (!state.lastStatusMessageId) {
        throw new Error('No Ban-owned status message is available to edit');
      }
      const result = await lark.editMessage(state.lastStatusMessageId, content);
      markVisibleLogWritten(state);
      return result;
    },
  };
}

export function createBanWorkbenchServer(deps) {
  const handlers = createBanWorkbenchHandlers(deps);

  return createSdkMcpServer({
    name: 'ban-workbench',
    tools: [
      tool(
        'reply_in_current_thread',
        '在当前线程回复',
        { content: z.string() },
        async ({ content }) => ({
          content: [{ type: 'text', text: JSON.stringify(await handlers.replyInCurrentThread({ content })) }],
        }),
      ),
      tool(
        'post_top_level_message',
        '发新的工作台顶级消息',
        { content: z.string() },
        async ({ content }) => ({
          content: [{ type: 'text', text: JSON.stringify(await handlers.postTopLevelMessage({ content })) }],
        }),
      ),
      tool(
        'edit_status_message',
        '编辑最近一条 Ban 状态消息',
        { content: z.string() },
        async ({ content }) => ({
          content: [{ type: 'text', text: JSON.stringify(await handlers.editStatusMessage({ content })) }],
        }),
      ),
    ],
  });
}
