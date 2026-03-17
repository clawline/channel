# Clawline 接入指南

面向第三方接入方：H5 页面、聊天 App、uni-app、Taro、微信小程序如何接入 `clawline`，把前端会话接到 OpenClaw。

两条已验证的接入路径：

- `websocket` 直连 — 适合本地 / 内网调试
- `relay` 转发 — 适合公网 / 半公网部署

## 0. 快速接入

### 0.1 最短路径

1. 服务端开启 `channels.clawline`
2. 本地/内网调试时，客户端直连 `ws://host:port/ws`
3. 公网部署时，插件改成 `connectionMode: "relay"`，客户端连接 `ws://relay-host:19080/client?channelId=<channelId>`
4. 客户端发送 `message.receive`
5. 客户端处理 `connection.open`、`history.sync`、`message.send`
6. 如果启用了 token 认证，连接 URL 额外带 `token`
7. 如果服务端配置了多个 agent，可选接 `agent.list.get` / `agent.select`

### 0.2 服务端最小配置

直连 WebSocket：

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    dmPolicy: "open"
    historyLimit: 20
```

relay 模式：

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "relay"
    relay:
      url: "ws://127.0.0.1:19080/backend"
      channelId: "demo"
      secret: "replace-me"
      instanceId: "openclaw-sg-1"
    # relay 模式下认证由 relay gateway 负责，插件侧不需要配 auth。
    # 用户/token 配在 relay gateway（RELAY_CHANNELS_JSON 或管理页）。
```

`relay-gateway` 最小环境变量：

```bash
RELAY_PORT=19080
RELAY_CHANNELS_JSON='{"demo":{"secret":"replace-me"}}'
```

直连但要给外部用，至少开 token 认证：

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
        - senderId: "user-42"
          token: "gc_user42_xxxxxxxxx"
          allowAgents: ["main", "code"]
```

`allowAgents` 留空表示不限制 agent；显式写 `["*"]` 也表示允许所有。

多用户并发时建议加上会话隔离，否则不同用户可能串到同一个 DM 线程：

```yaml
session:
  dmScope: "per-account-channel-peer"
```

### 0.3 客户端最小示例

```javascript
const ws = new WebSocket("ws://localhost:18080/ws?token=gc_user42_xxxxxxxxx");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "message.receive",
    data: {
      messageId: "msg-" + Date.now(),
      chatId: "conv-10001",
      chatType: "direct",
      senderId: "user-42",
      senderName: "Leway",
      messageType: "text",
      content: "你好",
      timestamp: Date.now()
    }
  }));
};

ws.onmessage = (event) => {
  const packet = JSON.parse(event.data);
  if (packet.type === "message.send") {
    console.log("AI 回复:", packet.data.content);
  }
};
```

H5 示例页还支持直接导入完整连接地址：

- `ws://host:18080/ws?chatId=xxx&token=xxx&senderId=xxx`
- `openclaw://connect?serverUrl=ws://...&token=xxx&chatId=xxx&name=xxx`

客户端会自动拆出 `serverUrl`、`token`、`chatId`、用户名称，并支持一键连接或扫码导入。URL 里带了 `agentId` 时首次连接也会自动带上。

### 0.4 先记住这几个规则

- `chatId` = 这条消息属于哪个会话
- `senderId` = 当前是谁在发言
- `token` 绑定的是用户身份，不默认绑定固定 `chatId`
- `channelId` = relay 网关的路由键，直连模式不需要
- 同一用户连接后可在一个 WebSocket 里切换多个 `chatId`，不需要断线重连
- 如果连接选中了 `agentId`，`history.sync` 和 `history.get` 会按 `chatId + agentId` 过滤
- `examples/h5-client.html` 是参考页，不是协议规范本身
- relay 模式下客户端只连 `/client`，不能连 `/backend`

### 0.5 直连 vs relay：客户端视角

两种模式的消息格式和事件类型完全一致，客户端不需要写两套代码。区别在连接方式和认证。

#### 连接地址

