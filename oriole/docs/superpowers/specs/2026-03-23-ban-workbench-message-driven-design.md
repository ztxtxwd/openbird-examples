# Ban Workbench Message-Driven Design

Date: 2026-03-23
Status: Approved for planning

## Context

Oriole currently has:

- a long-lived OpenBird MCP client in [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js)
- a webhook receiver in [src/webhook.js](/root/projects/openbird-examples/oriole/src/webhook.js)
- a legacy `Lin` flow in [src/lin.js](/root/projects/openbird-examples/oriole/src/lin.js) for routing external signals into workbench matters

The workbench branch in `src/webhook.js` is still a stub:

```js
if (chatId === workbench.chatId) {
  console.log('  🔀 → Ban（办）');
  // TODO: implement Ban
}
```

The intended model is:

- any new message related to the workbench triggers `Ban`
- one trigger handles exactly one thing
- the thing is the triggering message itself
- `Ban` may use the full OpenBird MCP tool surface, not a small hardcoded subset

## Goals

- Implement `Ban` as a workbench-message-driven runtime
- Trigger `Ban` on any new workbench message, regardless of sender
- Treat each triggering message as one thing to handle
- Allow `Ban` to call multiple OpenBird MCP tools during one run
- Expose all OpenBird MCP tools to `Ban`
- Record visible workbench output whenever `Ban` causes real external side effects
- Run messages in the same workbench thread serially while allowing different threads to run concurrently

## Non-Goals

- Redesign `Lin`
- Introduce a persistent job queue
- Introduce cross-process recovery for in-flight runs
- Build a complex matter lifecycle state machine
- Add a centralized automatic retry framework for side-effecting operations

## Confirmed Product Decisions

### Triggering

- Any new message related to the workbench triggers `Ban`
- Sender does not matter
- Root messages and thread replies both trigger `Ban`
- `Ban`'s own workbench messages also trigger future `Ban` runs

### Unit of Work

- One webhook event corresponds to one `Ban` run
- The triggering workbench message is the one thing being handled
- `Ban` does not need to split one triggering message into multiple separately triggered matters

### Tool Use

- `Ban` can call multiple tools in one run
- `Ban` should have access to all OpenBird MCP tools exposed by the connected OpenBird server

### Ignore Behavior

- `Ban` may choose to ignore a trigger and exit silently
- Ignoring does not require any visible reply

### Visible Record

- If `Ban` performs any operation that has real external effect, the workbench must contain a visible record of that action
- If `Ban` ignores the trigger, no visible record is required

### Concurrency

- Messages in the same thread must execute serially
- Different threads may execute concurrently
- For root messages without a `thread_id`, the queue key is the message's own `message_id`

## Recommended Approach

Use direct agent execution with a thin runtime layer.

The agent still receives the triggering message, thread context, and the full OpenBird tool surface. The runtime adds only the controls that should not be left to prompt discipline alone:

- per-thread serialization
- workbench context assembly
- tool-call observation
- side-effect tracking
- fallback workbench logging if the agent forgets to leave a visible record

This preserves the desired product model while keeping the system stable under self-triggering and concurrent message arrival.

## High-Level Architecture

### Existing Modules to Keep

- [src/index.js](/root/projects/openbird-examples/oriole/src/index.js) remains the process entrypoint
- [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js) remains the only OpenBird connection layer
- [src/lark.js](/root/projects/openbird-examples/oriole/src/lark.js) remains the Lark Open API wrapper
- [src/lin.js](/root/projects/openbird-examples/oriole/src/lin.js) remains the external-signal path

### New Modules

- `src/ban.js`
  - public entrypoint for Ban creation
- `src/ban-dispatcher.js`
  - queueing and per-thread serialization
- `src/ban-runner.js`
  - one-trigger Ban execution
- `src/ban-context.js`
  - workbench message and thread context assembly
- `src/ban-workbench-tools.js`
  - local MCP tools for writing back into the workbench

### Changes to Existing Modules

- [src/webhook.js](/root/projects/openbird-examples/oriole/src/webhook.js)
  - route workbench messages into `Ban`
  - do not globally drop workbench bot messages before routing
- [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js)
  - keep the current long-lived OpenBird connection behavior
  - remove the assumption that only a small required tool list matters
  - add an adapter surface so the connected OpenBird client can be mounted into Ban's agent runtime as an MCP server using the existing connection
- [src/lark.js](/root/projects/openbird-examples/oriole/src/lark.js)
  - add only the minimum read/write helpers Ban needs if current methods are insufficient

## Runtime Model

### Event Routing

1. Webhook receives an event
2. Event deduplication still happens at the webhook layer using `event_id`
3. Event is identified as workbench or non-workbench using `chatId === workbench.chatId`
4. Workbench events go to `banDispatcher.dispatch(event)`
5. Non-workbench events continue to use the existing `Lin` path

### Queue Key

The dispatcher uses:

- `data.thread_id` when present
- otherwise `data.message_id`

This produces:

- root-message serialization by root message id
- thread-reply serialization by thread id
- parallel execution across unrelated matters

### Self-Triggering

`Ban`-generated workbench messages are not blocked at the webhook layer.

Instead:

- they trigger a new `Ban` run like any other workbench message
- the agent decides whether there is anything left to do
- if the newest message is only a receipt or status update with no new work, `Ban` should ignore it

This preserves the workbench as a shared conversation space between humans and agents.

## Context Model

Each Ban run receives bounded context, not the entire workbench history.

The minimum context bundle is:

- the triggering event payload
- normalized current message details
- the current thread transcript
- a recent root-message summary from the workbench
- the available OpenBird tool list

### Thread Context

For a root-triggered message:

- the root message is the matter anchor
- Ban replies into that same thread if it needs to leave a visible record

