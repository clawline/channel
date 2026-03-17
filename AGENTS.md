# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a Generic WebSocket/Webhook channel plugin for [OpenClaw](https://github.com/openclaw/openclaw). It enables OpenClaw to send/receive messages through WebSocket or Webhook connections, allowing H5 pages to connect directly without depending on third-party platforms.

## Development

This is a TypeScript ESM project. No build step is required - the plugin is loaded directly as `.ts` files by OpenClaw.

```bash
# Install dependencies
npm install

# Type check
npx tsc --noEmit
```

## Architecture

### Entry Point
- `index.ts` - Plugin registration, exports public API

### Core Modules (src/generic/)

**Configuration:**
- `config-schema.ts` - Zod schemas for channel config
- `types.ts` - TypeScript type definitions
- `runtime.ts` - Runtime state management

**Connection & Events:**
- `client.ts` - WebSocket server and client manager
- `monitor.ts` - WebSocket/Webhook event listener, dispatches incoming messages
- `bot.ts` - Message event handler, parses content, dispatches to agent

**Outbound:**
- `send.ts` - Text message sending
- `outbound.ts` - `ChannelOutboundAdapter` implementation
- `reply-dispatcher.ts` - Streaming reply handling

**Utilities:**
- `probe.ts` - Channel health check

### Message Flow

1. `monitor.ts` starts WebSocket server, registers event handlers
2. On `message.receive`, `bot.ts` parses the event
3. Message is dispatched to OpenClaw agent via `reply-dispatcher.ts`
4. Agent responses flow through `outbound.ts` → `send.ts`

### Key Configuration Options

| Option | Description |
|--------|-------------|
| `connectionMode` | `websocket` (default) or `webhook` |
| `wsPort` | WebSocket server port (default: 8080) |
| `wsPath` | WebSocket endpoint path (default: "/ws") |
| `dmPolicy` | `pairing` / `open` / `allowlist` |
| `historyLimit` | Number of history messages for group chats |
| `textChunkLimit` | Maximum characters per message chunk |
