
# Clawline

Generic WebSocket/Relay/Webhook channel plugin for [OpenClaw](https://github.com/openclaw/openclaw).

A flexible channel plugin that allows H5 pages to connect directly or through a relay gateway without depending on third-party platforms. The simplest local path is `websocket`; for public deployments, the recommended path is `relay` plus token auth.

[English](#english) | [中文](#中文)

---

## English

### Installation

```bash
openclaw plugins install @restry/clawline
```

Or install via npm:

```bash
npm install @restry/clawline
```

### Configuration

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"  # or "relay" / "webhook"
    wsPort: 8080
    wsPath: "/ws"
    relay:
      url: "ws://relay.example.com:19080/backend"
      channelId: "demo"
      secret: "replace-me"
    auth:
      enabled: true
      tokenParam: "token"
      users:
        - senderId: "alex"
          chatId: "alex"   # optional legacy fixed-chat binding
          token: "gc_alex_xxxxxxxxx"
          allowAgents: ["main", "writer"]
    dmPolicy: "open"
    historyLimit: 10
    textChunkLimit: 4000
    transcription:
      enabled: true
      pythonPath: "/home/restry/.openclaw/workspace/.venv/bin/python"
      model: "tiny"
```

Or via CLI:

```bash
openclaw config set channels.clawline.enabled true
openclaw config set channels.clawline.connectionMode websocket
openclaw config set channels.clawline.wsPort 8080
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable the generic channel |
| `connectionMode` | enum | `"websocket"` | Connection mode: `"websocket"`, `"relay"`, or `"webhook"` |
| `wsPort` | number | `8080` | WebSocket server port |
| `wsPath` | string | `"/ws"` | WebSocket endpoint path |
| `relay` | object | - | Relay backend config: `url`, `channelId`, `secret`, optional `instanceId` / reconnect timeouts |
| `auth` | object | - | Optional per-user WebSocket token authentication |
| `webhookPath` | string | `"/generic/events"` | Webhook endpoint path |
| `webhookPort` | number | `3000` | Webhook server port |
| `webhookSecret` | string | - | Optional webhook signature secret |
| `dmPolicy` | enum | `"open"` | DM policy: `"open"`, `"pairing"`, or `"allowlist"` |
| `allowFrom` | array | `[]` | Allowed sender IDs (for allowlist policy) |
| `historyLimit` | number | `10` | Number of history messages to keep for group chats |
| `textChunkLimit` | number | `4000` | Maximum characters per message chunk |
| `mediaMaxMb` | number | `30` | Maximum inbound media size in MB |
| `transcription` | object | - | Automatic voice/audio transcription settings |

### Features

#### Core Features
- **Primary Access Paths**: Direct `websocket` is simplest for local/private networks; `relay` is the recommended public deployment path
- **Multi-Client Management**: Support for multiple simultaneous WebSocket connections
- **Multi-Agent Selection**: Clients can list configured agents and explicitly select one per WebSocket session
- **Direct Message & Group Chat**: Handle both DM and group conversations
- **Proactive DM Support**: OpenClaw can send messages without receiving a message first ([docs](docs/PROACTIVE_DM.md))
- **Rich Media Support**: Send and receive images, voice messages, and audio files
- **Thinking Indicators**: Real-time "AI is thinking" status updates
- **Message History**: Configurable history tracking for group chats
- **Access Control**: DM policy (open, pairing, allowlist)
- **Auto Heartbeat**: WebSocket heartbeat for connection health monitoring

#### Advanced WhatsApp-like Features
- **Message Reactions**: Add emoji reactions to messages
- **Message Editing & Deletion**: Edit or delete sent messages with history tracking
- **Read Receipts & Delivery Status**: Track message delivery and read status
- **Enhanced Typing Indicators**: Real-time typing status with auto-timeout
- **Message Forwarding**: Forward messages to other chats (single or multiple)
- **User Status/Presence**: Online/offline/away/busy status with last seen tracking
- **File Sharing with Progress**: File uploads/downloads with real-time progress tracking
- **Message Search**: Full-text search by content, sender, date, and more
- **Group Administration**: Full group management with roles, permissions, and settings
- **Message Pinning & Starring**: Pin important messages (max 3) and bookmark favorites

📖 **See [docs/README.md](docs/README.md) for the current documentation set.**

### Updating the Plugin

#### Method 1: Git clone install (recommended for development)

On the server running OpenClaw Gateway:

```bash
# 1. Pull latest code
cd ~/.openclaw/plugins/clawline
git pull

# 2. Sync to extensions directory
#    ⚠️ CRITICAL — Gateway loads from extensions/, NOT plugins/
rsync -a --delete ~/.openclaw/plugins/clawline/ ~/.openclaw/extensions/clawline/

# 3. Clear jiti transpiler cache (stale cache = old code still running)
rm -rf /tmp/jiti/

# 4. Restart the gateway
systemctl --user restart openclaw-gateway
# or: openclaw gateway restart
```

#### Method 2: npm / openclaw CLI install

```bash
# 1. Update
openclaw plugins install @restry/clawline

# 2. Clear jiti cache
rm -rf /tmp/jiti/

# 3. Restart
systemctl --user restart openclaw-gateway
```

#### ⚠️ Common Pitfalls

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Forgot `rsync plugins/ → extensions/` | Old behavior persists after `git pull` | Run the rsync command |
| Forgot `rm -rf /tmp/jiti/` | Stale transpiled JS is loaded instead of new TS | Delete `/tmp/jiti/` and restart |
| Forgot to restart gateway | Changes not picked up | `systemctl --user restart openclaw-gateway` |
| Edited `plugins/` expecting live reload | No effect — gateway reads `extensions/` | Always rsync after editing |

#### Verifying the Update

After restarting, confirm the gateway is running:

```bash
systemctl --user status openclaw-gateway
# Should show: active (running)
```

Then test from a connected client (e.g., send `/status` or any slash command). If the gateway responds, the update is active.

### Quick Start

1. Enable the Clawline:
```bash
openclaw config set channels.clawline.enabled true
openclaw config set channels.clawline.connectionMode websocket
openclaw config set channels.clawline.wsPort 8080
```

2. Choose one connection path
   - Direct WebSocket: `ws://host:8080/ws`
   - Relay client: `ws://relay-host:19080/client?channelId=demo`

3. Open `examples/h5-client.html` in your browser to test the connection
   - The example page is a static file only. The page opening successfully does **not** mean the Clawline WebSocket is reachable yet.
   - If you use relay mode, put the client endpoint into `serverUrl`, for example `ws://relay-host:19080/client?channelId=demo`.
   - The page stores `serverUrl` / `chatId` / `userName` and connection history in browser `localStorage`; if you previously tested another environment, clear the cached config or reselect the correct history entry before reconnecting.

4. Enter the WebSocket URL (for example `ws://localhost:8080/ws` or `ws://relay-host:19080/client?channelId=demo`), your name, and token if enabled, then click "Connect"
   - `chatId` is now an optional initial conversation. After connection, the client may switch between multiple conversations on the same socket.
   - When auth is enabled, the token always binds the user identity (`senderId`). If the config also sets a legacy fixed `chatId`, that token remains restricted to that one conversation.
   - The example page writes the auth token into the `token` query param. If your server uses a custom token param, put it directly into `serverUrl`.

5. For direct H5 / App / WeChat Mini Program integration, see `docs/INTEGRATION_GUIDE.md`
6. First-time readers should use this order: `README` -> `docs/INTEGRATION_GUIDE.md` -> `docs/CONFIG_EXAMPLES*.md` -> `examples/h5-client.html` -> `[gateway 仓库](https://github.com/clawline/gateway)`

### Relay Gateway

`[clawline/gateway](https://github.com/clawline/gateway)` is a standalone forwarding service for public deployments.

- Plugin backend connects to `/backend`
- Third-party clients connect to `/client`
- `relay-gateway` also provides a simple admin UI for channel/user/token management
- See `[gateway 仓库](https://github.com/clawline/gateway)` for environment variables, health checks, and deployment examples

### Message Protocol

#### Inbound Message (H5 → Server)

```typescript
{
  messageId: string;      // Unique message ID
  chatId: string;         // Chat/conversation ID
  chatType: "direct" | "group";
  senderId: string;       // Sender user ID
  senderName?: string;    // Optional sender display name
  agentId?: string;       // Optional explicit target agent for this message/session
  messageType: "text" | "image" | "voice" | "audio" | "file";
  content: string;        // Message content or caption
  mediaUrl?: string;      // Media URL (for image/voice/audio)
  mimeType?: string;      // MIME type of media
  timestamp: number;      // Unix timestamp
  parentId?: string;      // Optional parent message ID for replies
}
```

### Automatic Voice/Audio Transcription

The plugin can automatically transcribe inbound `voice` and `audio` messages before they are sent to the agent.

Requirements:
- `ffmpeg` must be installed on the gateway host
- The selected Python runtime must have `faster-whisper` installed

Example:

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    transcription:
      enabled: true
      provider: "faster-whisper"
      pythonPath: "/home/restry/.openclaw/workspace/.venv/bin/python"
      model: "tiny"
      device: "cpu"
      computeType: "int8"
      timeoutMs: 120000
```

Behavior:
- `voice` messages are auto-transcribed by default when transcription is enabled
- `audio` messages are also auto-transcribed by default
- The transcript is injected into the agent context as `[Voice transcript]` or `[Audio transcript]`
- If transcription fails, the original media placeholder is still delivered and the message does not fail

#### Outbound Message (Server → H5)

```typescript
{
  messageId: string;      // Unique message ID
  chatId: string;         // Chat/conversation ID
  content: string;        // Message content
  contentType: "text" | "markdown" | "image" | "voice" | "audio";
  mediaUrl?: string;      // Media URL (for image/voice/audio)
  mimeType?: string;      // MIME type of media
  replyTo?: string;       // Optional message ID being replied to
  timestamp: number;      // Unix timestamp
}
```

### WebSocket Events

| Event Type | Description |
|------------|-------------|
| `message.receive` | Inbound message from client |
| `message.send` | Outbound message to client |
| `history.get` | Client requests one conversation's recent history |
| `agent.list.get` | Client asks for the configured agent list |
| `agent.list` | Agent list response |
| `agent.select` | Client selects or clears the current session's agent |
| `agent.selected` | Server confirms the effective agent selection |
| `conversation.list.get` | Client requests the current user's conversation list |
| `conversation.list` | Conversation list response |
| `channel.status.get` | Client asks for lightweight clawline status |
| `channel.status` | Lightweight clawline status response |
| `connection.open` | Connection established |
| `connection.close` | Connection closed |
| `typing` | Typing indicator (optional) |
| `thinking.start` | AI started thinking/processing |
| `thinking.update` | AI thinking status update |
| `thinking.end` | AI finished thinking |

### H5 Client Example

```javascript
// Connect to WebSocket server
let selectedAgentId = 'code';
const token = 'gc_alex_xxxxxxxxx';
const ws = new WebSocket(`ws://localhost:8080/ws?agentId=${encodeURIComponent(selectedAgentId)}&token=${encodeURIComponent(token)}`);

ws.onopen = () => {
  console.log('Connected to Clawline');
  ws.send(JSON.stringify({
    type: 'agent.list.get',
    data: { requestId: 'agent-list-1' }
  }));
  ws.send(JSON.stringify({
    type: 'conversation.list.get',
    data: { requestId: 'conversation-list-1', agentId: selectedAgentId }
  }));
};

// Send a message
const message = {
  type: 'message.receive',
  data: {
    messageId: 'msg-' + Date.now(),
    chatId: 'conv-user-123-main',
    chatType: 'direct',
    senderId: 'user-123',
    senderName: 'Alice',
    agentId: selectedAgentId,
    messageType: 'text',
    content: 'Hello, AI!',
    timestamp: Date.now()
  }
};
ws.send(JSON.stringify(message));

// Receive messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'message.send') {
    console.log('AI Reply:', message.data.content);
  }

  if (message.type === 'channel.status') {
    console.log('Channel Status:', message.data);
  }

  if (message.type === 'agent.list') {
    console.log('Agents:', message.data.agents);
  }

  if (message.type === 'conversation.list') {
    console.log('Conversations:', message.data.conversations);
  }
};
```

Lightweight status query example:

```javascript
ws.send(JSON.stringify({
  type: 'channel.status.get',
  data: {
    requestId: 'status-1',
    includeChats: false
  }
}));
```

### Simple Per-User WebSocket Token Auth

For public or semi-public deployments, you should not expose the WebSocket port without authentication.

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    auth:
      enabled: true
      tokenParam: "token"
      users:
        - id: "alex"
          senderId: "alex"
          chatId: "alex"  # optional legacy fixed-chat binding
          token: "gc_alex_xxxxxxxxx"
          allowAgents: ["main", "writer"]
        - id: "bob"
          senderId: "bob"
          chatId: "bob"  # optional legacy fixed-chat binding
          token: "gc_bob_xxxxxxxxx"
          allowAgents: ["main"]
```

