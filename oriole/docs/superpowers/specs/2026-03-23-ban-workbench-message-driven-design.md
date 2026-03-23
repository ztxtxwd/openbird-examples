# Ban 工作台消息驱动设计

日期：2026-03-23
状态：已确认，可进入规划

## 背景

Oriole 当前已经有以下基础设施：

- 长生命周期的 OpenBird MCP Client，位于 [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js)
- Webhook 接收器，位于 [src/webhook.js](/root/projects/openbird-examples/oriole/src/webhook.js)
- 旧的 `Lin` 流程，位于 [src/lin.js](/root/projects/openbird-examples/oriole/src/lin.js)，用于把工作台外部信号路由成工作台中的事儿

目前 `src/webhook.js` 中工作台分支仍然只是一个占位：

```js
if (chatId === workbench.chatId) {
  console.log('  🔀 → Ban（办）');
  // TODO: implement Ban
}
```

这次设计要落下来的目标模型是：

- 任何与工作台有关的新消息都会触发 `Ban`
- 一次触发只处理一件事
- 这件事就是触发它的那条消息本身
- `Ban` 可使用 OpenBird MCP 暴露出的完整工具面，而不是一个很小的硬编码子集

## 目标

- 将 `Ban` 实现为一个由工作台消息驱动的运行时
- 让 `Ban` 在任何新的工作台消息到达时触发，不区分发送者
- 将每一条触发消息视为一次独立要处理的事
- 允许 `Ban` 在一次运行中连续调用多个 OpenBird MCP 工具
- 让 `Ban` 可以使用 OpenBird MCP Server 的全部工具
- 当 `Ban` 对外界产生真实副作用时，必须在工作台留下可见记录
- 同一工作台线程内串行执行，不同线程之间允许并行执行

## 非目标

- 不重做 `Lin`
- 不引入持久化任务队列
- 不做跨进程的运行恢复
- 不构建复杂的事务生命周期状态机
- 不建立统一的自动重试框架来处理有副作用的操作

## 已确认的产品决策

### 触发规则

- 任何与工作台有关的新消息都会触发 `Ban`
- 发送者是谁不重要
- 根消息和线程内回复都会触发 `Ban`
- `Ban` 自己发回工作台的消息也会触发之后的新一轮 `Ban`

### 工作单元

- 一个 webhook 事件对应一次 `Ban` 运行
- 触发本次运行的工作台消息，就是这一次要处理的一件事
- `Ban` 不需要把一条触发消息拆成多个分别触发的事

### 工具使用

- `Ban` 一次运行中可以调用多个工具
- `Ban` 应该能使用当前连接的 OpenBird Server 暴露出的全部 MCP 工具

### 忽略行为

- `Ban` 可以选择忽略一次触发并静默退出
- 选择忽略时，不需要强制回复可见消息

### 可见记录

- 如果 `Ban` 执行了会对外界产生真实影响的操作，工作台里必须有一条可见记录
- 如果 `Ban` 最终选择忽略，则不要求留下任何可见记录

### 并发规则

- 同一个线程里的消息必须串行执行
- 不同线程之间可以并行执行
- 对于没有 `thread_id` 的根消息，队列键使用该消息自己的 `message_id`

## 推荐方案

采用“直接 agent 执行 + 薄运行时编排层”的方案。

也就是说，agent 仍然直接拿到触发消息、线程上下文以及完整的 OpenBird 工具面；运行时只补上那些不应该完全依赖 prompt 纪律来保证的部分：

- 按线程串行化
- 工作台上下文组装
- 工具调用观测
- 副作用追踪
- agent 忘记留痕时的兜底工作台记录

这样既保留了你要的产品模型，又能让系统在自触发和并发消息到达时保持稳定。

## 高层架构

### 保留的现有模块

- [src/index.js](/root/projects/openbird-examples/oriole/src/index.js) 继续作为进程入口
- [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js) 继续作为唯一的 OpenBird 连接层
- [src/lark.js](/root/projects/openbird-examples/oriole/src/lark.js) 继续作为 Lark Open API 封装
- [src/lin.js](/root/projects/openbird-examples/oriole/src/lin.js) 继续承担工作台外部信号路径

### 新增模块

- `src/ban.js`
  - `Ban` 的公开入口
- `src/ban-dispatcher.js`
  - 队列管理与按线程串行
- `src/ban-runner.js`
  - 单次触发的 `Ban` 执行器
- `src/ban-context.js`
  - 工作台消息和线程上下文组装
- `src/ban-workbench-tools.js`
  - 回写工作台的本地 MCP 工具层

### 对现有模块的改动

