# Ban 工作台消息驱动实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个由工作台消息驱动的 Ban 运行时，使其按线程串行处理消息、可调用完整 OpenBird MCP 工具、并在产生真实副作用时保证工作台留痕。

**Architecture:** 在保留 Lin 和 Ban 并列结构的前提下，为 Ban 增加 dispatcher、context、runner 和 workbench 工具层，并在现有 `src/mcp-client.js` 上扩展 OpenBird 工具适配能力。执行必须遵循 @superpowers:test-driven-development：每个组件先写 failing test，再写最小实现，最后跑测试和 `pnpm run build` 验证；完成前再用 @superpowers:verification-before-completion 做总验收。

**Tech Stack:** Node.js 20+, ESM, node:test, @anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk, @larksuiteoapi/node-sdk, zwsteg

---

## 文件结构

- Modify: `src/index.js` — 初始化 Ban，并把 Ban 注入 webhook。
- Modify: `src/webhook.js` — 将工作台消息路由到 Ban，保留 Lin 路径，同时调整 bot 消息过滤位置。
- Modify: `src/mcp-client.js` — 移除硬编码 `REQUIRED_TOOLS` 假设，暴露完整工具清单，并提供基于现有连接的 OpenBird MCP adapter。
- Modify: `src/lark.js` — 只有在 Ban context 或 workbench tools 需要额外 helper 时才补最小接口。
- Modify: `package.json` — 把新增源文件纳入 `pnpm run build` 的 `node --check` 列表。
- Create: `src/ban.js` — Ban 工厂，负责把 dispatcher、runner、context 和工具层拼起来。
- Create: `src/ban-dispatcher.js` — 按 `thread_id ?? message_id` 串行排队。
- Create: `src/ban-context.js` — 归一化 webhook 事件，装配当前线程上下文和根消息摘要。
- Create: `src/ban-runner.js` — 执行单次 Ban 运行，挂载 MCP servers，处理留痕兜底。
- Create: `src/ban-workbench-tools.js` — 回写工作台的本地 MCP tool server。
- Test: `test/ban-dispatcher.test.js` — 队列键和串/并行行为。
- Test: `test/ban-context.test.js` — 上下文装配、隐藏 id 恢复、线程摘要。
- Test: `test/ban-workbench-tools.test.js` — 线程回复、可见留痕状态、编辑限制。
- Test: `test/mcp-client.test.js` — OpenBird tool catalog、转发和副作用分类。
- Test: `test/ban-runner.test.js` — 忽略、显式留痕、兜底留痕、失败语义。
- Test: `test/webhook-ban-routing.test.js` — webhook 对 Ban/Lin 的分流与依赖注入。

## 实施说明

- 保持 `Lin` 的职责和入口不变；本计划只补 `Ban` 实现，不重构 `src/lin.js`。
- 优先编写可注入依赖的纯函数或薄包装，避免为了测试去 mock 整个 SDK。
- `Ban` 的 OpenBird 适配层优先复用 `@modelcontextprotocol/sdk` 的 `McpServer` + `server.setRequestHandler(...)`，直接转发现有 `openbird.tools` 与 `openbird.callTool()`，不要手写 JSON Schema 到 Zod 的转换器。
- 所有测试命令默认使用 `node --test`；总体验证使用 `pnpm run build`。

### Task 1: Ban Dispatcher

**Files:**
- Create: `src/ban-dispatcher.js`
- Test: `test/ban-dispatcher.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBanDispatcher, getBanQueueKey } from '../src/ban-dispatcher.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('getBanQueueKey prefers thread_id and falls back to message_id', () => {
  assert.equal(getBanQueueKey({ data: { thread_id: 'th-1', message_id: 'm-1' } }), 'th-1');
  assert.equal(getBanQueueKey({ data: { message_id: 'm-2' } }), 'm-2');
});

test('dispatch serializes events with the same queue key', async () => {
  const blocker = createDeferred();
  const order = [];
  const dispatcher = createBanDispatcher({
    run: async ({ queueKey }) => {
      order.push(`start:${queueKey}:${order.length}`);
      if (order.length === 1) {
        await blocker.promise;
      }
      order.push(`end:${queueKey}:${order.length}`);
    },
  });

  const first = dispatcher.dispatch({ data: { thread_id: 'th-1' } });
  const second = dispatcher.dispatch({ data: { thread_id: 'th-1' } });

  await Promise.resolve();
  assert.deepEqual(order, ['start:th-1:0']);

  blocker.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    'start:th-1:0',
    'end:th-1:1',
    'start:th-1:2',
    'end:th-1:3',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ban-dispatcher.test.js`