Behavior:
- The client must connect with `?token=...`; `chatId=...` is optional and only selects the initial conversation
- The token is always bound to one configured `senderId`
- If a token also configures `chatId`, that token remains locked to that one conversation
- After connection, the server treats the token-bound `senderId` as authoritative
- If `allowAgents` is set, the client can only select or override to those agents

### FAQ

#### WebSocket connection failed

1. Check if OpenClaw is running
2. Verify the `wsPort` configuration
3. Make sure no other service is using the same port
4. Check firewall settings

#### Messages are not received

1. Verify `channels.clawline.enabled` is set to `true`
2. Check the current `chatId` and selected agent match the conversation you expect to use
3. Review OpenClaw logs for error messages

#### Chat cannot use `sudo` or install software

If the Linux account already has `sudo` rights but chat commands are still blocked, the restriction is usually from OpenClaw exec policy rather than the OS user.

Add the following to `~/.openclaw/openclaw.json` on the gateway host:

```json
{
  "tools": {
    "elevated": {
      "enabled": true,
      "allowFrom": {
        "clawline": ["*"]
      }
    },
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
    }
  }
}
```

Then restart the gateway and enable elevated mode in the chat session:

```bash
openclaw gateway restart
```

```text
/elevated full
```

---

## 中文

### 安装