- [src/webhook.js](/root/projects/openbird-examples/oriole/src/webhook.js)
  - 将工作台消息路由给 `Ban`
  - 不要在进入工作台路由前，全局过滤掉工作台内的 bot 消息
- [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js)
  - 保留当前长生命周期 OpenBird 连接的行为
  - 移除“只关心少量必需工具”的假设
  - 增加一个适配层，让现有连接好的 OpenBird Client 可以作为 MCP Server 能力挂载到 `Ban` 的 agent 运行时里，而不是再起第二个 OpenBird 进程
- [src/lark.js](/root/projects/openbird-examples/oriole/src/lark.js)
  - 如果现有能力不够，则只补 `Ban` 所需的最小读写接口

## 运行时模型

### 事件路由

1. Webhook 接收到事件
2. 仍然在 webhook 层基于 `event_id` 做去重
3. 通过 `chatId === workbench.chatId` 判断该事件属于工作台还是非工作台
4. 工作台事件进入 `banDispatcher.dispatch(event)`
5. 非工作台事件继续走现有 `Lin` 路径

### 队列键

调度器使用：

- 有 `data.thread_id` 时，使用 `data.thread_id`
- 否则使用 `data.message_id`

这样可以得到：

- 根消息按根消息 id 串行
- 线程回复按线程 id 串行
- 不相关的事之间允许并行执行

### 自触发

`Ban` 自己发到工作台的消息，不在 webhook 层做硬过滤。

而是采用下面的模型：

- 它们和其他工作台消息一样触发新一轮 `Ban`
- 是否还有事情可做，由 agent 自己判断
- 如果最新消息只是回执或状态更新，没有新的待处理信息，`Ban` 应直接忽略

这样才能保留工作台作为“真实用户与 agent 共享沟通空间”的本质。

## 上下文模型

每次 `Ban` 运行拿到的是有边界的上下文，而不是整个工作台历史。

最小上下文集合包括：

- 触发事件原始载荷
- 归一化后的当前消息信息
- 当前线程的消息上下文
- 工作台最近的根消息摘要
- 当前可用的 OpenBird 工具列表

### 线程上下文

对于根消息触发：

- 根消息本身就是这件事的锚点
- 如果 `Ban` 需要留下可见记录，应当回复到这条根消息形成的线程里

对于线程回复触发：

- `Ban` 直接使用现有 `thread_id`
- 所有可见记录都继续留在这个线程里

### 为什么默认写回当前线程

`Ban` 的可见输出默认都应落在当前事所属的线程里，而不是重新发一条平级工作台消息，原因是：

- 执行痕迹会跟着对应的事走
- 工作台主时间线更易读
- 自触发也会自然归入正确的队列键

## 工具体系

`Ban` 拿到两组工具。

### OpenBird 工具

- 暴露当前连接的 OpenBird MCP 完整工具清单
- 复用 [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js) 中现有的 client 连接
- 不为 `Ban` 单独启动第二个 OpenBird 进程
- 运行时要观测所有工具调用和结果

### Workbench 工具

提供一个很小的本地 MCP Server，只负责工作台写操作：

- 在当前线程内回复
- 只有明确需要时才新发一条顶级工作台消息
- 只有明确需要时才编辑最近一条由 `Ban` 发出的状态消息

这组工具的意义是让 agent 有一套一等公民的方式，把必须留下的可见记录写回工作台。

## 副作用与可见记录

### 规则

如果一次 `Ban` 运行对外界产生了真实副作用，工作台必须出现一条可见记录。

### 副作用判定

运行时应采用偏保守的分类方式：

- 任何工作台写操作，都算有副作用
- 任何明显会修改外部状态的 OpenBird 工具，都算有副作用
- 对于拿不准是否只读的 OpenBird 工具，默认按“有副作用”处理

这种保守策略比误判成“无副作用”而漏记工作台要更可靠。

### 首选机制

正常情况下，agent 自己应当在完成外部操作后，于当前线程中写一条自然语言回执。

### 运行时兜底

如果 agent 已经造成了外部副作用，但退出前没有留下可见记录，运行时必须自动补发一条兜底回执。

这条兜底回执至少要说明：

- 已经执行了外部操作
- 哪些动作成功了
- 哪些动作失败了，如果有的话

这样一来，“必须留痕”就从 prompt 里的偏好要求，升级成系统级保证。

## 失败语义

### 在外部操作之前失败

如果一次运行在产生任何真实外部动作之前就失败了：

- `Ban` 应在当前线程写一条简短的失败说明
- 这条说明要明确表明这件事还没有办成

### 在部分外部操作之后失败

如果外部动作已经执行了一部分，随后才失败：