| 模式 | 连接 URL | 说明 |
|------|----------|------|
| 直连 | `ws://host:18080/ws` | 直接连插件 WebSocket 端口 |
| relay | `ws://relay-host:19080/client?channelId=demo` | 连 relay 网关客户端入口 |

#### 认证与 `senderId` 信任

| 场景 | `senderId` 被信任？ | 实际生效的 `senderId` |
|------|---------------------|----------------------|
| 直连 + 无 auth | ✅ 完全信任 | 客户端自报的值 |
| 直连 + 有 auth | ❌ 被覆盖 | 服务端按 token 查出来的值 |
| relay + gateway 认证通过 | ❌ 被覆盖 | relay gateway 传给插件的值 |

直连不开 auth 时，任何人都可以声称自己是任意用户，仅适合本地调试。

relay 模式的认证由 gateway 负责，插件侧通常不需要配 `auth` 块。两边作用相同但只需配一边。

#### 推荐选择

- **本地调试 / 内网**：直连最简单
- **公网 / 半公网**：用 relay，不暴露插件端口
- **直连但对外**：至少开 `auth`

### 0.6 H5 示例页排障

页面能打开只代表静态服务正常，不代表 WebSocket 可连。排查顺序：

1. 确认页面通过静态文件服务打开（如 `python3 -m http.server 4173`）
2. 确认 `serverUrl` 是真实 WebSocket 端点
   - 直连：`ws://host:18080/ws`
   - relay：`ws://relay-host:19080/client?channelId=demo`
3. 启用了 token 认证时确认 token 和用户对应正确
4. 检查浏览器 `localStorage`（H5 示例页会缓存 `serverUrl`、`chatId`、`userName`，但 `token` 不缓存）
5. 连通信号：状态变"已连接"、控制台出现 `connection.open` 和 `history.sync`

## 1. 服务端补充配置

0.2 的最小配置已能跑通。本节补充公网部署、TLS、转写等进阶配置。

注意真实频道 ID 是 `clawline`，不是 `generic`。

### 公网 relay + TLS

推荐架构：

- `relay-gateway` 只监听回环（`RELAY_HOST=127.0.0.1`）
- Caddy / Nginx 反代提供 `wss://`
- OpenClaw 插件连本机 `ws://127.0.0.1:18080/backend`
- 客户端只连 `wss://relay-host/client?channelId=demo`

如果你的前端页面跑在 `https://`，WebSocket 入口必须是 `wss://`，浏览器不允许从 HTTPS 页面连 `ws://`。

最小 Caddyfile：

```caddyfile
{
  email ops@example.com
}

relay.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:18080
}
```

管理页（`http://relay-host:19080/admin` 或 TLS 后 `https://relay-host/admin`）支持：

- 展示 backend 在线状态和客户端连接数
- 配置 channel secret
- 配置用户、token、`chatId` 绑定和 `allowAgents`

### 语音 / 音频转写

```yaml
channels:
  clawline:
    transcription:
      enabled: true
      provider: "faster-whisper"
      pythonPath: "/path/to/.venv/bin/python"
      model: "tiny"
      device: "cpu"
      computeType: "int8"
      timeoutMs: 120000
```

前置条件：gateway 主机已装 `ffmpeg`，Python 里已装 `faster-whisper`。

开启后 `voice` 和 `audio` 消息会自动转写，结果注入 agent 上下文，客户端无需改协议。

## 2. 身份字段

| 字段 | 作用 | 说明 |
|------|------|------|
| `serverUrl` | WebSocket 地址 | 直连 `ws://host:18080/ws`；relay `ws://relay-host:19080/client?channelId=demo` |
| `chatId` | 会话 ID | 私聊用线程 ID，群聊用群 ID |
| `senderId` | 发言用户 ID | 业务系统的用户主键 |
| `senderName` | 显示名 | 昵称 |
| `chatType` | 会话类型 | `direct` 或 `group` |
| `token` | 认证凭证 | 启用 auth 时必填 |
| `channelId` | relay 路由键 | 仅 relay 模式需要 |

H5 示例页为了简化把 `senderId` 写成了 `userName`，真实业务接入时必须分开。

### 映射建议