```bash
openclaw plugins install @restry/clawline
```

或通过 npm 安装：

```bash
npm install @restry/clawline
```

### 配置

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"  # 或 "relay" / "webhook"
    wsPort: 8080
    wsPath: "/ws"
    relay:
      url: "ws://relay.example.com:19080/backend"
      channelId: "demo"
      secret: "replace-me"
    auth:
      enabled: true
      tokenParam: "token"
      users:
        - senderId: "alex"
          chatId: "alex"  # 可选，仅用于兼容旧的一 token 一 chat 模式
          token: "gc_alex_xxxxxxxxx"
          allowAgents: ["main", "writer"]
    dmPolicy: "open"
    historyLimit: 10
    textChunkLimit: 4000
    transcription:
      enabled: true
      pythonPath: "/home/restry/.openclaw/workspace/.venv/bin/python"
      model: "tiny"
```

或通过命令行：

```bash
openclaw config set channels.clawline.enabled true
openclaw config set channels.clawline.connectionMode websocket
openclaw config set channels.clawline.wsPort 8080
```

### 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 启用/禁用通用频道 |
| `connectionMode` | enum | `"websocket"` | 连接模式：`"websocket"`、`"relay"` 或 `"webhook"` |
| `wsPort` | number | `8080` | WebSocket 服务器端口 |
| `wsPath` | string | `"/ws"` | WebSocket 端点路径 |
| `relay` | object | - | Relay 反连配置：`url`、`channelId`、`secret`，以及可选的 `instanceId` / 重连超时参数 |
| `auth` | object | - | 可选的按用户 WebSocket Token 认证配置 |
| `webhookPath` | string | `"/generic/events"` | Webhook 端点路径 |
| `webhookPort` | number | `3000` | Webhook 服务器端口 |
| `webhookSecret` | string | - | 可选的 Webhook 签名密钥 |
| `dmPolicy` | enum | `"open"` | 私聊策略：`"open"`、`"pairing"` 或 `"allowlist"` |
| `allowFrom` | array | `[]` | 允许的发送者 ID 列表（用于 allowlist 策略） |
| `historyLimit` | number | `10` | 群聊保留的历史消息数量 |
| `textChunkLimit` | number | `4000` | 每条消息的最大字符数 |
| `mediaMaxMb` | number | `30` | 入站媒体最大大小，单位 MB |
| `transcription` | object | - | 自动语音/音频转写配置 |

### 功能特性

#### 核心功能
- **主接入路径**：内网/本地调试优先直连 `websocket`，公网部署优先 `relay`
- **多客户端管理**：支持多个 WebSocket 连接同时在线
- **多 Agent 选择**：客户端可以列出服务端已配置 agent，并按连接或按消息显式选择
- **私聊与群聊**：处理私聊和群组对话
- **主动 DM 支持**：OpenClaw 可以主动发送消息，无需先接收消息（[文档](docs/PROACTIVE_DM.md)）
- **富媒体支持**：发送和接收图片、语音消息、音频文件
- **思考指示器**：实时显示"AI 正在思考"状态
- **消息历史**：可配置的群聊历史记录
- **访问控制**：私聊策略（开放、配对、白名单）
- **自动心跳**：WebSocket 心跳保活机制

#### WhatsApp 风格高级功能
- **消息表情反应**：为消息添加表情符号反应
- **消息编辑与删除**：编辑或删除已发送消息，支持历史记录追踪
- **已读回执与送达状态**：追踪消息送达和已读状态
- **增强型输入指示器**：实时输入状态显示，自动超时
- **消息转发**：转发消息到其他聊天（单条或多条）
- **用户状态/在线状态**：在线/离线/离开/忙碌状态，支持最后在线追踪
- **文件分享与进度追踪**：文件上传/下载，实时进度显示
- **消息搜索**：全文搜索，支持按内容、发送者、日期等筛选
- **群组管理**：完整的群组管理，支持角色、权限和设置
- **消息置顶与收藏**：置顶重要消息（最多 3 条）和收藏喜欢的消息

📖 **当前文档入口见 [docs/README.md](docs/README.md)。**

### 更新插件

#### 方式一：git clone 安装（开发推荐）

在运行 OpenClaw Gateway 的服务器上执行：

```bash
# 1. 拉取最新代码
cd ~/.openclaw/plugins/clawline
git pull