Expected: FAIL with `Cannot find module '../src/ban-dispatcher.js'` or missing export errors.

- [ ] **Step 3: Write minimal implementation**

```js
export function getBanQueueKey(event) {
  const data = event?.data ?? {};
  return data.thread_id ?? data.message_id ?? null;
}

export function createBanDispatcher({ run }) {
  const tails = new Map();

  return {
    async dispatch(event) {
      const queueKey = getBanQueueKey(event);
      if (!queueKey) {
        throw new Error('Ban dispatch requires thread_id or message_id');
      }

      const previous = tails.get(queueKey) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => run({ event, queueKey }));
      const tracked = current.finally(() => {
        if (tails.get(queueKey) === tracked) {
          tails.delete(queueKey);
        }
      });

      tails.set(queueKey, tracked);
      return tracked;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ban-dispatcher.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/ban-dispatcher.test.js src/ban-dispatcher.js
git commit -m "feat: add Ban dispatcher queue"
```

### Task 2: Ban Context Assembly

**Files:**
- Create: `src/ban-context.js`
- Test: `test/ban-context.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMarked } from 'zwsteg';
import { buildBanContext } from '../src/ban-context.js';

test('buildBanContext assembles current thread and restores hidden ids', async () => {
  const lark = {
    async listMessages() {
      return [
        {
          message_id: 'reply-1',
          parent_id: 'root-1',
          create_time: '200',
          body: { content: JSON.stringify({ text: '补充说明' }) },
        },
        {
          message_id: 'root-1',
          create_time: '100',
          body: {
            content: JSON.stringify({
              text: encodeMarked('用户{{u-1}}询问进度{{msg-1}}'),
            }),
          },
        },
      ];
    },
  };

  const context = await buildBanContext({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark,
    openbirdTools: [{ name: 'pin_session' }],
  });

  assert.equal(context.queueKey, 'root-1');
  assert.match(context.threadTranscript, /用户\{\{u-1\}\}询问进度\{\{msg-1\}\}/);
  assert.match(context.threadTranscript, /补充说明/);
  assert.match(context.recentRootSummary, /\[root-1\]/);
  assert.match(context.availableTools, /pin_session/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ban-context.test.js`
Expected: FAIL with module missing or `buildBanContext is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
import { decode } from 'zwsteg';
import { isRootMatterMessage } from './thread-context.js';

function restoreMarkedText(text = '') {
  const { segments } = decode(text);
  return segments.map(({ text: part, isSecret }) => (
    isSecret ? `{{${part}}}` : part
  )).join('');
}

function extractMessageText(message) {
  const raw = message?.body?.content;
  if (!raw) return '(无文本内容)';
  const parsed = JSON.parse(raw);
  return restoreMarkedText(parsed?.text ?? '').trim() || '(无文本内容)';
}

export async function buildBanContext({ event, workbench, lark, openbirdTools }) {
  const queueKey = event?.data?.thread_id ?? event?.data?.message_id;
  const messages = await lark.listMessages(workbench.openChatId, { pageSize: 50 });
  const ordered = [...messages].sort((a, b) => Number(a.create_time) - Number(b.create_time));
  const threadMessages = ordered.filter((message) => (
    message.message_id === queueKey || message.parent_id === queueKey
  ));
  const rootMessages = ordered.filter(isRootMatterMessage);

  return {
    queueKey,
    threadTranscript: threadMessages.map((message) => `- [${message.message_id}] ${extractMessageText(message)}`).join('\n'),
    recentRootSummary: rootMessages.map((message) => `- [${message.message_id}] ${extractMessageText(message)}`).join('\n'),
    availableTools: openbirdTools.map((tool) => `- ${tool.name}`).join('\n'),
    currentMessage: extractMessageText({ body: event?.data?.body }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ban-context.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/ban-context.test.js src/ban-context.js
git commit -m "feat: add Ban context builder"
```

### Task 3: Workbench Tool Handlers and MCP Server

