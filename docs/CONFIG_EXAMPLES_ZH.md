# 通用频道配置示例

## 快速开始指南

### 第一步：安装插件

选择以下任一方式安装：

**方式 A：使用 OpenClaw CLI（推荐）**
```bash
openclaw plugins install @clawlines/clawline
```

**方式 B：使用 npm**
```bash
npm install @clawlines/clawline
```

### 第二步：插件位置

安装后，插件会自动放置在 OpenClaw 的扩展目录中：
- **Linux/macOS**: `~/.openclaw/extensions/clawline/`
- **Windows**: `%USERPROFILE%\.openclaw\extensions\clawline\`

你不需要手动移动任何文件 - OpenClaw 插件系统会自动处理。

### 第三步：配置频道

编辑 OpenClaw 配置文件（当前环境通常是 `~/.openclaw/openclaw.json`；也可通过 `openclaw config path` 查看实际路径）。下面的结构示例仍用 YAML 表示：

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    dmPolicy: "open"
    mediaMaxMb: 30
    transcription:
      enabled: true
      pythonPath: "/home/restry/.openclaw/workspace/.venv/bin/python"
      model: "tiny"
```

### 第三步补充：如果要暴露到公网，建议加上简单 token 认证

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    auth:
      enabled: true
      tokenParam: "token"
      users:
        - id: "alex"
          senderId: "alex"
          chatId: "alex"
          token: "gc_alex_xxxxxxxxx"
          allowAgents:
            - "main"
            - "writer"
```

多用户接入时，建议同时加上全局会话隔离配置：

```yaml
session:
  dmScope: "per-account-channel-peer"
```

或使用命令行配置：
```bash
openclaw config set channels.clawline.enabled true
openclaw config set channels.clawline.connectionMode websocket
openclaw config set channels.clawline.wsPort 8080
```

### 第四步：启动 OpenClaw

```bash
openclaw gateway restart
```

你应该在日志中看到：
```
[generic] WebSocket server started on port 8080 at path /ws
```

### 第五步：连接 H5 客户端

有两种方式连接：

#### 方式 A：使用自带的示例客户端

1. 找到示例客户端文件：
   - 如果通过 npm 安装：`node_modules/@clawlines/clawline/examples/h5-client.html`
   - 如果通过 OpenClaw 安装：`~/.openclaw/extensions/clawline/examples/h5-client.html`

2. 在浏览器中打开 `h5-client.html`（双击或使用 `file://` URL）

3. 在连接表单中填写：
   - **WebSocket URL**: `ws://localhost:8080/ws`（根据需要调整主机和端口）
   - **Chat ID**: 任意唯一标识符（如 `user-123`）
   - **Your Name**: 你的显示名称

4. 点击 **Connect** 开始聊天！

如果你要把自己的 H5 / 聊天 App / 微信小程序直接接进来，下一步直接看 `./INTEGRATION_GUIDE.md`。

#### 方式 B：集成到你自己的 H5 页面

在你的 H5 应用中添加 WebSocket 连接代码：

```javascript
// 连接到通用频道
const ws = new WebSocket('ws://localhost:8080/ws?chatId=user-123');

ws.onopen = () => {
  console.log('已连接到 AI');
};

// 发送消息
function sendMessage(text) {
  ws.send(JSON.stringify({
    type: 'message.receive',
    data: {
      messageId: 'msg-' + Date.now(),
      chatId: 'user-123',
      chatType: 'direct',
      senderId: 'user-123',
      senderName: '用户',
      messageType: 'text',
      content: text,
      timestamp: Date.now()
    }
  }));
}

// 接收 AI 回复
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'message.send') {
    console.log('AI 回复:', msg.data.content);
  }
};
```

---

## 配置示例

### 示例 1：WebSocket 模式（默认）

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    dmPolicy: "open"
    historyLimit: 10
    textChunkLimit: 4000
```

### 示例 2：Relay 模式（公网推荐）

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
    auth:
      enabled: true
      tokenParam: "token"
      users:
        - senderId: "user-42"
          token: "gc_user42_xxxxxxxxx"
```

配套 relay-gateway：

```bash
cd src/relay-gateway
npm install
RELAY_PORT=19080 \\
RELAY_CHANNELS_JSON='{"demo":{"secret":"replace-me"}}' \\
npm start
```

### 示例 3：Webhook 模式

这里保留 `webhook` 配置字段只是为了完整性说明；当前推荐路径是本地/内网直连 `websocket`，公网部署走 `relay`。

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "webhook"
    webhookPath: "/generic/events"
    webhookPort: 3000
    webhookSecret: "你的密钥"
    dmPolicy: "open"
    historyLimit: 10
    textChunkLimit: 4000
```

### 示例 4：使用白名单（限制访问）

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    dmPolicy: "allowlist"
    allowFrom:
      - "user-123"
      - "user-456"
      - "admin-user"
    historyLimit: 10
    textChunkLimit: 4000
```

### 示例 5：配对模式（需要审批）

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    wsPath: "/ws"
    dmPolicy: "pairing"
    historyLimit: 10
    textChunkLimit: 4000