# 2. 同步到 extensions 目录
#    ⚠️ 关键 — Gateway 读取的是 extensions/ 而不是 plugins/！
rsync -a --delete ~/.openclaw/plugins/clawline/ ~/.openclaw/extensions/clawline/

# 3. 清除 jiti 编译缓存（不清会继续加载旧代码）
rm -rf /tmp/jiti/

# 4. 重启 Gateway
systemctl --user restart openclaw-gateway
# 或者: openclaw gateway restart
```

#### 方式二：npm / openclaw CLI 安装

```bash
# 1. 更新
openclaw plugins install @restry/clawline

# 2. 清除 jiti 缓存
rm -rf /tmp/jiti/

# 3. 重启
systemctl --user restart openclaw-gateway
```

#### ⚠️ 常见踩坑

| 错误操作 | 现象 | 解决方法 |
|---------|------|---------|
| 忘了 `rsync plugins/ → extensions/` | `git pull` 后行为没变 | 执行上面的 rsync 命令 |
| 忘了 `rm -rf /tmp/jiti/` | 加载的仍然是旧的编译缓存 | 删除 `/tmp/jiti/` 后重启 |
| 忘了重启 Gateway | 改动未生效 | `systemctl --user restart openclaw-gateway` |
| 直接改 `plugins/` 期望热更新 | 无效果 — Gateway 读取的是 `extensions/` | 改完后必须 rsync |

#### 验证更新是否生效

重启后确认 Gateway 运行正常：

```bash
systemctl --user status openclaw-gateway
# 应显示: active (running)
```

然后从已连接的客户端测试（比如发送 `/status` 或任意斜杠命令）。如果 Gateway 有响应，说明更新已生效。

### 快速开始

1. 启用通用频道：
```bash
openclaw config set channels.clawline.enabled true
openclaw config set channels.clawline.connectionMode websocket
openclaw config set channels.clawline.wsPort 8080
```

2. 先选连接方式
   - 直连 WebSocket：`ws://host:8080/ws`
   - Relay 客户端入口：`ws://relay-host:19080/client?channelId=demo`

