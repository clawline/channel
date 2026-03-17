# Clawline Configuration Examples

## Quick Start Guide

### Step 1: Install the Plugin

Choose one of the following methods:

**Option A: Using OpenClaw CLI (Recommended)**
```bash
openclaw plugins install @restry/clawline
```

**Option B: Using npm**
```bash
npm install @restry/clawline
```

### Step 2: Plugin Location

After installation, the plugin is automatically placed in the OpenClaw extensions directory:
- **Linux/macOS**: `~/.openclaw/extensions/clawline/`
- **Windows**: `%USERPROFILE%\.openclaw\extensions\clawline\`

You don't need to move any files manually - the OpenClaw plugin system handles this.

### Step 3: Configure the Channel

Edit your OpenClaw config file (in current setups this is typically `~/.openclaw/openclaw.json`; use `openclaw config path` to confirm). The structural examples below still use YAML for readability:

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

### Step 3 Add-on: If the port is exposed publicly, add simple token auth

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

Recommended global session isolation for multi-user access:

```yaml
session:
  dmScope: "per-account-channel-peer"
```

Or use the CLI:
```bash
openclaw config set channels.clawline.enabled true
openclaw config set channels.clawline.connectionMode websocket
openclaw config set channels.clawline.wsPort 8080
```

### Step 4: Start OpenClaw

```bash
openclaw gateway restart
```

You should see in the logs:
```
[generic] WebSocket server started on port 8080 at path /ws
```

### Step 5: Connect with H5 Client

There are two ways to connect:

#### Option A: Use the Included Example Client

1. Locate the example client file:
   - If installed via npm: `node_modules/@restry/clawline/examples/h5-client.html`
   - If installed via OpenClaw: `~/.openclaw/extensions/clawline/examples/h5-client.html`

2. Open `h5-client.html` in your web browser (double-click or use `file://` URL)

3. In the connection form:
   - **WebSocket URL**: `ws://localhost:8080/ws` (adjust host/port as needed)
   - **Chat ID**: Any unique identifier (e.g., `user-123`)
   - **Your Name**: Your display name

4. Click **Connect** and start chatting!

For real H5 / App / WeChat Mini Program access, read `./INTEGRATION_GUIDE.md` next.

#### Option B: Integrate into Your Own H5 Page

Add WebSocket connection code to your H5 application:

```javascript
// Connect to Clawline
const ws = new WebSocket('ws://localhost:8080/ws?chatId=user-123');

ws.onopen = () => {
  console.log('Connected to AI');
};

// Send a message
function sendMessage(text) {
  ws.send(JSON.stringify({
    type: 'message.receive',
    data: {
      messageId: 'msg-' + Date.now(),
      chatId: 'user-123',
      chatType: 'direct',
      senderId: 'user-123',
      senderName: 'User',
      messageType: 'text',
      content: text,
      timestamp: Date.now()
    }
  }));
}

// Receive AI responses
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'message.send') {
    console.log('AI says:', msg.data.content);
  }
};
```

---

## Configuration Examples

### Example 1: WebSocket Mode (Default)

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

### Example 2: Relay Mode (Recommended for Public Deployments)

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

Companion relay-gateway:

```bash
cd src/relay-gateway
npm install
RELAY_PORT=19080 \\
RELAY_CHANNELS_JSON='{"demo":{"secret":"replace-me"}}' \\
npm start
```

### Example 3: Webhook Mode

This example is kept only for configuration completeness. Current recommended paths are direct `websocket` for local/private networks and `relay` for public deployments.

```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "webhook"
    webhookPath: "/generic/events"
    webhookPort: 3000
    webhookSecret: "your-secret-key"
    dmPolicy: "open"
    historyLimit: 10
    textChunkLimit: 4000
```

### Example 4: With Allowlist (Restricted Access)

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

### Example 5: Pairing Mode (Approval Required)

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

### Example 6: Auto-transcribe voice/audio with faster-whisper

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

Notes:
- `ffmpeg` is required on the gateway host
- The Python runtime above must have `faster-whisper` installed
- When enabled, inbound `voice` and `audio` messages are transcribed and injected into agent context automatically

### Recommended Production Baseline

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

Why this baseline:
- `websocket` is the current primary access path
- `dmScope` avoids different users sharing one DM thread
- `mediaMaxMb` keeps image / audio uploads bounded

## Testing Your Configuration

1. Save your config to your OpenClaw config location (typically `~/.openclaw/openclaw.json`)
2. Restart the OpenClaw gateway:
   ```bash
   openclaw gateway restart
   ```
3. Check the logs to verify the Clawline started successfully:
   ```
   [generic] WebSocket server started on port 8080 at path /ws
   ```
4. Open `examples/h5-client.html` in your browser
5. Connect using `ws://localhost:8080/ws` (or your configured port/path)

## Environment-Specific Configurations

### Development
```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
    dmPolicy: "open"
```

### Production
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

## Troubleshooting

### WebSocket Connection Failed
- Check if the port is already in use: `lsof -i :8080`
- Verify firewall settings allow the port
- Check OpenClaw logs for error messages

### Messages Not Being Received
- Verify the chatId in your client matches what you configured
- Check if dmPolicy is "allowlist" and your user is in allowFrom
- Look for errors in browser console and OpenClaw logs

### Configuration Not Applied
- Restart OpenClaw after config changes
- Verify YAML syntax is correct (indentation matters)
- Check OpenClaw logs for config validation errors

---

## Network & Deployment Considerations

### Local Development

For local development, use WebSocket mode with default settings:
```yaml
channels:
  clawline:
    enabled: true
    connectionMode: "websocket"
    wsPort: 8080
```

The H5 client connects to `ws://localhost:8080/ws`.

### Production Deployment

For production, consider these factors:

1. **Use HTTPS/WSS**
   - Place a reverse proxy (nginx, Caddy, etc.) in front of OpenClaw
   - Configure SSL certificates
   - H5 clients connect via `wss://your-domain.com/ws`

2. **Firewall Configuration**
   - Open the WebSocket port (default: 8080)
   - For cloud servers, update security groups accordingly

3. **Session Isolation**
   - For multiple users / multiple H5 windows, set `session.dmScope` to `per-account-channel-peer`
   - This prevents different users from falling into the same DM thread

### Reverse Proxy Example (nginx)

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

### Docker Deployment

```dockerfile
FROM node:20
WORKDIR /app
RUN npm install -g openclaw
RUN openclaw plugins install @restry/clawline
EXPOSE 8080
CMD ["openclaw", "gateway", "start"]
```

```bash
docker build -t openclaw-generic .
# Mount config at runtime (recommended for security)
docker run -p 8080:8080 -v /path/to/openclaw.json:/root/.openclaw/openclaw.json openclaw-generic
```

> **Note**: Mount `openclaw.json` (or your actual OpenClaw config file) at runtime instead of copying it into the image to avoid hardcoding sensitive credentials.

---

## See Also

- [Documentation Index](./README.md) - Current docs
- [README](../README.md) - Overview and setup
- [Integration Guide](./INTEGRATION_GUIDE.md) - Real H5 / App / Mini Program access
- [H5 Client Example](../examples/h5-client.html) - Working demo client
