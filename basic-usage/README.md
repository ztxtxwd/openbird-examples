# Basic Usage

Demonstrates the two integration surfaces OpenBird provides:

1. **Webhook server** — receives real-time Feishu messages via HTTP POST
2. **MCP client** — calls Feishu API tools (send message, search, calendar, etc.)

## Setup

```bash
# Install dependencies
npm install

# Copy .env.example and fill in your Feishu cookie
cp .env.example .env
# edit .env → set OPENBIRD_COOKIE
```

### How to get `OPENBIRD_COOKIE`

1. Open [Feishu web client](https://www.feishu.cn/) in your browser
2. Open DevTools → Application → Cookies
3. Copy the full cookie string

## Run

```bash
npm start
```

## What happens

- `openbird-webhook-node` starts an HTTP server on a free port
- OpenBird is spawned as a child process with `OPENBIRD_WEBHOOK_URL` pointing at that server
- The MCP client connects to OpenBird over stdio
- Incoming Feishu messages are printed to the console
- After startup, the available MCP tools are listed, and `get_calendar_events` is called as a demo