3. 如果你是第三方集成方，直接看 `docs/INTEGRATION_GUIDE.md` 里的“`0. 快速接入`”

4. 如果你只是想先 smoke test，再在浏览器中打开 `examples/h5-client.html` 测试连接
   - 输入 WebSocket URL（如 `ws://localhost:8080/ws` 或 `ws://relay-host:19080/client?channelId=demo`）、名称；如果服务端启用了认证，再输入 token，然后点击"连接"
   - 示例页的 token 输入框只会写入 `token` 查询参数。如果你服务端用了自定义 token 参数名，请直接把它写进 `serverUrl`

5. H5 / 聊天 App / 微信小程序的真实接入方式见 `docs/INTEGRATION_GUIDE.md`
6. 第一次接入建议按 `README -> docs/INTEGRATION_GUIDE.md -> docs/CONFIG_EXAMPLES_ZH.md -> examples/h5-client.html -> [gateway 仓库](https://github.com/clawline/gateway)` 的顺序阅读

### 接入说明

- 当前真实配置键是 `channels.clawline`
- 当前 H5 参考实现只有 `examples/h5-client.html`
- 客户端可以直连 `ws://host:port/ws`，也可以连 relay 客户端入口 `ws://relay-host:19080/client?channelId=demo`
- relay 模式下，插件主动反连 `/backend`，第三方客户端只连 `/client`
- 如果启用了简单认证，再额外带上 `token`
- `chatId` 现在代表“会话 / 线程 / 群聊房间”，可以在连接建立后按消息或按会话切换，不再要求一个 token 固定只聊一个 chat
- 如果服务端配置了多个 agent，客户端可通过 `agent.list.get` / `agent.select` 列出并切换 agent，也可在建连时额外带 `agentId`
- 客户端可以通过 `conversation.list.get` 拉当前用户在当前 agent 视角下的会话列表，再通过 `history.get` 拉指定会话的历史消息
- 如果当前连接显式选择了 `agentId`，建连后的 `history.sync` 和后续 `history.get` 都会按 `chatId + agentId` 过滤，避免固定 `chatId` 场景下不同 agent 的历史串在一起
- 远端真实验证已确认：同一个 token 用户可以在单一 WebSocket 连接里切换多个 `chatId`，并且旧的固定 `chatId` token 仍会被限制在原会话
- 客户端发消息时统一发送 `type: "message.receive"`
- `parentId` / `replyTo` 的引用回复协议已支持，但当前 H5 示例页没有现成引用回复 UI
- `reaction.add` / `reaction.remove` 的 emoji reaction 协议已支持，但当前 H5 示例页没有 reaction UI
- 图片、音频、语音都通过 `mediaUrl + mimeType + messageType` 传入
- 多用户并发场景建议把 `session.dmScope` 设为 `per-account-channel-peer`