```

### 示例 6：使用 faster-whisper 自动转写语音/音频

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

说明：
- gateway 主机需要先安装 `ffmpeg`
- 上面配置的 Python 运行时里需要先安装 `faster-whisper`
- 开启后，传入的 `voice` 和 `audio` 会自动先转写，再把文本注入给 agent

### 推荐生产基线

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    dmPolicy: "allowlist"
    mediaMaxMb: 30
session:
  dmScope: "per-account-channel-peer"
```

原因：
- `websocket` 是当前主接入路径
- `dmScope` 可以防止不同用户串到同一条 DM 线程
- `mediaMaxMb` 用来限制图片 / 音频入站大小

---

## 配置选项说明

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 启用/禁用通用频道 |
| `connectionMode` | enum | `"websocket"` | 连接模式：`"websocket"`、`"relay"` 或 `"webhook"` |
| `wsPort` | number | `8080` | WebSocket 服务器端口 |
| `wsPath` | string | `"/ws"` | WebSocket 端点路径 |
| `relay` | object | - | relay 反连配置：`url`、`channelId`、`secret` 等 |
| `auth` | object | - | 可选的一用户一 Token WebSocket 鉴权配置 |
| `webhookPath` | string | `"/generic/events"` | Webhook 端点路径 |
| `webhookPort` | number | `3000` | Webhook 服务器端口 |
| `webhookSecret` | string | - | 可选的 Webhook 签名密钥 |
| `dmPolicy` | enum | `"open"` | 私聊策略：`"open"`、`"pairing"` 或 `"allowlist"` |
| `allowFrom` | array | `[]` | 允许的发送者 ID（用于 allowlist 策略） |
| `historyLimit` | number | `10` | 群聊保留的历史消息数量 |
| `textChunkLimit` | number | `4000` | 每条消息的最大字符数 |
| `mediaMaxMb` | number | `30` | 入站媒体最大大小，单位 MB |

---

## 测试你的配置

1. 将配置保存到你的 OpenClaw 配置位置（当前环境通常是 `~/.openclaw/openclaw.json`）
2. 重启 OpenClaw Gateway：
   ```bash
   openclaw gateway restart
   ```
3. 检查日志确认通用频道启动成功：
   ```
   [generic] WebSocket server started on port 8080 at path /ws
   ```
4. 在浏览器中打开 `examples/h5-client.html`
5. 使用 `ws://localhost:8080/ws` 连接（或你配置的端口/路径）

---

## 环境特定配置

### 开发环境
```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    dmPolicy: "open"
```

### 生产环境
```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 18080
    wsPath: "/ws"
    dmPolicy: "allowlist"
    allowFrom:
      - "${APPROVED_USER_1}"
      - "${APPROVED_USER_2}"
session:
  dmScope: "per-account-channel-peer"
```

---

## 故障排除

### WebSocket 连接失败
- 检查端口是否被占用：`lsof -i :8080`
- 检查防火墙设置是否允许该端口
- 查看 OpenClaw 日志中的错误信息

### 消息没有被接收
- 确认客户端中的 chatId 与配置匹配
- 检查 dmPolicy 是否为 "allowlist"，且你的用户在 allowFrom 列表中
- 查看浏览器控制台和 OpenClaw 日志中的错误

### 配置未生效
- 配置修改后需要重启 OpenClaw
- 检查 YAML 语法是否正确（缩进很重要）
- 查看 OpenClaw 日志中的配置验证错误

---

## 网络与部署注意事项

### 本地开发

本地开发时，使用 WebSocket 模式和默认配置：
```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
```

H5 客户端连接到 `ws://localhost:8080/ws`。

### 生产环境部署

生产环境部署需要考虑以下因素：

1. **使用 HTTPS/WSS**
   - 在 OpenClaw 前面配置反向代理（nginx、Caddy 等）
   - 配置 SSL 证书
   - H5 客户端通过 `wss://your-domain.com/ws` 连接

2. **防火墙配置**
   - 开放 WebSocket 端口（默认：8080）
   - 云服务器需要更新安全组规则

3. **会话隔离**
   - 多用户 / 多 H5 窗口场景建议把 `session.dmScope` 设为 `per-account-channel-peer`
   - 这样可以避免不同用户误落到同一条 DM 线程

### 反向代理示例（nginx）

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### Docker 部署

```dockerfile
FROM node:20
WORKDIR /app
RUN npm install -g openclaw
RUN openclaw plugins install @clawlines/clawline
EXPOSE 8080
CMD ["openclaw", "gateway", "start"]
```

```bash
docker build -t openclaw-generic .
# 在运行时挂载配置文件（出于安全考虑推荐此方式）
docker run -p 8080:8080 -v /path/to/openclaw.json:/root/.openclaw/openclaw.json openclaw-generic
```

> **注意**：在运行时挂载 `openclaw.json`（或你的实际 OpenClaw 配置文件）而不是将其复制到镜像中，以避免在镜像中硬编码敏感凭据。

---

## 相关文档

- [文档索引](./README.md) - 当前保留文档
- [README](../README.md) - 概述及配置说明
- [接入指南](./INTEGRATION_GUIDE.md) - H5 / App / 小程序真实接入
- [H5 客户端示例](../examples/h5-client.html) - 可运行的演示客户端