**Files:**
- Create: `src/ban-workbench-tools.js`
- Test: `test/ban-workbench-tools.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBanWorkbenchHandlers } from '../src/ban-workbench-tools.js';

test('replyInCurrentThread writes a thread reply and marks visible logging', async () => {
  const calls = [];
  const state = { visibleLogWritten: false, lastStatusMessageId: null };
  const handlers = createBanWorkbenchHandlers({
    workbench: { openChatId: 'open-chat-1' },
    lark: {
      async replyMessage(messageId, text) {
        calls.push({ type: 'reply', messageId, text });
        return { message_id: 'reply-1' };
      },
    },
    currentThreadId: 'root-1',
    state,
  });

  await handlers.replyInCurrentThread({ content: '已执行 pin_session' });

  assert.deepEqual(calls, [{ type: 'reply', messageId: 'root-1', text: '已执行 pin_session' }]);
  assert.equal(state.visibleLogWritten, true);
  assert.equal(state.lastStatusMessageId, 'reply-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ban-workbench-tools.test.js`
Expected: FAIL with module missing or `createBanWorkbenchHandlers is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export function createBanWorkbenchHandlers({ workbench, lark, currentThreadId, state }) {
  return {
    async replyInCurrentThread({ content }) {
      const result = await lark.replyMessage(currentThreadId, content);
      state.visibleLogWritten = true;
      state.lastStatusMessageId = result?.message_id ?? state.lastStatusMessageId;
      return result;
    },
    async postTopLevelMessage({ content }) {
      const result = await lark.sendMessage(workbench.openChatId, content);
      state.visibleLogWritten = true;
      state.lastStatusMessageId = result?.message_id ?? state.lastStatusMessageId;
      return result;
    },
    async editStatusMessage({ content }) {
      if (!state.lastStatusMessageId) {
        throw new Error('No Ban-owned status message is available to edit');
      }
      return lark.editMessage(state.lastStatusMessageId, content);
    },
  };
}

export function createBanWorkbenchServer(deps) {
  const handlers = createBanWorkbenchHandlers(deps);
  return createSdkMcpServer({
    name: 'ban-workbench',
    tools: [
      tool('reply_in_current_thread', '在当前线程回复', { content: z.string() }, async ({ content }) => ({
        content: [{ type: 'text', text: JSON.stringify(await handlers.replyInCurrentThread({ content })) }],
      })),
      tool('post_top_level_message', '发新的工作台顶级消息', { content: z.string() }, async ({ content }) => ({
        content: [{ type: 'text', text: JSON.stringify(await handlers.postTopLevelMessage({ content })) }],
      })),
      tool('edit_status_message', '编辑最近一条 Ban 状态消息', { content: z.string() }, async ({ content }) => ({
        content: [{ type: 'text', text: JSON.stringify(await handlers.editStatusMessage({ content })) }],
      })),
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ban-workbench-tools.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/ban-workbench-tools.test.js src/ban-workbench-tools.js
git commit -m "feat: add Ban workbench tool handlers"
```

### Task 4: OpenBird Tool Adapter in `src/mcp-client.js`

**Files:**
- Modify: `src/mcp-client.js`
- Test: `test/mcp-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenBirdTool,
  callObservedOpenBirdTool,
} from '../src/mcp-client.js';

test('classifyOpenBirdTool treats readOnly annotations as non-side-effecting', () => {
  assert.equal(classifyOpenBirdTool({ name: 'get_user', annotations: { readOnly: true } }), false);
  assert.equal(classifyOpenBirdTool({ name: 'pin_session' }), true);
});

test('callObservedOpenBirdTool forwards calls and reports side effects', async () => {
  const seen = [];
  const openbird = {
    tools: [{ name: 'pin_session' }],
    async callTool(name, args) {
      seen.push({ name, args });
      return { success: true, data: { pinned: true } };
    },
  };

  const observed = [];
  const result = await callObservedOpenBirdTool({
    openbird,
    name: 'pin_session',
    args: { chatId: 'chat-1' },
    onToolCall: (entry) => observed.push(entry),
  });

  assert.deepEqual(seen, [{ name: 'pin_session', args: { chatId: 'chat-1' } }]);
  assert.equal(result.success, true);
  assert.equal(observed[0].sideEffecting, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-client.test.js`
Expected: FAIL with missing exports.

- [ ] **Step 3: Write minimal implementation**

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function classifyOpenBirdTool(tool) {
  return tool?.annotations?.readOnly !== true;
}

export async function callObservedOpenBirdTool({ openbird, name, args = {}, onToolCall = () => {} }) {
  const tool = openbird.tools.find((candidate) => candidate.name === name);
  const result = await openbird.callTool(name, args);
  onToolCall({ name, args, result, tool, sideEffecting: classifyOpenBirdTool(tool) });
  return result;
}