### Relay 网关

`[clawline/gateway](https://github.com/clawline/gateway)` 是用于公网部署的独立中转服务。

- 插件主动反连 `/backend`
- 第三方客户端连接 `/client`
- `relay-gateway` 还提供一个简单管理页，可维护 channel、用户和 token
- 环境变量、健康检查和部署示例见 `[gateway 仓库](https://github.com/clawline/gateway)`

### 自动语音/音频转写

插件可以在把消息交给 agent 之前，自动把传入的 `voice` / `audio` 媒体先转成文本。

前置条件：
- gateway 主机已安装 `ffmpeg`
- 所配置的 Python 运行时里已安装 `faster-whisper`

示例配置：

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    transcription:
      enabled: true
      provider: "faster-whisper"
      pythonPath: "/home/restry/.openclaw/workspace/.venv/bin/python"
      model: "tiny"
      device: "cpu"
      computeType: "int8"
      timeoutMs: 120000
```

行为说明：
- 开启后默认自动转写 `voice`
- 开启后默认也会自动转写 `audio`
- 转写文本会以 `[Voice transcript]` 或 `[Audio transcript]` 注入给 agent
- 如果转写失败，消息不会失败，插件仍会继续把原始媒体占位符传给 agent

### 简单的一用户一 Token 鉴权

如果端口会暴露到公网或半公网，建议至少开启 WebSocket token 认证。

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    auth:
      enabled: true
      tokenParam: "token"
      users:
        - id: "alex"
          senderId: "alex"
          chatId: "alex"  # 可选，仅用于兼容旧的一 token 一 chat 模式
          token: "gc_alex_xxxxxxxxx"
          allowAgents: ["main", "writer"]
        - id: "bob"
          senderId: "bob"
          chatId: "bob"  # 可选，仅用于兼容旧的一 token 一 chat 模式
          token: "gc_bob_xxxxxxxxx"
          allowAgents: ["main"]
```

