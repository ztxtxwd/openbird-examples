import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { encodeMarked } from 'zwsteg';
import { fetchThreadsContext } from './thread-context.js';

const SYSTEM_PROMPT = `你是 Lin（拎），名字来自"拎得清"。你是一个事件预处理器，用来分发事件。

## 你所处的系统

你服务于一个飞书上的数字劳动力系统。系统中有以下核心概念：

**数字劳动力**：一个基于 claude-agent-sdk 打造的 multi agent system

**Lin**：数字劳动力的其中一个agent

**老板**：飞书用户，数字劳动力逻辑上的老板

**工作台**：老板与一个专门创建的的飞书机器人的私聊，是老板与数字劳动力沟通的地方。会话里的每个"话题"（thread）代表一个独立的事儿。

**事儿**：当个事儿办的事儿，事儿事儿有回应的事儿，没事儿找事儿的事儿，载体是工作台里的一个话题。每个事儿有一个 thread_id（即该话题首条消息的 message_id）。事儿是最小的协作单元——一件需要跟进的事就是一个事儿。

**消息**：从工作台外部传入的消息。

## 你的职责

你收到一个消息，需要判断：这个消息是否代表一件需要在工作台跟进的事儿？

三种决策：
1. **创建新事儿** → 调用 create_matter。消息代表一件还从未和老板讨论过的事儿。
2. **追加到已有事儿** → 调用 append_matter。消息明确是某个已存在事儿的后续进展。
3. **忽略** → 不调用任何工具。

## 判断指引

创建新事儿：
- 有人提了问题、请求、或需要回应的事（哪怕只是一句话）
- 工作台里没有与之匹配的已有事儿
- **拿不准要不要忽略时，创建新事儿**

追加到已有事儿：
- 消息内容明确是某个已有事儿的补充、回复或进展
- 必须能确定对应哪个 thread_id，不能猜

忽略（极少使用）：
- 仅限：纯表情回复、"好的/收到"等无实质内容的确认、系统自动通知
- 只要消息里有具体的问题或信息，就不应忽略

## 原则

- 保持客观，不要过度解读消息的意图
- 宁可创建新事儿，也不要错误追加到无关的事儿
- 如果拿不准是否和已有事儿相关，创建新的`;

function encodeMatterContent(content) {
  return content.includes('{{') ? encodeMarked(content) : content;
}

export function createMatterHandler({ workbench, lark }) {
  return async ({ content }) => {
    console.log('content', content);

    const encoded = encodeMatterContent(content);
    await lark.sendMessage(workbench.openChatId, encoded);

    console.log(`  📌 Lin: created matter — ${content}`);
    return { content: [{ type: 'text', text: `已创建事儿: ${content}` }] };
  };
}

/**
 * Lin: 分析外界信号，决定创建/追加/忽略
 */
export async function handleSignal(event, workbench, openbird, lark) {
  const signal = JSON.stringify(event);
  if (!signal) {
    console.log('  ⏭️  Lin: signal not parseable, skipping');
    return;
  }

  // 预取工作台当前话题列表
  const threadsContext = await fetchThreadsContext(workbench, lark);

  console.log(JSON.stringify(event))
  // 创建工作台操作工具，,所有涉及到用户、会话的内容务必包含相应的 ID，这将大幅提高系统效率。比如说你提到了用户，那就要加上用户 ID；提到会话，就要加上相应的 Chat ID。所有 ID 用双花括号包裹。
  const createMatterTool = tool(
    'create_matter',
    '在工作台创建一个新的事儿（话题）',
    {
      content: z.string().describe('事儿的完整描述。正确示例：用户赵天雄{{7321915301888393220}}通过私聊{{7608756869594614964}}消息{{7608756869594614964}}询问明天几点出发。错误示例：赵天雄（私聊）问：明天几点出发')
    },
    createMatterHandler({ workbench, lark }),
  );

  const appendMatterTool = tool(
    'append_matter',
    '追加信息到已有的事儿（话题）',
    {
      thread_id: z.string().describe('目标事儿的 messageId（root message ID）'),
      content: z.string().describe('要追加的信息内容，务必包含所有有关ID。所有 ID 用双花括号包裹，如：用户张三{{7321915301888393220}}反馈了新进展{{7608756869594614964}}。'),
    },
    async ({ thread_id, content }) => {
      // 将 {{id}} 编码为零宽字符
      const encoded = encodeMatterContent(content);

      // 通过 Lark Open API 以 Bot 身份回复话题
      await lark.replyMessage(thread_id, encoded);
      console.log(`  📎 Lin: appended to ${thread_id} — ${content}`);
      return { content: [{ type: 'text', text: `已追加到事儿 ${thread_id}` }] };
    },
  );

  const server = createSdkMcpServer({
    name: 'lin-workbench',
    tools: [createMatterTool, appendMatterTool],
  });


  const prompt = `## 收到的消息

${signal}

## 工作台当前事儿列表

${threadsContext}

请分析这消息，决定是创建新事儿、追加到已有事儿、还是忽略。`;

  console.log("prompt", prompt)
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