- `Ban` 必须在当前线程写一条可见说明
- 这条说明要区分哪些动作已经完成，哪一步失败了

### 重试

- 默认不自动重试有副作用的操作
- 避免重放那些是否已成功不确定的写操作
- 如果以后需要，可以按工具或错误类型补充更细粒度的重试策略

## Agent Prompt 规则

`Ban` 的 system prompt 应明确写入以下约束：

- 当前触发你的工作台消息，就是这一次要处理的一件事
- 为了处理这件事，你可以连续调用多个工具
- 如果没有事情可做，你可以直接忽略这条消息
- 如果你产生了真实外部副作用，你必须在工作台留下可见记录
- 如果最新消息只是你自己刚发出的回执，没有新的可执行信息，就应直接忽略
- 默认优先在当前线程回复，而不是创建新的顶级工作台消息

## 文件级设计

### `src/ban.js`

- 导出 `Ban` 工厂
- 负责把调度器、运行器、上下文提供者和工作台工具层组装起来

### `src/ban-dispatcher.js`

- 接收 webhook 事件
- 通过 `thread_id ?? message_id` 计算队列键
- 保证同一个队列键上的执行顺序
- 允许不同队列键之间并行

### `src/ban-runner.js`

- 从归一化事件构造一次 `Ban` 执行
- 准备 agent 运行时所需的 prompt 与 options
- 挂载 OpenBird 和 workbench 两组 MCP Server
- 跟踪工具调用、副作用以及本轮是否已经写出可见记录
- 必要时补发兜底回执

### `src/ban-context.js`

- 从 webhook 事件中提取归一化的消息元数据
- 拉取当前线程上下文和最近根消息摘要
- 把零宽字符中隐藏的 id 恢复回 `{{id}}`
- 保持上下文有界且稳定

### `src/ban-workbench-tools.js`

- 创建回写工作台的本地 MCP Server
- 只暴露 `Ban` 所需的最小写操作
- 记录本轮是否已经向工作台写出可见消息

### `src/mcp-client.js`

- 继续作为唯一的 OpenBird 进程客户端
- 暴露实时工具清单
- 为 `Ban` 提供一个适配层，使现有连接可以作为可挂载的 MCP Server 能力暴露出去，而不需要第二个 OpenBird 进程

## 测试策略

第一版实现先只做本地单元测试，不依赖真实 Feishu 或 OpenBird。

### Dispatcher 测试

- 相同 `thread_id` 的事件按顺序串行执行
- 不同 `thread_id` 的事件可以并行执行
- 没有 `thread_id` 的根消息使用 `message_id` 作为队列键

### Context 测试

- 从 webhook 载荷中正确归一化当前消息
- 正确组装线程上下文
- 正确组装最近根消息摘要
- 正确把零宽字符中的隐藏 id 恢复成 `{{id}}`
- 缺少字段或字段格式异常时能平稳降级

### Workbench 工具测试

- 回复消息会被发到当前线程中
- 可见留痕状态能被正确记录
- 若支持编辑，编辑行为只针对 `Ban` 自己的消息

### OpenBird 适配层测试

- OpenBird 的全部工具都会暴露给 `Ban`
- 工具调用会正确转发到现有 `openbird.callTool()`
- 副作用分类按保守规则记录

### Runner 测试

- 忽略路径不会向工作台写消息
- agent 已主动留痕时，不再补发兜底回执
- 已有副作用但未显式留痕时，会补发兜底回执
- 在外部动作前失败和在外部动作后失败，都会写出正确的线程说明

### Webhook 路由测试

- 工作台消息会进入 `Ban`
- 工作台内的 bot 消息不会在进入 `Ban` 前被拦掉
- 非工作台消息仍然进入 `Lin`

## 实现边界

第一版实现做到以下能力即可停止：

- 任何工作台消息都能触发 `Ban`
- `Ban` 在同线程内串行、跨线程并行
- `Ban` 能通过现有 MCP Client 使用完整 OpenBird 工具面
- `Ban` 可以静默忽略一次触发
- `Ban` 只要产生真实外部副作用，就一定会在工作台留下可见记录

第一版实现不尝试以下内容：

- 持久化队列
- 历史重放
- 复杂的动作规划缓存
- 与 `Ban` 无直接关系的大范围 `Lin` 或 thread-context 重构

## 有意延期的问题

以下问题有意留到第一版稳定后再看：

- 长期持久化的执行状态
- 更强的 OpenBird 工具只读/写入静态分类
- 更丰富、更结构化的工作台回执格式
- `Ban` 是否需要引入显式的任务状态词汇

这些都可以在第一版消息驱动 `Ban` 稳定后再继续扩展。
