# 主动发送 DM (Proactive Direct Messages)

[English](#english) | [中文](#中文)

---

## 中文

### 概述

Clawline 已经支持 OpenClaw 主动发送 DM 消息。这意味着 OpenClaw 可以在没有收到用户消息的情况下，主动向已连接的客户端发送消息。

这里的主前提仍然是当前接入走 `websocket`，并且目标客户端处于在线连接状态。

### 工作原理

Clawline 通过以下机制支持主动 DM：

1. **ChannelOutboundAdapter**：Clawline 实现了 OpenClaw 的 `ChannelOutboundAdapter` 接口
2. **WebSocket 连接池**：维护所有已连接客户端的 WebSocket 连接
3. **消息路由**：通过 `sendMessageGeneric` 函数将消息路由到指定的 `chatId`

### 使用方法

#### 方法 1：通过 OpenClaw Agent 工具

OpenClaw Agent 可以使用内置的消息工具主动发送消息到任何已连接的客户端。

**Agent 提示词示例：**
```
请向用户 user-123 发送一条提醒消息
```

**Agent 工具调用：**
```typescript
// Agent 会自动调用消息工具
{
  tool: "send_message",
  params: {
    target: "user:user-123",  // 或者直接 "user-123"
    text: "这是一条主动提醒消息"
  }
}
```

#### 方法 2：通过程序化 API

如果你需要在代码中主动发送消息（例如定时任务、webhook 触发等），可以直接使用导出的 API：

```typescript
import { sendMessageGeneric } from '@clawlines/clawline';
import type { OpenClawConfig } from 'openclaw/plugin-sdk';

// 获取 OpenClaw 配置
const cfg: OpenClawConfig = /* 你的配置 */;

// 发送文本消息
await sendMessageGeneric({
  cfg,
  to: "user-123",           // 目标用户的 chatId
  text: "这是一条主动消息"
});

// 发送 Markdown 消息
await sendMessageGeneric({
  cfg,
  to: "user:user-456",      // 也可以使用 "user:" 前缀
  text: "# 标题\n\n这是 **Markdown** 格式的消息",
  contentType: "markdown"
});

// 发送到群聊
await sendMessageGeneric({
  cfg,
  to: "chat:group-789",     // 使用 "chat:" 前缀发送到群组
  text: "这是发送到群组的消息"
});
```

#### 方法 3：发送媒体消息

```typescript
import { sendMediaGeneric } from '@clawlines/clawline';

// 发送图片
await sendMediaGeneric({
  cfg,
  to: "user-123",
  mediaUrl: "https://example.com/image.jpg",
  mediaType: "image",
  caption: "这是图片说明"
});

// 发送语音消息
await sendMediaGeneric({
  cfg,
  to: "user-123",
  mediaUrl: "https://example.com/voice.mp3",
  mediaType: "voice",
  caption: "语音消息"
});

// 发送音频文件
await sendMediaGeneric({
  cfg,
  to: "user-123",
  mediaUrl: "https://example.com/audio.mp3",
  mediaType: "audio",
  caption: "音频文件"
});
```

### 目标格式 (Target Format)

Clawline 支持以下目标格式：

| 格式 | 说明 | 示例 |
|------|------|------|
| `user-id` | 直接使用用户 ID | `"user-123"` |
| `user:user-id` | 明确指定用户类型 | `"user:user-123"` |
| `chat:chat-id` | 发送到群聊 | `"chat:group-789"` |

### 完整示例：定时提醒系统

```typescript
import { sendMessageGeneric } from '@clawlines/clawline';
import type { OpenClawConfig } from 'openclaw/plugin-sdk';

// 定时任务：每天早上 9 点发送提醒
async function sendDailyReminder(cfg: OpenClawConfig, userId: string) {
  await sendMessageGeneric({
    cfg,
    to: userId,
    text: "早上好！这是你的每日提醒 ☀️",
    contentType: "text"
  });
}

// Webhook 触发：当外部事件发生时通知用户
async function notifyUserOfEvent(cfg: OpenClawConfig, userId: string, eventData: any) {
  const message = `
# 事件通知

**类型**: ${eventData.type}
**时间**: ${new Date(eventData.timestamp).toLocaleString()}
**详情**: ${eventData.description}
  `.trim();

  await sendMessageGeneric({
    cfg,
    to: userId,
    text: message,
    contentType: "markdown"
  });
}

// 广播消息到所有在线用户
async function broadcastToAllUsers(cfg: OpenClawConfig, userIds: string[], message: string) {
  const promises = userIds.map(userId =>
    sendMessageGeneric({
      cfg,
      to: userId,
      text: message
    })
  );

  await Promise.all(promises);
}
```

### 前置条件

1. **客户端必须已连接**：只有当客户端的 WebSocket 连接处于活跃状态时，消息才能送达
2. **正确的 chatId**：使用客户端连接时使用的相同 `chatId`
   - 如果你的业务里 `senderId` 和 `chatId` 不是一回事，主动 DM 时优先使用会话对应的 `chatId`
3. **DM 策略配置**：
   - `dmPolicy: "open"` - 允许任何人（推荐用于主动消息）
   - `dmPolicy: "pairing"` - 需要配对审批
   - `dmPolicy: "allowlist"` - 只允许白名单用户

### 配置建议

如果你需要支持主动 DM，建议使用以下配置：

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    dmPolicy: "open"           # 允许主动发送消息
    textChunkLimit: 4000
```

### 注意事项

1. **连接状态检查**：如果客户端未连接，消息会被忽略（不会排队）
2. **消息送达**：WebSocket 模式下，消息实时发送；Webhook 模式不支持主动推送
3. **错误处理**：如果发送失败，函数会抛出异常，需要适当的错误处理
4. **限流**：建议实现限流机制，避免向单个用户发送过多消息

### 故障排除

#### 消息没有送达

1. **检查客户端连接状态**：
   ```typescript
   import { getGenericWSManager } from '@clawlines/clawline/src/generic/client.js';

   const wsManager = getGenericWSManager();
   const isConnected = wsManager?.isClientConnected(chatId);
   ```

2. **检查日志**：查看 OpenClaw 日志中是否有 `Client ${chatId} not connected` 警告

3. **验证 chatId**：确保使用的 chatId 与客户端连接时使用的完全一致

#### WebSocket 连接断开

- 检查客户端是否正确处理心跳（ping/pong）
- 查看网络是否稳定
- 检查防火墙或代理设置

---

## English

### Overview

Clawline already supports OpenClaw proactive DM sending. This means OpenClaw can send messages to connected clients without receiving a message first.

### How It Works

Clawline supports proactive DM through these mechanisms:

1. **ChannelOutboundAdapter**: Clawline implements OpenClaw's `ChannelOutboundAdapter` interface
2. **WebSocket Connection Pool**: Maintains WebSocket connections for all connected clients
3. **Message Routing**: Routes messages to specified `chatId` through the `sendMessageGeneric` function

### Usage

#### Method 1: Via OpenClaw Agent Tools

OpenClaw Agents can use built-in messaging tools to proactively send messages to any connected client.

**Agent Prompt Example:**
```
Please send a reminder message to user user-123
```

**Agent Tool Call:**
```typescript
// Agent will automatically call the message tool
{
  tool: "send_message",
  params: {
    target: "user:user-123",  // or just "user-123"
    text: "This is a proactive reminder message"
  }
}
```

#### Method 2: Via Programmatic API

If you need to send messages from code (e.g., scheduled tasks, webhook triggers), you can use the exported API directly:

```typescript
import { sendMessageGeneric } from '@clawlines/clawline';
import type { OpenClawConfig } from 'openclaw/plugin-sdk';

// Get OpenClaw config
const cfg: OpenClawConfig = /* your config */;

// Send text message
await sendMessageGeneric({
  cfg,
  to: "user-123",           // Target user's chatId
  text: "This is a proactive message"
});

// Send Markdown message
await sendMessageGeneric({
  cfg,
  to: "user:user-456",      // Can also use "user:" prefix
  text: "# Title\n\nThis is a **Markdown** formatted message",
  contentType: "markdown"
});

// Send to group chat
await sendMessageGeneric({
  cfg,
  to: "chat:group-789",     // Use "chat:" prefix for groups
  text: "This is a message to the group"
});
```

#### Method 3: Send Media Messages

```typescript
import { sendMediaGeneric } from '@clawlines/clawline';

// Send image
await sendMediaGeneric({
  cfg,
  to: "user-123",
  mediaUrl: "https://example.com/image.jpg",
  mediaType: "image",
  caption: "Image caption"
});

// Send voice message
await sendMediaGeneric({
  cfg,
  to: "user-123",
  mediaUrl: "https://example.com/voice.mp3",
  mediaType: "voice",
  caption: "Voice message"
});

// Send audio file
await sendMediaGeneric({
  cfg,
  to: "user-123",
  mediaUrl: "https://example.com/audio.mp3",
  mediaType: "audio",
  caption: "Audio file"
});
```

### Target Format

Clawline supports the following target formats:

| Format | Description | Example |
|--------|-------------|---------|
| `user-id` | Direct user ID | `"user-123"` |
| `user:user-id` | Explicit user type | `"user:user-123"` |
| `chat:chat-id` | Send to group chat | `"chat:group-789"` |

### Complete Example: Scheduled Reminder System

```typescript
import { sendMessageGeneric } from '@clawlines/clawline';
import type { OpenClawConfig } from 'openclaw/plugin-sdk';

// Scheduled task: Send reminder every day at 9 AM
async function sendDailyReminder(cfg: OpenClawConfig, userId: string) {
  await sendMessageGeneric({
    cfg,
    to: userId,
    text: "Good morning! This is your daily reminder ☀️",
    contentType: "text"
  });
}

// Webhook trigger: Notify user when external event occurs
async function notifyUserOfEvent(cfg: OpenClawConfig, userId: string, eventData: any) {
  const message = `
# Event Notification

**Type**: ${eventData.type}
**Time**: ${new Date(eventData.timestamp).toLocaleString()}
**Details**: ${eventData.description}
  `.trim();

  await sendMessageGeneric({
    cfg,
    to: userId,
    text: message,
    contentType: "markdown"
  });
}

// Broadcast message to all online users
async function broadcastToAllUsers(cfg: OpenClawConfig, userIds: string[], message: string) {
  const promises = userIds.map(userId =>
    sendMessageGeneric({
      cfg,
      to: userId,
      text: message
    })
  );

  await Promise.all(promises);
}
```

### Prerequisites

1. **Client Must Be Connected**: Messages can only be delivered when the client's WebSocket connection is active
2. **Correct chatId**: Use the same `chatId` that the client used when connecting
3. **DM Policy Configuration**:
   - `dmPolicy: "open"` - Allow anyone (recommended for proactive messages)
   - `dmPolicy: "pairing"` - Requires pairing approval
   - `dmPolicy: "allowlist"` - Only allow whitelisted users

### Recommended Configuration

If you need to support proactive DM, use this configuration:

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    dmPolicy: "open"           # Allow proactive message sending
    textChunkLimit: 4000
```

### Important Notes

1. **Connection State Check**: If client is not connected, messages are ignored (not queued)
2. **Message Delivery**: In WebSocket mode, messages are sent in real-time; Webhook mode doesn't support proactive push
3. **Error Handling**: Function throws exceptions on failure, proper error handling is needed
4. **Rate Limiting**: Implement rate limiting to avoid sending too many messages to a single user

### Troubleshooting

#### Messages Not Delivered

1. **Check Client Connection Status**:
   ```typescript
   import { getGenericWSManager } from '@clawlines/clawline/src/generic/client.js';

   const wsManager = getGenericWSManager();
   const isConnected = wsManager?.isClientConnected(chatId);
   ```

2. **Check Logs**: Look for `Client ${chatId} not connected` warnings in OpenClaw logs

3. **Verify chatId**: Ensure the chatId used matches exactly what the client used when connecting

#### WebSocket Connection Drops

- Check if client properly handles heartbeat (ping/pong)
- Verify network stability
- Check firewall or proxy settings
