import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const SYSTEM_PROMPT = `你是 Lin（拎），负责分析外界信号并决定是否需要在工作台处理。

你的名字来自"拎得清"——对外界信号做出准确判断。

## 三种决策

1. **创建新事儿** — 调用 create_matter，当信号代表一个新的待办事项
2. **追加到已有事儿** — 调用 append_matter，当信号与某个已有事儿相关
3. **忽略** — 不调用任何工具，当信号不需要处理

## 判断标准

- 与工作相关的消息 → 创建或追加
- 与已有事儿明确相关 → 追加（匹配 thread_id）
- 闲聊、系统消息、无关内容 → 忽略

## 注意

- summary 用简洁的一句话概括信号核心内容
- 不要过度解读，保持客观
- 宁可创建新事儿也不要错误追加到无关事儿`;

/**
 * Lin: 分析外界信号，决定创建/追加/忽略
 */
export async function handleSignal(event, workbench, openbird, lark) {
  const signal = describeSignal(event);
  if (!signal) {
    console.log('  ⏭️  Lin: signal not parseable, skipping');
    return;
  }

  // 预取工作台当前话题列表
  const threadsContext = await fetchThreadsContext(workbench, openbird);

  // 创建工作台操作工具
  const createMatterTool = tool(
    'create_matter',
    '在工作台创建一个新的事儿（话题）',
    { summary: z.string().describe('事儿的简要描述') },
    async ({ summary }) => {
      // 1. 通过 Lark Open API 以 Bot 身份发消息
      const message = await lark.sendMessage(workbench.openChatId, summary);
      const messageId = message?.message_id;

      // 2. 调用 OpenBird MCP 创建话题
      if (messageId) {
        try {
          await openbird.callTool('create_thread', { message_id: messageId });
        } catch (err) {
          console.log(`  ⚠️  Lin: create_thread failed: ${err.message}`);
        }
      }

      console.log(`  📌 Lin: created matter — ${summary}`);
      return { content: [{ type: 'text', text: `已创建事儿: ${summary}` }] };
    },
  );

  const appendMatterTool = tool(
    'append_matter',
    '追加信息到已有的事儿（话题）',
    {
      thread_id: z.string().describe('目标事儿的 messageId（root message ID）'),
      summary: z.string().describe('要追加的信息摘要'),
    },
    async ({ thread_id, summary }) => {
      // 通过 Lark Open API 以 Bot 身份回复话题
      await lark.replyMessage(thread_id, summary);
      console.log(`  📎 Lin: appended to ${thread_id} — ${summary}`);
      return { content: [{ type: 'text', text: `已追加到事儿 ${thread_id}` }] };
    },
  );

  const server = createSdkMcpServer({
    name: 'lin-workbench',
    tools: [createMatterTool, appendMatterTool],
  });


  const prompt = `## 收到的信号

${signal}

## 工作台当前事儿列表

${threadsContext}

请分析这个信号，决定是创建新事儿、追加到已有事儿、还是忽略。`;

  console.log("prompt",prompt)
  console.log('  🧠 Lin analyzing...');
  try {
    for await (const message of query({
      prompt,
      options: {
        model: 'claude-opus-4-6',
        // model: 'claude-haiku-4-5-20251001',
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: { workbench: server },
        allowedTools: [
          'mcp__workbench__create_matter',
          'mcp__workbench__append_matter',
        ],
        maxTurns: 3,
        env: {
           ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
           ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        },
        pathToClaudeCodeExecutable: "/root/.local/bin/claude",
      },
    })) {
      if ('result' in message) {
        console.log(`  ✅ Lin: ${message.result}`);
      }
    }
  } catch (err) {
    console.error('  ❌ Lin error:', err.message);
  }
}

/**
 * 从事件中提取信号描述
 */
function describeSignal(event) {
  const { data } = event;
  if (!data) return null;

  const parts = [];

  parts.push(`事件类型: ${event.type}`);

  if (data.chat) {
    parts.push(`来源: ${data.chat.type} (${data.chat.id})`);
  }

  if (data.sender) {
    parts.push(`发送者: ${data.sender.type} (${data.sender.id})`);
  }

  if (data.content?.type === 'text' && data.content.text) {
    parts.push(`内容: ${data.content.text}`);
  } else if (data.content) {
    parts.push(`内容类型: ${data.content.type}`);
  }

  if (data.thread_id) {
    parts.push(`所在话题: ${data.thread_id}`);
  }

  return parts.join('\n');
}

/**
 * 预取工作台话题列表作为上下文
 */
async function fetchThreadsContext(workbench, openbird) {
  try {
    const result = await openbird.callTool('get_chat_history', {
      chat_id: workbench.chatId,
      count: 50,
    });

    if (!result?.success || !result.messages) {
      return '暂无事儿';
    }

    // root messages（没有 parentMsgId）就是话题
    const threads = result.messages
      .filter((msg) => !msg.parentMsgId)
      .map((msg) => `- [${msg.messageId}] ${msg.text || '(无文本内容)'}`)
      .slice(0, 20);

    return threads.length > 0 ? threads.join('\n') : '暂无事儿';
  } catch (err) {
    console.log(`  ⚠️  Lin: failed to fetch threads: ${err.message}`);
    return '（无法获取事儿列表）';
  }
}
