# CLAUDE.md

Guidance for Claude Code and AI assistants working with this repository.

## Project Overview

**Clawline** (`@restry/clawline`) is a generic WebSocket/Relay/Webhook channel plugin for [OpenClaw](https://github.com/openclaw/openclaw), an AI agent platform. It enables H5 pages, chat apps, and other clients to connect to OpenClaw without third-party platform dependencies.

- **Language**: TypeScript (ESM)
- **Version**: 2.0.0
- **License**: MIT
- **Peer dependency**: `openclaw >= 2026.3.0`

## Quick Commands

```bash
npm install          # Install dependencies
npm run typecheck    # Type-check (tsc --noEmit) - run this before committing
node test-generic.js # Basic integration test
```

There is **no build step** - `.ts` files are loaded directly by OpenClaw's plugin runtime.

## Repository Structure

```
index.ts                    # Plugin entry point, exports public API
setup-entry.ts              # Setup-time plugin entry
openclaw.plugin.json        # Plugin metadata for OpenClaw
test-generic.js             # Integration test
tsconfig.json               # TypeScript config (ES2022, NodeNext, strict: false)
examples/
  h5-client.html            # Full-featured HTML5 WebSocket client for testing
docs/                       # User-facing documentation (EN + ZH)
src/generic/                # All core implementation (~35 files)
```

### Core Modules (`src/generic/`)

| Module | Responsibility |
|--------|---------------|
| `channel.ts` | Channel plugin definition, capabilities declaration |
| `config-schema.ts` | Zod validation schemas for all configuration |
| `types.ts` | TypeScript type definitions for messages and events |
| `client.ts` | WebSocket server lifecycle and client connection management |
| `monitor.ts` | WebSocket/Webhook event listener, inbound message dispatch |
| `bot.ts` | Message event handler, parses content, routes to agent |
| `outbound.ts` | `ChannelOutboundAdapter` - sends agent responses to clients |
| `send.ts` | Text and media message sending to WebSocket clients |
| `reply-dispatcher.ts` | Streaming reply handling |
| `runtime.ts` | Runtime state management (shared state singleton) |
| `auth.ts` | Token-based authentication for WebSocket connections |
| `relay-protocol.ts` | Relay gateway communication protocol |
| `history.ts` | Message history tracking and retrieval |
| `agents.ts` | Agent listing, selection, and management |
| `probe.ts` | Channel health check endpoint |
| `errors.ts` | Structured error definitions with error codes |

**Advanced feature modules** (WhatsApp-like capabilities):
`media.ts`, `transcription.ts`, `message-management.ts`, `message-status.ts`, `reactions.ts`, `forwarding.ts`, `presence.ts`, `typing.ts`, `pins-stars.ts`, `groups.ts`, `file-transfer.ts`, `search.ts`, `status.ts`, `stream-state.ts`, `suggestions.ts`, `tool-events.ts`

## Architecture

### Message Flow

1. **Inbound**: `monitor.ts` accepts WebSocket connections and registers event handlers
2. **Parse**: `bot.ts` parses the incoming message event and extracts content
3. **Dispatch**: Message is routed to the OpenClaw agent via `reply-dispatcher.ts`
4. **Outbound**: Agent response flows through `outbound.ts` -> `send.ts` -> WebSocket client

### Connection Modes

- **`websocket`** (default) - Direct WebSocket connection for local/internal networks
- **`relay`** - Gateway-based routing for public deployments
- **`webhook`** - HTTP POST event delivery

### Agent Isolation

Messages are tagged with `agentId` to prevent cross-talk between agents. The `outbound.ts` adapter extracts `agentId` from outbound context and routes responses only to the originating client/agent session. This is a critical invariant - never use `broadcast()` for agent responses.

### DM Policy

- `open` - Any client can message any agent
- `pairing` - One client paired to one agent
- `allowlist` - Only pre-configured senders allowed

## Coding Conventions

### Style

- **No linter/formatter configured** - follow existing code style
- **camelCase** for functions and variables
- **PascalCase** for types, interfaces, and schemas
- **`generic` prefix** on all public exports (e.g., `genericPlugin`, `sendMessageGeneric`, `monitorGenericProvider`)
- ESM imports with **`.js` extension** (required by NodeNext module resolution, even for `.ts` files)
- Zod schemas for runtime validation at all configuration boundaries

### TypeScript

- `strict: false`, `noImplicitAny: false` - the project does not enforce strict mode
- Target: ES2022, Module: NodeNext
- No build emit - type checking only (`noEmit: true`)
- Use `.js` extensions in all import paths (TypeScript + NodeNext convention)

### Error Handling

- Use structured error types from `errors.ts` with specific error codes
- Broadcast `status.failed` WebSocket events to clients when operations fail
- Prefer throwing descriptive errors over silent failures

### Module Organization

- One module per feature area (reactions, typing, presence, etc.)
- Each module exports: action functions, broadcast helpers, event handlers, and types
- All public API is re-exported through `index.ts`

## Configuration

All config is validated via Zod schemas in `config-schema.ts`. The master schema is `GenericChannelConfigSchema` with `.strict()` mode (no additional properties allowed).

Key config fields: `connectionMode`, `wsPort`, `wsPath`, `auth`, `relay`, `dmPolicy`, `historyLimit`, `textChunkLimit`, `mediaMaxMb`, `transcription`.

## Testing

- **Integration test**: `node test-generic.js` - validates imports, config schemas, message structures, capabilities
- **E2E test cases**: Documented in `docs/E2E_TEST_CASES.md` (manual test matrix, 50+ cases)
- **Interactive testing**: Open `examples/h5-client.html` in a browser, connect to a running instance
- **No automated unit test framework** (no Jest/Vitest) - type-check is the primary automated validation

## Documentation

| File | Content |
|------|---------|
| `README.md` | Main docs, installation, features (EN + ZH) |
| `AGENTS.md` | AI agent guidance (for Codex) |
| `docs/setup.md` | Installation and configuration guide |
| `docs/INTEGRATION_GUIDE.md` | Third-party integration guide |
| `docs/PROACTIVE_DM.md` | Proactive direct messaging |
| `docs/CONFIG_EXAMPLES.md` | Config examples (EN) |
| `docs/CONFIG_EXAMPLES_ZH.md` | Config examples (ZH) |
| `docs/E2E_TEST_CASES.md` | End-to-end test case matrix |

## Common Tasks

### Adding a new feature module

1. Create `src/generic/<feature>.ts`
2. Export action functions, broadcast helpers, event handlers, and types
3. Re-export the public API from `index.ts`
4. Register WebSocket event handlers in `monitor.ts` if the feature has inbound events
5. Run `npm run typecheck` to verify

### Modifying configuration

1. Add/update Zod schema in `config-schema.ts` (keep `.strict()`)
2. Update the `GenericChannelConfigSchema` object
3. Update `docs/CONFIG_EXAMPLES.md` and `docs/setup.md` with new options

### Debugging

- The H5 client (`examples/h5-client.html`) is the primary interactive debugging tool
- WebSocket messages are JSON - inspect with browser dev tools or wscat
- Agent isolation issues manifest as messages appearing in wrong client sessions