行为说明：

- 客户端连接时必须带上 `?token=...`
- 每个 token 一定绑定一个 `senderId`
- 如果某个 token 还额外配置了 `chatId`，它就会继续被限制在这个固定会话里
- 连接建立后，服务端会以 token 绑定的 `senderId` 为准，不再信任前端自报值
- 如果配置了 `allowAgents`，客户端只能选择这些 agent

### 常见问题

#### WebSocket 连接失败

1. 检查 OpenClaw 是否正在运行
2. 验证 `wsPort` 配置
3. 确保没有其他服务占用相同端口
4. 检查防火墙设置

#### 消息无法接收

1. 确认 `channels.clawline.enabled` 设置为 `true`
2. 检查连接 URL 中的 `chatId` 是否正确
3. 查看 OpenClaw 日志是否有错误信息

#### 聊天里无法使用 `sudo` 或安装软件

如果 Linux 账户本身已经有 `sudo` 权限，但聊天里执行命令仍然被拒，通常不是系统权限问题，而是 OpenClaw 的 exec / elevated 策略没有放开。

在 gateway 主机的 `~/.openclaw/openclaw.json` 中加入：

```json
{
  "tools": {
    "elevated": {
      "enabled": true,
      "allowFrom": {
        "clawline": ["*"]
      }
    },
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
    }
  }
}
```

然后重启 gateway，并在聊天会话里打开提权：

```bash
openclaw gateway restart
```

```text
/elevated full
```

---

## License

MIT