export function createOpenBirdMcpServer(openbird, { onToolCall = () => {} } = {}) {
  const server = new McpServer({ name: 'openbird-adapter', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: openbird.tools.map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    })),
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callObservedOpenBirdTool({
      openbird,
      name: request.params.name,
      args: request.params.arguments ?? {},
      onToolCall,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: result?.success === false,
    };
  });

  return { type: 'sdk', name: 'openbird', instance: server };
}
```

Implementation notes for this task:
- 删除 `REQUIRED_TOOLS` 校验，避免把 `Ban` 锁死在少量工具上。
- 保留 `createOpenBirdClient()` 的长连接逻辑，只扩适配层，不复制连接逻辑。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcp-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/mcp-client.test.js src/mcp-client.js
git commit -m "feat: expose OpenBird adapter for Ban"
```

### Task 5: Ban Runner

**Files:**
- Create: `src/ban-runner.js`
- Test: `test/ban-runner.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBan } from '../src/ban-runner.js';

async function* emptyQuery() {
  yield { result: 'ignored' };
}

test('runBan stays silent when no side effects happen', async () => {
  const replies = [];
  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({ queueKey: 'root-1', threadTranscript: '', recentRootSummary: '', availableTools: '' }),
    queryImpl: emptyQuery,
    createOpenBirdServer: () => ({ type: 'sdk', name: 'openbird', instance: {} }),
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.deepEqual(replies, []);
});

test('runBan writes fallback receipt when side effects happened without visible log', async () => {
  const replies = [];

  async function* queryImpl() {
    yield { result: 'done' };
  }

  await runBan({
    event: { data: { message_id: 'root-1' } },
    workbench: { openChatId: 'open-chat-1' },
    lark: { async replyMessage(id, text) { replies.push({ id, text }); } },
    openbird: { tools: [] },
    buildContext: async () => ({ queueKey: 'root-1', threadTranscript: '', recentRootSummary: '', availableTools: '' }),
    queryImpl,
    createOpenBirdServer: (_openbird, { onToolCall }) => {
      onToolCall({ name: 'pin_session', sideEffecting: true, result: { success: true } });
      return { type: 'sdk', name: 'openbird', instance: {} };
    },
    createWorkbenchServer: ({ state }) => ({ type: 'sdk', name: 'workbench', instance: {}, state }),
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /pin_session/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ban-runner.test.js`
Expected: FAIL with module missing.

- [ ] **Step 3: Write minimal implementation**

```js
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
    '如果产生真实外部副作用，必须在工作台留下可见记录。',
  ].join('\n');
}

function formatFallbackReceipt(state) {
  const toolNames = state.sideEffects.map((entry) => entry.name).join('、');
  return `已执行外部操作：${toolNames}`;
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
}) {
  const state = {
    visibleLogWritten: false,
    lastStatusMessageId: null,
    sideEffects: [],
  };

  const context = await buildContext({
    event,
    workbench,
    lark,
    openbirdTools: openbird.tools,
  });

  const openbirdServer = createOpenBirdServer(openbird, {
    onToolCall: (entry) => {
      if (entry.sideEffecting) {
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

  try {
    for await (const _message of queryImpl({
      prompt: `${buildSystemPrompt()}\n\n## 当前线程\n${context.threadTranscript}\n\n## 最近事儿\n${context.recentRootSummary}`,
      options: {
        systemPrompt: buildSystemPrompt(),
        mcpServers: {
          openbird: openbirdServer,
          workbench: workbenchServer,
        },
        maxTurns: 8,
        pathToClaudeCodeExecutable: '/root/.local/bin/claude',
      },
    })) {
      // 流式结果当前只需要消费，不需要额外处理
    }
  } catch (error) {
    await lark.replyMessage(context.queueKey, `Ban 执行失败：${error.message}`);
    return state;
  }

  if (state.sideEffects.length > 0 && !state.visibleLogWritten) {
    await lark.replyMessage(context.queueKey, formatFallbackReceipt(state));
  }

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ban-runner.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/ban-runner.test.js src/ban-runner.js
git commit -m "feat: add Ban runner"
```

### Task 6: Wire Ban into Webhook and Process Startup

**Files:**
- Create: `src/ban.js`
- Modify: `src/index.js`
- Modify: `src/webhook.js`
- Modify: `package.json`
- Test: `test/webhook-ban-routing.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startWebhookServer } from '../src/webhook.js';