| 场景 | `chatId` | `senderId` | `chatType` |
|------|----------|------------|------------|
| 用户和 AI 私聊 | 私聊会话 ID | 登录用户 ID | `direct` |
| 群聊 | 群 ID | 登录用户 ID | `group` |
| 一个用户多端登录 | 同一个业务会话 ID | 同一个用户 ID | 按实际 |
| 多业务线共用一个 OpenClaw | 给 `chatId` 加业务前缀 | 给 `senderId` 加业务前缀 | 按实际 |

推荐客户端模型：连接先绑定用户身份，会话列表按 `chatId` 切换，agent 选择由 `agentId` 控制。

## 3. 连接与认证

连接时 `chatId` 不是必填项。可选参数放在 URL 查询参数里：

```javascript
const ws = new WebSocket(
  `ws://localhost:18080/ws?chatId=${chatId}&agentId=code&token=${token}`
);
```

认证要点（开了 auth 时）：

- `token` 绑定固定 `senderId`，服务端不再信任消息体里自报的 `senderId`
- `chatId` 默认不和 token 强绑定，同一连接可切多个会话
- 配置里显式给 token 写了固定 `chatId` 时才退回"一 token 一 chat"兼容模式
- `allowAgents` 限制可选 agent

连接成功后服务端回 `connection.open`：

```json
{
  "type": "connection.open",
  "data": {
    "chatId": "conv-10001",
    "userId": "user-42",
    "timestamp": 1710000000000
  }
}
```

未带 `chatId` 时 `data.chatId` 可能为空；启用 token 时 `data.userId` 是服务端解析出的真实用户 ID。

如果当前会话有历史，服务端紧接着回 `history.sync`。选中了 `agentId` 时历史按 `chatId + agentId` 过滤。

## 4. Agent 选择

服务端配置了多个 agent 时：

```yaml
agents:
  list:
    - id: "main"
      name: "主助手"
      default: true
    - id: "code"
      name: "代码助手"
