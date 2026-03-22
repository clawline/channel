# Clawline 安装配置指南

本文档覆盖 Clawline 插件的安装、两种连接模式配置、完整配置参考和常见问题。

---

## 目录

- [安装](#安装)
- [连接模式概览](#连接模式概览)
- [WebSocket 模式配置](#websocket-模式配置)
- [Relay 模式配置](#relay-模式配置)
- [openclaw.json 完整配置参考](#openclawjson-完整配置参考)
- [常见问题](#常见问题)

---

## 安装

### 方式 A：使用 OpenClaw CLI（推荐）

```bash
openclaw plugins install @clawlines/clawline
```

安装后插件自动放置在：
- **Linux/macOS**: `~/.openclaw/extensions/clawline/`
- **Windows**: `%USERPROFILE%\.openclaw\extensions\clawline\`

### 方式 B：使用 npm

```bash
npm install @clawlines/clawline
```

安装后位于 `node_modules/@clawlines/clawline/`。

> 两种方式二选一即可，OpenClaw 插件系统会自动加载。

---

## 连接模式概览

Clawline 支持两种主要连接模式（`webhook` 已不推荐，此处不展开）：

| 模式 | 适用场景 | 原理 |
|------|----------|------|
| **websocket** | 本地开发、内网部署 | 插件直接监听一个 WebSocket 端口，客户端直连 |
| **relay** | 公网 / 半公网部署 | 插件主动反连到 relay-gateway，客户端连 relay 的客户端入口 |

### 怎么选？

- **本地调试 / 内网**：用 `websocket`，最简单
- **公网 / 半公网**：用 `relay`，不暴露插件端口，由 relay-gateway 统一管理入口
- **直连但对外**：`websocket` + 必须开 `auth` token 认证

---

## WebSocket 模式配置

WebSocket 模式下，插件直接监听端口，客户端通过 `ws://host:port/ws` 连接。

### 最小配置

在 `~/.openclaw/openclaw.json` 的 `channels.clawline` 下添加：

```json
{
  "channels": {
    "clawline": {
      "enabled": true,
      "connectionMode": "websocket",
      "wsPort": 8080,
      "wsPath": "/ws",
      "dmPolicy": "open"
    }
  }
}
```

### 带 Token 认证的配置（公网推荐）

如果端口会暴露到公网或半公网，**必须**开启 token 认证：

```json
{
  "channels": {
    "clawline": {
      "enabled": true,
      "connectionMode": "websocket",
      "wsPort": 18080,
      "wsPath": "/ws",
      "auth": {
        "enabled": true,
        "tokenParam": "token",
        "users": [
          {
            "senderId": "alex",
            "token": "gc_alex_xxxxxxxxx",
            "allowAgents": ["main", "writer"]
          },
          {
            "senderId": "bob",
            "token": "gc_bob_xxxxxxxxx"
          }
        ]
      },
      "dmPolicy": "allowlist",
      "allowFrom": ["alex", "bob"],
      "mediaMaxMb": 30
    }
  },
  "session": {
    "dmScope": "per-account-channel-peer"
  }
}
```

### 带语音转写的配置

```json
{
  "channels": {
    "clawline": {
      "enabled": true,
      "connectionMode": "websocket",
      "wsPort": 18080,
      "wsPath": "/ws",
      "transcription": {
        "enabled": true,
        "provider": "faster-whisper",
        "pythonPath": "/path/to/.venv/bin/python",
        "model": "tiny",
        "device": "cpu",
        "computeType": "int8",
        "timeoutMs": 120000
      }
    }
  }
}
```

> 前置条件：gateway 主机需要安装 `ffmpeg`，Python 运行时需要安装 `faster-whisper`。

### 客户端连接

```
ws://localhost:8080/ws
ws://localhost:8080/ws?token=gc_alex_xxxxxxxxx
ws://localhost:8080/ws?token=gc_alex_xxxxxxxxx&agentId=code
```

---

## Relay 模式配置

Relay 模式下，插件主动反连到 [clawline/gateway](https://github.com/clawline/gateway)，客户端连接 relay-gateway 的客户端入口。

### 架构

```
客户端 ──wss──→ relay-gateway (/client) ──→ OpenClaw 插件 (/backend)
                     ↑
              Caddy/Nginx TLS
```

### 插件侧配置

```json
{
  "channels": {
    "clawline": {
      "enabled": true,
      "connectionMode": "relay",
      "relay": {
        "url": "ws://127.0.0.1:19080/backend",
        "channelId": "demo",
        "secret": "replace-me-with-strong-secret",
        "instanceId": "openclaw-sg-1"
      }
    }
  }
}
```

> Relay 模式下认证由 relay-gateway 负责，插件侧通常不需要配 `auth` 块。

### relay-gateway 部署

relay-gateway 是独立的 Node.js 服务，详见 [clawline/gateway](https://github.com/clawline/gateway)。

最小环境变量：

```bash
RELAY_PORT=19080
RELAY_CHANNELS_JSON='{"demo":{"secret":"replace-me-with-strong-secret"}}'
```

启动：

```bash
cd gateway
npm install
npm start
```

### 公网 TLS 推荐

- relay-gateway 只监听回环（`RELAY_HOST=127.0.0.1`）
- 用 Caddy 或 Nginx 反代，提供 `wss://` 入口
- 客户端连接 `wss://relay.example.com/client?channelId=demo`

最小 Caddyfile 示例：

```caddyfile
relay.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:19080
}
```

### 客户端连接

```
ws://relay-host:19080/client?channelId=demo
wss://relay.example.com/client?channelId=demo&token=xxx
```

---

## openclaw.json 完整配置参考

以下为 `channels.clawline` 下所有可用配置项，基于源码 `config-schema.ts`：

### 顶层配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `false` | 启用/禁用 Clawline 插件 |
| `connectionMode` | `"websocket"` \| `"relay"` \| `"webhook"` | `"websocket"` | 连接模式 |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | `"open"` | 私聊策略 |
| `allowFrom` | string[] | - | dmPolicy 为 `allowlist` 时的白名单 |
| `historyLimit` | number | `10` | 群聊保留的历史消息数量 |
| `textChunkLimit` | number | `4000` | 每条消息最大字符数 |
| `mediaMaxMb` | number | `30` | 入站媒体最大大小（MB） |

### WebSocket 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `wsPort` | number | `8080` | WebSocket 服务器端口 |
| `wsPath` | string | `"/ws"` | WebSocket 端点路径 |

### Relay 配置 (`relay` 对象)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `relay.url` | string | - | relay-gateway 的 backend 入口 URL（必填） |
| `relay.channelId` | string | - | 频道 ID，与 gateway 配置对应（必填） |
| `relay.secret` | string | - | 频道密钥（必填） |
| `relay.instanceId` | string | - | 实例标识（可选） |
| `relay.reconnectIntervalMs` | number | `3000` | 断线重连间隔（ms） |
| `relay.connectTimeoutMs` | number | `10000` | 连接超时（ms） |

### 认证配置 (`auth` 对象)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `auth.enabled` | boolean | `false` | 是否启用 token 认证 |
| `auth.tokenParam` | string | `"token"` | URL 查询参数名 |
| `auth.users` | array | `[]` | 用户列表 |

每个 `auth.users[]` 项：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `senderId` | string | 用户 ID（必填） |
| `token` | string | 认证 token（必填） |
| `id` | string | 用户标识（可选） |
| `chatId` | string | 固定会话 ID（可选，旧兼容模式） |
| `allowAgents` | string[] | 允许使用的 agent 列表（可选） |
| `enabled` | boolean | 是否启用此用户，默认 `true` |

### Webhook 配置（不推荐）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `webhookPath` | string | `"/generic/events"` | Webhook 端点路径 |
| `webhookPort` | number | `3000` | Webhook 服务器端口 |
| `webhookSecret` | string | - | Webhook 签名密钥 |

### 语音转写配置 (`transcription` 对象)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `transcription.enabled` | boolean | `false` | 是否启用自动转写 |
| `transcription.provider` | string | `"faster-whisper"` | 转写引擎 |
| `transcription.pythonPath` | string | - | Python 可执行文件路径 |
| `transcription.model` | string | `"tiny"` | Whisper 模型（tiny/base/small/medium/large） |
| `transcription.language` | string | - | 强制语言代码（留空自动检测） |
| `transcription.device` | string | `"cpu"` | 运行设备 |
| `transcription.computeType` | string | `"int8"` | 计算类型 |
| `transcription.timeoutMs` | number | `120000` | 转写超时（ms） |
| `transcription.applyToVoice` | boolean | `true` | 是否转写 voice 类型消息 |
| `transcription.applyToAudio` | boolean | `true` | 是否转写 audio 类型消息 |

### 全局推荐配置（session 级别）

```json
{
  "session": {
    "dmScope": "per-account-channel-peer"
  }
}
```

多用户场景下必须设置，防止不同用户的对话串到同一个 DM 线程。

---

## 常见问题

### 安装相关

**Q: `openclaw plugins install` 和 `npm install` 有什么区别？**

A: `openclaw plugins install` 自动安装到 OpenClaw 扩展目录（`~/.openclaw/extensions/`），即装即用。`npm install` 安装到当前项目 `node_modules/`，适合开发调试。两者功能相同。

**Q: 安装后需要手动复制文件吗？**

A: 不需要。OpenClaw 插件系统会自动发现和加载。

### 连接模式相关

**Q: websocket 和 relay 模式，客户端代码有区别吗？**

A: 消息协议完全一致，客户端不需要写两套代码。唯一区别是连接地址：
- websocket 直连：`ws://host:8080/ws`
- relay：`ws://relay-host:19080/client?channelId=demo`

**Q: 什么时候必须用 relay？**

A: 当你不希望 OpenClaw 主机端口直接暴露到公网时。Relay 模式下插件主动反连到 relay-gateway，客户端只连 gateway 的公网入口，OpenClaw 本身不需要开放端口。

**Q: 配置键是 `generic` 还是 `clawline`？**

A: 正确的配置键是 `channels.clawline`，不是 `channels.generic`。

### 认证相关

**Q: 直连不开 auth 安全吗？**

A: 仅限本地调试。不开 auth 时任何人都可以声称自己是任意用户。公网部署必须至少开启 token 认证。

**Q: relay 模式还需要在插件侧配 auth 吗？**

A: 通常不需要。Relay 模式的认证由 relay-gateway 负责，用户/token 配在 gateway 侧。

**Q: token 和 chatId 是绑定的吗？**

A: 默认不绑定。token 绑定的是 `senderId`（用户身份），同一用户可以在一个连接里切换多个 `chatId`（会话）。只有在配置里显式给 token 写了固定 `chatId` 时，才会退回"一 token 一 chat"的兼容模式。

### 启动与验证

**Q: 配置修改后怎么生效？**

A: 重启 OpenClaw Gateway：
```bash
openclaw gateway restart
```

**Q: 怎么确认 Clawline 启动成功？**

A: 查看日志，WebSocket 模式应看到：
```
[generic] WebSocket server started on port 8080 at path /ws
```

也可以用示例客户端测试：
```bash
# 打开 examples/h5-client.html
# 或通过静态文件服务
python3 -m http.server 4173
```

**Q: WebSocket 连接失败怎么排查？**

A:
1. 确认 OpenClaw 正在运行：`openclaw gateway status`
2. 确认端口没被占用：`lsof -i :8080`
3. 检查防火墙/安全组是否放行该端口
4. 查看 OpenClaw 日志是否有错误

### 其他

**Q: 多用户同时使用时消息会串吗？**

A: 会。需要设置 `session.dmScope` 为 `"per-account-channel-peer"` 来隔离不同用户的会话。

**Q: H5 客户端从 HTTPS 页面连不上？**

A: HTTPS 页面只能连 `wss://`（加密 WebSocket），不能连 `ws://`。需要在 OpenClaw 前面配置反向代理（Nginx/Caddy）提供 TLS 终结。

**Q: 语音/音频转写不工作？**

A:
1. 确认 gateway 主机安装了 `ffmpeg`
2. 确认配置的 Python 环境安装了 `faster-whisper`
3. 检查 `pythonPath` 指向正确的 Python 可执行文件
4. 查看日志是否有转写错误

---

## 相关文档

- [README](../README.md) — 项目概述
- [配置示例（中文）](./CONFIG_EXAMPLES_ZH.md) — 更多配置示例
- [配置示例（英文）](./CONFIG_EXAMPLES.md) — Configuration examples
- [接入指南](./INTEGRATION_GUIDE.md) — H5 / App / 小程序接入
- [主动 DM](./PROACTIVE_DM.md) — 主动发送消息
- [H5 客户端示例](../examples/h5-client.html) — 可运行的演示客户端
- [relay-gateway](https://github.com/clawline/gateway) — 公网中转服务