For a thread-reply-triggered message:

- Ban uses the existing `thread_id`
- visible records stay in that thread

### Why Thread-Scoped Output

All visible Ban output should default to the current matter thread instead of posting a new top-level workbench message because:

- execution history stays attached to the matter it belongs to
- the workbench timeline remains readable
- self-triggering continues to be scoped to the correct queue key

## Tool Surface

Ban gets two tool groups.

### OpenBird Tools

- Expose the full connected OpenBird MCP tool list
- Reuse the existing client connection from [src/mcp-client.js](/root/projects/openbird-examples/oriole/src/mcp-client.js)
- Do not start a second OpenBird process just for Ban
- Observe all tool calls and results during the run

### Workbench Tools

Provide a very small local MCP server for workbench writes:

- reply in the current thread
- create a new top-level workbench message only when explicitly needed
- edit a recent Ban-generated status message only when explicitly needed

These tools exist so the agent has a first-class way to leave required visible records inside the workbench.

## Side Effects and Visible Records

### Rule

If a Ban run causes real external effects, the workbench must contain a visible record.

### Side-Effect Classification

The runtime should conservatively classify tool calls:

- any workbench write is side-effecting
- any clearly mutating OpenBird tool is side-effecting
- any uncertain OpenBird tool should default to side-effecting

This conservative rule is preferable to accidentally hiding real actions from the workbench.

### Primary Mechanism

The agent should normally leave its own natural-language receipt in the current thread after performing external work.

### Runtime Fallback

If the agent has already caused external side effects but exits without leaving a visible record, the runtime must post a fallback receipt automatically.

The fallback receipt should minimally state:

- that external work was performed
- which actions succeeded
- which actions failed, if any

This turns "must leave a record" into a system guarantee rather than a prompt-only preference.

## Failure Semantics

### Before External Work

If the run fails before any real external action occurs:

- Ban should post a short failure note in the current thread
- the note should make it clear that the thing was not completed

### After Partial External Work

If some external actions have already happened and the run later fails:

- Ban must post a visible note in the current thread
- the note should distinguish completed actions from the step that failed

### Retries

- Do not automatically retry side-effecting operations by default
- Avoid replaying uncertain write actions
- Retrying can be added later per tool or per error class if needed

## Agent Prompt Rules

Ban's system prompt should encode these rules explicitly:

- the triggering workbench message is the one thing to handle in this run
- you may call multiple tools to handle it
- you may ignore the message if there is no work to do
- if you cause real external effects, you must leave a visible workbench record
- if the newest workbench message is only your own receipt with no new actionable information, ignore it
- prefer replying inside the current thread rather than creating a new top-level workbench message

## File-Level Design

### `src/ban.js`

- exports the Ban factory
- wires dispatcher, runner, context provider, and workbench tool layer together

### `src/ban-dispatcher.js`

- accepts webhook events
- computes queue keys from `thread_id ?? message_id`
- guarantees in-order execution per queue key
- allows concurrent execution across different queue keys

### `src/ban-runner.js`

- builds one Ban execution from a normalized event
- prepares prompt and options for the agent runtime
- mounts the OpenBird and workbench MCP servers
- tracks tool calls, side effects, and whether visible logging happened
- posts fallback receipts when needed

### `src/ban-context.js`

- extracts normalized message metadata from webhook events
- fetches current thread context and recent root-message summaries
- restores hidden ids embedded with zero-width markers
- keeps context bounded and stable

### `src/ban-workbench-tools.js`

- creates the local MCP server for workbench writes
- exposes only the minimal write operations Ban needs
- records whether a visible workbench message was written during the run

### `src/mcp-client.js`

- remains the sole OpenBird process client
- exposes the live tool inventory
- adds an adapter for Ban so the existing connection can be surfaced as a mountable MCP server without creating a second OpenBird process

## Testing Strategy

The initial implementation should be covered with local unit tests only. No live Feishu or OpenBird calls are required.

### Dispatcher Tests

- same `thread_id` runs serially
- different `thread_id` values can run concurrently
- root messages without `thread_id` use `message_id` as the queue key

### Context Tests

- current message normalization from webhook payloads
- thread transcript assembly
- recent root-message summary assembly
- zero-width hidden id restoration back to `{{id}}`
- graceful behavior on missing or malformed message fields

### Workbench Tool Tests

- replies are posted into the current thread
- visible logging state is tracked correctly
- editing is limited to Ban-owned messages when applicable

### OpenBird Adapter Tests

- all OpenBird tools are exposed to Ban
- tool calls forward to the existing `openbird.callTool()`
- side-effect classification is recorded conservatively

### Runner Tests

- ignore path leaves no workbench output
- agent-side visible logging suppresses fallback logging
- side effects without explicit logging trigger fallback logging
- failures before and after external work produce the correct thread note

### Webhook Routing Tests

- workbench messages route into Ban
- workbench bot messages are not dropped before Ban sees them
- non-workbench messages still route to Lin

## Implementation Boundaries

The first implementation should stop after these capabilities are working:

- any workbench message triggers Ban
- Ban is serialized per thread and concurrent across threads
- Ban can use the full OpenBird tool list from the existing MCP client
- Ban may ignore triggers silently
- Ban always leaves a visible workbench record when real external effects occur

The first implementation should not attempt:

- durable queue persistence
- historical replay
- complex action planning caches
- broad refactors of Lin or thread-context code unrelated to Ban

## Open Questions Deferred Intentionally

The following are explicitly deferred:

- long-term durable execution state
- stronger static classification of which OpenBird tools are read-only
- richer structured receipts in the workbench
- whether Ban should later gain explicit task-state vocabulary

These can be revisited after the first message-driven Ban runtime is stable.