```

两种路由模式：

- 不选 agent：走 OpenClaw 自动路由
- 显式选 agent：前端主动选择，当前会话绑定到指定 agent

### 请求列表

```json
{
  "type": "agent.list.get",
  "data": { "requestId": "agent-list-1" }
}
```

```json
{
  "type": "agent.list",
  "data": {
    "requestId": "agent-list-1",
    "defaultAgentId": "main",
    "selectedAgentId": "code",
    "agents": [
      { "id": "main", "name": "主助手", "isDefault": true },
      { "id": "code", "name": "代码助手", "isDefault": false }
    ],
    "timestamp": 1710000000000
  }
}
```

### 切换 agent

```json
{ "type": "agent.select", "data": { "requestId": "select-1", "agentId": "code" } }
```

恢复自动路由：

```json
{ "type": "agent.select", "data": { "requestId": "select-2", "agentId": null } }
```

服务端确认：

```json
{
  "type": "agent.selected",
  "data": {
    "requestId": "select-1",
    "ok": true,
    "mode": "explicit",
    "selectedAgentId": "code",
    "timestamp": 1710000000100
  }
}
```

`mode` 为 `explicit` 表示显式选择，`auto` 表示自动路由。真正控制消息发给谁的是 `agentId`，而不是前端自己改 `chatId`。

## 5. 发消息协议（前端 → 插件）

所有消息外层都包事件信封：

```json
{ "type": "message.receive", "data": { "...": "..." } }
```

`data` 字段定义：

```ts
type InboundMessage = {
  messageId: string;
  chatId: string;
  chatType: "direct" | "group";
  senderId: string;
  senderName?: string;
  agentId?: string;
  messageType: "text" | "image" | "voice" | "audio" | "file";
  content: string;
  mediaUrl?: string;
  mimeType?: string;
  timestamp: number;
  parentId?: string;  // 引用回复时填被引用消息 ID
};
```

### 文本消息

```json
{
  "type": "message.receive",
  "data": {
    "messageId": "msg-1710000000001",
    "chatId": "conv-10001",
    "chatType": "direct",
    "senderId": "user-42",
    "senderName": "Leway",
    "agentId": "code",
    "messageType": "text",
    "content": "帮我总结一下这张图片",
    "timestamp": 1710000000001
  }
}
```

### 图片消息

```json
{
  "type": "message.receive",
  "data": {
    "messageId": "msg-1710000000002",
    "chatId": "conv-10001",
    "chatType": "direct",
    "senderId": "user-42",
    "messageType": "image",
    "content": "请描述图片内容",
    "mediaUrl": "data:image/jpeg;base64,...",
    "mimeType": "image/jpeg",
    "timestamp": 1710000000002
  }
}
```

### 语音消息

```json
{
  "type": "message.receive",
  "data": {
    "messageId": "msg-1710000000003",
    "chatId": "conv-10001",
    "chatType": "direct",
    "senderId": "user-42",
    "messageType": "voice",
    "content": "",
    "mediaUrl": "data:audio/webm;base64,...",
    "mimeType": "audio/webm",
    "timestamp": 1710000000003
  }
}
```

### 音频文件

```json
{
  "type": "message.receive",
  "data": {
    "messageId": "msg-1710000000004",
    "chatId": "conv-10001",
    "chatType": "direct",
    "senderId": "user-42",
    "messageType": "audio",
    "content": "会议录音",
    "mediaUrl": "https://cdn.example.com/audio/meeting.mp3",
    "mimeType": "audio/mpeg",
    "timestamp": 1710000000004
  }
}
```

### 引用回复

在 `parentId` 里填被引用消息 ID：

```json
{
  "type": "message.receive",
  "data": {
    "messageId": "msg-1710000000010",
    "chatId": "conv-10001",
    "chatType": "direct",
    "senderId": "user-42",
    "messageType": "text",
    "content": "我这里补充一下",
    "parentId": "msg-1710000000001",
    "timestamp": 1710000000010
  }
}
```

服务端会把 `parentId` 传给 agent 上下文，AI 回复时也会带 `replyTo`。

## 6. `mediaUrl` 怎么传

两种方式：

1. **Data URL** — H5 / 小程序本地选图、录音最简单
2. **HTTP(S) URL** — 大文件或长期存储，先传到对象存储再给插件

注意：

- `image` 的 `mimeType` 应为 `image/*`
- `voice` 推荐 `audio/webm`
- `audio` 推荐真实 MIME 如 `audio/mpeg`、`audio/mp4`
- `mediaUrl` 必须能被 gateway 主机访问；浏览器的 `blob:` URL 不能直接给插件

## 7. 收消息协议（插件 → 前端）

### `message.send`

```ts
type OutboundMessage = {
  messageId: string;
  chatId: string;
  content: string;
  contentType: "text" | "markdown" | "image" | "voice" | "audio";
  mediaUrl?: string;
  mimeType?: string;
  replyTo?: string;   // 回复的是哪条消息
  timestamp: number;
};
```

示例：

```json
{
  "type": "message.send",
  "data": {
    "messageId": "msg-1710000001000",
    "chatId": "conv-10001",
    "content": "这张图片里有一只猫，坐在窗边。",
    "contentType": "text",
    "replyTo": "msg-1710000000001",
    "timestamp": 1710000001000
  }
}
```

### `history.sync`

连接建立或 `history.get` 请求后推送会话历史：

```json
{
  "type": "history.sync",
  "data": {
    "chatId": "conv-10001",
    "messages": [
      {
        "messageId": "msg-1",
        "chatId": "conv-10001",
        "direction": "sent",
        "content": "你好",
        "contentType": "text",
        "timestamp": 1710000000000
      },
      {
        "messageId": "msg-2",
        "chatId": "conv-10001",
        "direction": "received",
        "content": "你好，有什么可以帮你？",
        "contentType": "text",
        "timestamp": 1710000000500
      }
    ],
    "timestamp": 1710000002000
  }
}
```

`direction` 规则：`sent` = 用户发的，`received` = agent 回的。选中 `agentId` 时历史按 `chatId + agentId` 过滤。

### `history.get`

客户端主动拉指定会话历史：

```json
{
  "type": "history.get",
  "data": {
    "requestId": "history-1",
    "chatId": "conv-10001",
    "limit": 100
  }
}
```

服务端返回 `history.sync`。当前连接选中了 `agentId` 时也会继续按 `chatId + agentId` 过滤。

### `thinking.start` / `thinking.update` / `thinking.end`

AI 思考状态：

```json
{
  "type": "thinking.update",
  "data": {
    "chatId": "conv-10001",
    "content": "正在分析图片内容",
    "timestamp": 1710000000900
  }
}
```

### `conversation.list.get` / `conversation.list`

请求当前用户的会话列表：

```json
{
  "type": "conversation.list.get",
  "data": {
    "requestId": "conversation-list-1",
    "agentId": "code",
    "limit": 50
  }
}
```

响应：

```json
{
  "type": "conversation.list",
  "data": {
    "requestId": "conversation-list-1",
    "conversations": [
      {
        "chatId": "conv-user42-code-1",
        "chatType": "direct",
        "lastContent": "帮我整理一下这个需求",
        "lastDirection": "sent",
        "lastTimestamp": 1710000003000,
        "agentIds": ["code"],
        "participantIds": ["user-42"]
      }
    ],
    "timestamp": 1710000004000
  }
}
```

这个列表是给当前 token 对应的用户看的，不是全局公开列表。

### `reaction.add` / `reaction.remove`

消息表情反应：

```json
{
  "type": "reaction.add",
  "data": {
    "messageId": "msg-1710000001000",
    "chatId": "conv-10001",
    "senderId": "user-42",
    "emoji": "👍",
    "timestamp": 1710000003000
  }
}
```

```json
{
  "type": "reaction.remove",
  "data": {
    "messageId": "msg-1710000001000",
    "chatId": "conv-10001",
    "senderId": "user-42",
    "emoji": "👍",
    "timestamp": 1710000004000
  }
}
```

服务端更新内存中的 reaction 状态并广播给同 chat 下其他客户端。reaction 当前是内存态，不持久化。

### `channel.status.get` / `channel.status`

轻量级状态接口，只返回 `clawline` 自身运行状态：

```json
{
  "type": "channel.status.get",
  "data": {
    "requestId": "status-1",
    "includeChats": false
  }
}
```

```json
{
  "type": "channel.status",
  "data": {
    "requestId": "status-1",
    "channel": "clawline",
    "configured": true,
    "enabled": true,
    "running": true,
    "mode": "websocket",
    "port": 18080,
    "path": "/ws",
    "currentChatId": "conv-10001",
    "currentChatConnectionCount": 1,
    "connectedChatCount": 3,
    "connectedSocketCount": 4,
    "timestamp": 1710000002100
  }
}
```

`includeChats = true` 时响应里会额外带 `connectedChats`。

## 8. 协议支持 vs H5 示例页 UI

以下能力已在协议和服务端实现，但 `examples/h5-client.html` 尚无对应 UI：

- **引用回复**：协议 `parentId` / `replyTo` 已支持，示例页无"点消息引用回复"交互
- **消息表情反应**：`reaction.add` / `reaction.remove` 已支持，示例页无 emoji 面板

自己接 H5 / App / 小程序时可直接按协议使用这些能力。

## 9. 完整可运行示例

```html
<script>
  const serverUrl = "ws://localhost:18080/ws";
  const senderId = "user-42";
  const senderName = "Leway";
  let selectedAgentId = "code";
  let currentChatId = "conv-10001";

  const ws = new WebSocket(
    `${serverUrl}?agentId=${encodeURIComponent(selectedAgentId)}`
  );

  ws.onmessage = (event) => {
    const packet = JSON.parse(event.data);

    if (packet.type === "message.send") {
      console.log("AI:", packet.data.content);
    }

    if (packet.type === "history.sync") {
      console.log("history:", packet.data.messages);
    }

    if (packet.type === "agent.list") {
      console.log("agents:", packet.data.agents);
    }

    if (packet.type === "conversation.list") {
      console.log("conversations:", packet.data.conversations);
    }
  };

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "agent.list.get",
      data: { requestId: `agent-list-${Date.now()}` }
    }));

    ws.send(JSON.stringify({
      type: "conversation.list.get",
      data: {
        requestId: `conversation-list-${Date.now()}`,
        agentId: selectedAgentId
      }
    }));
  };

  function sendText(content) {
    ws.send(JSON.stringify({
      type: "message.receive",
      data: {
        messageId: `msg-${Date.now()}`,
        chatId: currentChatId,
        chatType: "direct",
        senderId,
        senderName,
        agentId: selectedAgentId,
        messageType: "text",
        content,
        timestamp: Date.now()
      }
    }));
  }

  function openConversation(chatId) {
    currentChatId = chatId;
    ws.send(JSON.stringify({
      type: "history.get",
      data: { requestId: `history-${Date.now()}`, chatId }
    }));
  }

  function selectAgent(agentId) {
    selectedAgentId = agentId || "";
    ws.send(JSON.stringify({
      type: "agent.select",
      data: {
        requestId: `agent-select-${Date.now()}`,
        agentId: selectedAgentId || null
      }
    }));
  }
</script>
```

完整参考实现：`../examples/h5-client.html`

## 10. 能力边界

当前支持：

- 一个用户建连后查看 agent 列表、切换 agent
- 同一连接切换多个 `chatId`
- 按 agent 维度拉会话列表
- 按 `chatId` 拉会话历史

不支持：

- 多 agent 同时在一个群里并行发言（需要单独设计群成员、agent participant、fan-out / fan-in 规则）

## 11. 平台接入参考

`clawline` 是一个很薄的聊天协议层，任何能发 WebSocket JSON 的客户端都能接：H5、iOS/Android、uni-app、Taro、React Native、Flutter、微信小程序。

### 微信小程序

```javascript
const socket = wx.connectSocket({
  url: `wss://example.com/ws?chatId=${encodeURIComponent(chatId)}&agentId=${encodeURIComponent(agentId)}`
});

socket.onMessage((res) => {
  const packet = JSON.parse(res.data);
  if (packet.type === "message.send") {
    console.log("AI:", packet.data.content);
  }
});

function sendText(content) {
  socket.send({
    data: JSON.stringify({
      type: "message.receive",
      data: {
        messageId: `msg-${Date.now()}`,
        chatId,
        chatType: "direct",
        senderId,
        senderName,
        agentId,
        messageType: "text",
        content,
        timestamp: Date.now()
      }
    })
  });
}
```

图片 / 语音：先读成 base64 拼成 Data URL，填 `mediaUrl`：

```javascript
function fileToDataUrl(path, mimeType) {
  const base64 = wx.getFileSystemManager().readFileSync(path, "base64");
  return `data:${mimeType};base64,${base64}`;
}
```

### 第三方 IM / 聊天 App 映射

| 你的字段 | clawline 字段 |
|----------|----------------------|
| 会话 ID / dialogId / threadId | `chatId` |
| 发消息的用户 ID | `senderId` |
| 昵称 | `senderName` |
| 私聊 / 单聊 | `chatType = "direct"` |
| 群聊 / 频道 / 讨论组 | `chatType = "group"` |
| 文本内容 | `content` |
| 图片 / 语音 / 音频资源地址 | `mediaUrl` |

桥接原则：`chatId` 必须稳定（不能每次刷新变），`senderId` 必须是业务真实用户。

## 12. 常见坑

| 问题 | 说明 |
|------|------|
| 频道名写成 `generic` | 正确配置键是 `channels.clawline` |
| `chatId` 和 `senderId` 混用 | 示例页为简化把两者写成一样，真实业务必须分开 |
| 语音 MIME 不对 | `voice` 推荐 `audio/webm`，不要用 `video/webm` |
| 图片模型看不到 | 检查 `messageType` 是 `image`、`mimeType` 是 `image/*`、`mediaUrl` 有效、模型支持图像 |
| `blob:` URL 给插件 | 浏览器 `blob:` 只在当前页有效，要转 Data URL 或上传后给 HTTPS URL |

## 13. 参考

- `../examples/h5-client.html`
- `../README.md`
- `./CONFIG_EXAMPLES.md`
- `./CONFIG_EXAMPLES_ZH.md`
- `./README.md`