test('workbench bot messages are routed to Ban instead of being dropped', async () => {
  const webhook = await startWebhookServer();
  const seen = [];

  webhook.setWorkbench({ chatId: 'workbench-chat', openChatId: 'open-chat-1' });
  webhook.setBan({
    async dispatch(event) {
      seen.push(event.data.message_id);
    },
  });

  await webhook.__testHandleEvent({
    type: 'message.receive_v1',
    data: {
      chat: { id: 'workbench-chat', type: 'p2p' },
      sender: { type: 'bot', id: 'bot-1' },
      message_id: 'msg-1',
    },
  });

  assert.deepEqual(seen, ['msg-1']);
  await webhook.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/webhook-ban-routing.test.js`
Expected: FAIL because webhook has no Ban injection point or still drops workbench bot messages.

- [ ] **Step 3: Write minimal implementation**

```js
// src/ban.js
import { createBanDispatcher } from './ban-dispatcher.js';
import { runBan } from './ban-runner.js';

export function createBan(deps) {
  const dispatcher = createBanDispatcher({
    run: ({ event }) => runBan({ ...deps, event }),
  });

  return {
    dispatch(event) {
      return dispatcher.dispatch(event);
    },
  };
}

// src/index.js
import { createBan } from './ban.js';

const ban = createBan({ workbench, lark, openbird });
webhook.setBan(ban);

// src/webhook.js
let ban = null;

if (chatId === workbench.chatId) {
  await ban?.dispatch(event);
  return;
}

if (data.sender?.type === 'bot') {
  return;
}

return handleSignal(event, workbench, openbird, lark);
```

Also update `package.json` build script so it checks:

```json
"build": "node --check src/index.js && node --check src/mcp-client.js && node --check src/webhook.js && node --check src/workbench.js && node --check src/lin.js && node --check src/lark.js && node --check src/thread-context.js && node --check src/ban.js && node --check src/ban-dispatcher.js && node --check src/ban-context.js && node --check src/ban-workbench-tools.js && node --check src/ban-runner.js"
```

Implementation note for testing: expose a narrow `__testHandleEvent` hook from `startWebhookServer()` only if absolutely necessary; prefer reusing the internal handler function without turning production code into a test harness if you can inject the receiver callback another way.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/webhook-ban-routing.test.js && pnpm run build`
Expected: PASS, then build completes with exit code 0.

- [ ] **Step 5: Commit**

```bash
git add test/webhook-ban-routing.test.js src/ban.js src/index.js src/webhook.js package.json
git commit -m "feat: wire Ban into webhook runtime"
```

### Task 7: Full Ban Verification Sweep

**Files:**
- Modify: `src/lark.js` (only if Ban execution exposed a missing helper)
- Modify: `src/ban-context.js` (only if transcript assembly needs adjustment)
- Modify: `src/ban-runner.js` (only if full regression reveals fallback or prompt issues)
- Test: `test/ban-dispatcher.test.js`
- Test: `test/ban-context.test.js`
- Test: `test/ban-workbench-tools.test.js`
- Test: `test/mcp-client.test.js`
- Test: `test/ban-runner.test.js`
- Test: `test/webhook-ban-routing.test.js`
- Test: `test/lark.test.js`
- Test: `test/thread-context.test.js`
- Test: `test/lin-create-matter.test.js`

- [ ] **Step 1: Run the full focused regression suite**

Run:

```bash
node --test \
  test/ban-dispatcher.test.js \
  test/ban-context.test.js \
  test/ban-workbench-tools.test.js \
  test/mcp-client.test.js \
  test/ban-runner.test.js \
  test/webhook-ban-routing.test.js \
  test/lark.test.js \
  test/thread-context.test.js \
  test/lin-create-matter.test.js
```

Expected: PASS

- [ ] **Step 2: Run build verification**

Run: `pnpm run build`
Expected: PASS with exit code 0

- [ ] **Step 3: Fix only the failures that show up**

```js
// Keep fixes local to the failing module.
// Do not refactor Lin or unrelated workbench code unless a test proves the change is required.
```

- [ ] **Step 4: Re-run regression and build**

Run:

```bash
node --test \
  test/ban-dispatcher.test.js \
  test/ban-context.test.js \
  test/ban-workbench-tools.test.js \
  test/mcp-client.test.js \
  test/ban-runner.test.js \
  test/webhook-ban-routing.test.js \
  test/lark.test.js \
  test/thread-context.test.js \
  test/lin-create-matter.test.js && \
pnpm run build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lark.js src/ban-context.js src/ban-runner.js \
  test/ban-dispatcher.test.js test/ban-context.test.js test/ban-workbench-tools.test.js \
  test/mcp-client.test.js test/ban-runner.test.js test/webhook-ban-routing.test.js \
  test/lark.test.js test/thread-context.test.js test/lin-create-matter.test.js package.json
git commit -m "test: verify Ban runtime end to end"
```
