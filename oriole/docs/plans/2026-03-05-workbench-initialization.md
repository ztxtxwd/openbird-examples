# 工作台初始化设计

> 上游文档：[工作台与事务设计](./2026-02-25-workbench-and-tasks.md)、[通用 Agent 架构设计](./2026-02-25-general-agent-architecture.md)

## 背景

工作台是 Oriole 一切功能的基础设施。在用户首次使用时，需要通过编程自动检测并创建工作台。整个过程对用户来说应该是零配置的——用户不需要手动建群、配机器人、设定时消息。

## 初始化触发

Agent 启动时，首先检查当前用户是否已有工作台。工作台信息存储在飞书侧（群描述中），不依赖本地状态：

1. 查找是否存在符合工作台特征的群聊（如群描述中包含特定标识）
2. 如果找到，提取工作台信息，开始工作
3. 如果未找到，进入初始化流程

## 初始化流程

### 第一步：创建群聊

用 `createGroup` 创建工作台群。

```javascript
const result = await api.createGroup(auth, {
  name: '工作台',
  description: 'Oriole 工作台 - 老板与 Agent 的共享工作空间',
  memberIds: [bossUserId],
  chatMode: 2  // THREAD 模式，每件"事"天然是一个话题
})
const chatId = result.chatId
```

**关于 `chatMode` 的选择**：工作台里的"事"以话题（thread）为载体，THREAD 模式使群聊天然以话题组织信息，与"事"的设计契合。

### 第二步：创建 Webhook 机器人

在工作台群里创建 Webhook 机器人，作为 Agent 的"嘴"——Agent 通过此机器人在工作台中发言。

```javascript
const createResult = await api.createWebhookBot(auth, chatId, 'Oriole', 'Oriole Agent')
const botId = createResult.data.bot_id
```

### 第三步：获取 Webhook 信息

获取机器人的 webhook URL，用于后续 Agent 发送消息。

```javascript
const infoResult = await api.getWebhookBotInfo(auth, botId)
const webhookUrl = infoResult.data.webhook
```

### 第四步：将工作台信息写入飞书侧

工作台的关键信息存储在飞书群描述中，作为 Agent 识别和恢复工作台的依据。不依赖本地持久化——飞书即基础设施。

```javascript
const workbenchMeta = JSON.stringify({
  type: 'oriole-workbench',
  botId,
  webhookUrl,
  createdAt: Date.now(),
  bossUserId
})
await api.patchGroupChat(auth, chatId, {
  description: workbenchMeta
})
```

联系人相关的描述信息存储在飞书备注中，而非本地。

### 第五步：置顶工作台

将工作台群聊置顶，方便老板随时找到。

```javascript
await api.pinSession(auth, chatId)
```

### 第六步：发送欢迎消息

在工作台中发送第一条消息，正式开启老板与 Agent 的协作。这条消息同时也是新手引导的入口（详见 [新手引导设计](./2026-03-05-onboarding-guide.md)）。

## 初始化的幂等性

初始化流程应当是幂等的——如果中途失败（如网络中断），重新执行不会产生重复的群聊或机器人。

策略：
- 创建群聊前先查找是否已有工作台群（通过群描述中的标识判断）
- 群描述中写入了工作台元信息，重启后可从飞书侧恢复全部状态
- 每一步完成后及时将进度写入群描述

## 工作台的防误删

工作台一旦被删除，恢复成本极高（历史"事"、员工手册沉淀等无法找回）。应从预防入手：

- 探索飞书群聊是否支持"禁止解散"或类似的保护机制
- 如果平台不支持，至少在引导中明确告知老板工作台群不可删除

## 本地存储策略

原则上不做本地持久化，飞书是主要基础设施。但如果未来有需要本地缓存的场景（如性能优化、离线访问）：

- 结构化数据用 SQLite
- 非结构化数据用文件存储
- 本地存储仅作为缓存，飞书侧为 source of truth

联系人的描述信息优先存储在飞书备注中。

## 已确定

- 工作台初始化由 Agent 程序自动完成，用户无需手动操作
- 使用现有 API（createGroup、createWebhookBot、getWebhookBotInfo、patchGroupChat、pinSession）即可完成全部流程
- 工作台信息存储在飞书侧（群描述），不依赖本地持久化
- 联系人描述信息存储在飞书备注中
- 工作台群使用 THREAD 模式（`chatMode: 2`），与"事"的话题载体天然契合
- 多设备同步由飞书平台处理，不需要额外设计
- 群聊图标暂不处理，后续再设计

## 待讨论

- 群描述中的工作台元信息格式（JSON？自定义标记？）
- 飞书是否支持防止群聊被解散的能力，以及具体的防误删方案
- 工作台群的识别方式——启动时如何高效找到工作台群（遍历群列表？约定群名？群描述标识？）
