# 工作台初始化设计

> 上游文档：[工作台与事务设计](./2026-02-25-workbench-and-tasks.md)、[通用 Agent 架构设计](./2026-02-25-general-agent-architecture.md)

## 背景

工作台是 Oriole 一切功能的基础设施。工作台即用户与飞书原生 App Bot 的私聊——用户在飞书里找到 Bot、发出第一条消息，工作台就自然建立了。整个过程不需要建群、不需要配机器人、不需要任何手动操作。

## 前提条件

用户需要提供一个已注册的飞书应用的凭证：

- `APP_ID`：飞书应用的 App ID
- `APP_SECRET`：飞书应用的 App Secret

飞书应用需要启用机器人能力，并配置好事件订阅。Oriole 使用 `@larksuite/node-sdk` 通过飞书 Open API 以 Bot 身份与用户交互。

## 初始化触发

用户在飞书中找到 Bot 并发送第一条消息。这条消息通过 OpenBird 事件推送到达 Oriole。

Oriole 检测到这是一个新的私聊（本地无对应 chat_id 记录），进入初始化流程。

## 初始化流程

### 第一步：记录工作台

收到用户的第一条消息后，从事件中提取 `chat_id` 和 `user_id`，存入本地设置。

```javascript
// ~/.oriole/settings.json
{
  chatId: event.data.conversation.id,
  userId: event.data.sender.id,
  createdAt: Date.now()
}
```

### 第二步：发送欢迎消息

通过飞书 Open API 以 Bot 身份回复用户，正式开启协作。这条消息同时也是新手引导的入口（详见 [新手引导设计](./2026-03-05-onboarding-guide.md)）。

```javascript
await larkClient.im.message.create({
  receive_id_type: 'chat_id',
  params: {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: '你好老板，我是你的 Oriole 助手...' })
  }
})
```

两步即完成。

## 初始化的幂等性

- Agent 启动时检查 `~/.oriole/settings.json` 是否已有工作台信息
- 如果有，直接加载并开始工作
- 如果没有，等待用户发来第一条消息

不存在重复创建的问题——私聊天然是一对一的，飞书平台保证同一用户与同一 Bot 之间只有一个私聊。

## 与旧设计的对比

| | 旧设计（群聊 + Webhook Bot） | 新设计（私聊 + App Bot） |
|---|---|---|
| 工作台载体 | 普通对话群 | 用户与 Bot 私聊 |
| Agent 身份 | Webhook Bot（只能发消息） | 飞书原生 App Bot（发/回复/编辑） |
| 初始化步骤 | 6 步（建群→建bot→取URL→写描述→置顶→欢迎） | 2 步（记录 chat_id → 欢迎消息） |
| 元数据存储 | 飞书群描述 JSON | 本地 settings.json |
| 认证 | OPENBIRD_COOKIE | APP_ID + APP_SECRET（Open API）+ OPENBIRD_COOKIE（事件） |

## 本地存储策略

`~/.oriole/settings.json` 存储工作台基本信息，作为快速恢复的缓存。即使文件丢失，Agent 重启后收到用户的下一条消息即可重新建立。

## 已确定

- 工作台 = 用户与 Bot 的私聊，不需要手动创建
- 用户发第一条消息即触发初始化
- 飞书 Open API 认证需要 APP_ID + APP_SECRET
- 本地存储仅作缓存，丢失可恢复

## 待讨论

- 是否支持多用户（多个老板各自有独立工作台）
- Bot 是否需要主动给用户发第一条消息（而非等待用户先开口）
- settings.json 的结构是否需要扩展（如存储引导状态、员工手册路径等）
