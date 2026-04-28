import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { access, readFile } from "node:fs/promises";
import type { GenericChannelConfig, GenericSendResult, OutboundMessage, WSEventType } from "./types.js";
import { getGenericWSManager } from "./client.js";
// D8: appendOutboundHistoryMessage removed — gateway is source of truth for outbound persistence.
import { inferMimeTypeFromSource } from "./media.js";
import { updateMessageStatus } from "./message-status.js";
import { resolveGenericAgentModel } from "./agents.js";
import { basename } from "node:path";
import { recordStreamDelta, markStreamCompleted } from "./stream-state.js";

export type SendGenericMessageParams = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  contentType?: "text" | "markdown" | "image" | "voice" | "audio" | "file";
  mediaUrl?: string;
  mimeType?: string;
  chatType?: "direct" | "group";
  agentId?: string;
  threadId?: string;
  meta?: OutboundMessage["meta"];
};

async function resolveOutboundMediaUrl(params: {
  mediaUrl?: string;
  mimeType?: string;
  relayConfig?: GenericChannelConfig["relay"];
}): Promise<{ mediaUrl?: string; mimeType?: string }> {
  const { mediaUrl, mimeType, relayConfig } = params;

  if (!mediaUrl) {
    return { mediaUrl, mimeType };
  }

  // Already a URL or data URI — pass through
  if (/^(https?:\/\/)/i.test(mediaUrl)) {
    return {
      mediaUrl,
      mimeType: mimeType ?? inferMimeTypeFromSource(mediaUrl),
    };
  }

  // data: URI — if relay is available, upload it; otherwise pass through
  if (/^data:/i.test(mediaUrl)) {
    if (relayConfig?.url && relayConfig?.secret) {
      try {
        const uploaded = await uploadToRelay(mediaUrl, "file", relayConfig);
        if (uploaded) return uploaded;
      } catch (err) {
        console.warn("[clawline] relay upload failed for data URI, falling back:", err);
      }
    }
    return {
      mediaUrl,
      mimeType: mimeType ?? inferMimeTypeFromSource(mediaUrl),
    };
  }

  // Local file path — read and upload to relay (preferred) or convert to base64
  try {
    await access(mediaUrl);
    const buffer = await readFile(mediaUrl);
    const resolvedMimeType = mimeType ?? inferMimeTypeFromSource(mediaUrl) ?? "application/octet-stream";
    const fileName = basename(mediaUrl);

    // Try relay upload first
    if (relayConfig?.url && relayConfig?.secret) {
      try {
        const base64Data = buffer.toString("base64");
        const dataUri = `data:${resolvedMimeType};base64,${base64Data}`;
        const uploaded = await uploadToRelay(dataUri, fileName, relayConfig);
        if (uploaded) return uploaded;
      } catch (err) {
        console.warn("[clawline] relay upload failed, falling back to base64:", err);
      }
    }

    // Fallback: inline base64 data URI
    return {
      mediaUrl: `data:${resolvedMimeType};base64,${buffer.toString("base64")}`,
      mimeType: resolvedMimeType,
    };
  } catch {
    return {
      mediaUrl,
      mimeType: mimeType ?? inferMimeTypeFromSource(mediaUrl),
    };
  }
}

/** Upload a data URI or base64 to the relay server, return the public URL */
async function uploadToRelay(
  dataOrDataUri: string,
  fileName: string,
  relayConfig: NonNullable<GenericChannelConfig["relay"]>,
): Promise<{ mediaUrl: string; mimeType: string } | null> {
  // Derive HTTP base URL from relay WSS URL: wss://relay.restry.cn/backend → https://relay.restry.cn
  const relayWsUrl = relayConfig.url;
  const httpUrl = relayWsUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/backend\/?$/, "")
    .replace(/\/client\/?$/, "");

  const base64Match = dataOrDataUri.match(/^data:([^;]+);base64,(.+)$/s);
  const mimeType = base64Match?.[1] || "application/octet-stream";
  const base64Data = base64Match?.[2] || dataOrDataUri;

  const res = await fetch(`${httpUrl}/api/media/upload`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-channel-secret": relayConfig.secret,
    },
    body: JSON.stringify({
      data: base64Data,
      filename: fileName,
      mimeType,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[clawline] relay upload returned ${res.status}: ${text}`);
    return null;
  }

  const result = (await res.json()) as { ok: boolean; url?: string; mimeType?: string };
  if (result.ok && result.url) {
    console.log(`[clawline] uploaded media to relay: ${result.url}`);
    return { mediaUrl: result.url, mimeType: result.mimeType || mimeType };
  }
  return null;
}

function normalizeTarget(to: string): { chatId: string; type: "user" | "chat" } {
  // Parse target format: "user:xxx" or "chat:xxx" or just "xxx"
  if (to.startsWith("user:")) {
    return { chatId: to.substring(5), type: "user" };
  } else if (to.startsWith("chat:")) {
    return { chatId: to.substring(5), type: "chat" };
  } else {
    return { chatId: to, type: "user" };
  }
}

export async function sendMessageGeneric(params: SendGenericMessageParams): Promise<GenericSendResult> {
  const { cfg, to, text, replyToMessageId, contentType = "text", mediaUrl, mimeType, chatType, agentId, threadId, meta } =
    params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg) {
    throw new Error("Generic channel not configured");
  }

  const target = normalizeTarget(to);
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const resolvedMedia = await resolveOutboundMediaUrl({
    mediaUrl,
    mimeType,
    relayConfig: genericCfg.relay,
  });

  // Auto-fill meta.model from agent config when not explicitly provided
  const resolvedMeta = (() => {
    if (!agentId) return meta;
    const configModel = resolveGenericAgentModel(cfg, agentId);
    if (!configModel) return meta;
    if (meta?.model) return meta;
    return { ...meta, model: configModel };
  })();

  const outboundMessage: OutboundMessage = {
    messageId,
    chatId: target.chatId,
    content: text,
    contentType,
    mediaUrl: resolvedMedia.mediaUrl,
    mimeType: resolvedMedia.mimeType,
    replyTo: replyToMessageId,
    timestamp: Date.now(),
    ...(agentId ? { agentId } : {}),
    ...(threadId ? { threadId } : {}),
    meta: resolvedMeta,
  };

  console.log(`[clawline send] sendMessageGeneric to=${to} threadId=${threadId ?? "NONE"} msgId=${messageId}`);

  // Send via live socket transports in websocket/relay mode.
  if (genericCfg.connectionMode === "websocket" || genericCfg.connectionMode === "relay") {
    const wsManager = getGenericWSManager();
    if (wsManager) {
      const sent = wsManager.sendToClient(target.chatId, {
        type: "message.send",
        data: outboundMessage,
      });

      // D8: removed appendOutboundHistoryMessage — gateway persists outbound on backend ack.
      // Reconnect flow now uses gateway /api/messages/sync (Supabase) instead of local file.

      if (sent) {
        // Mark stream as completed at chat-level (断点续传)
        if (agentId) {
          markStreamCompleted(target.chatId, agentId);
        }

        // Mark as sent
        updateMessageStatus({
          cfg,
          messageId,
          chatId: target.chatId,
          status: "sent",
        });
      } else {
        // Client not connected — message is persisted in history for retrieval on reconnect
        console.warn(`[generic] Client ${target.chatId} not connected, message persisted for reconnect`);
        // Mark stream as completed so reconnecting client won't get stale stream state
        if (agentId) {
          markStreamCompleted(target.chatId, agentId);
        }
        updateMessageStatus({
          cfg,
          messageId,
          chatId: target.chatId,
          status: "sent",
        });
      }
    } else {
      // No WebSocket manager - mark as failed
      updateMessageStatus({
        cfg,
        messageId,
        chatId: target.chatId,
        status: "failed",
        error: "WebSocket manager not available",
      });
    }
  }

  if (genericCfg.connectionMode === "webhook") {
    // D8: webhook-mode local persistence removed — webhook itself is the response;
    // gateway/Supabase handles long-term persistence.
  }

  // In webhook mode, messages are sent synchronously as HTTP responses
  // The webhook handler will call this and send the response directly

  return {
    messageId,
    chatId: target.chatId,
  };
}

// Send thinking indicator to client
export async function sendThinkingIndicator(params: {
  cfg: OpenClawConfig;
  to: string;
  eventType: "thinking.start" | "thinking.update" | "thinking.end";
  content?: string;
  agentId?: string;
  threadId?: string;
}): Promise<void> {
  const { cfg, to, eventType, content = "", agentId, threadId } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg) {
    return;
  }

  const target = normalizeTarget(to);

  if (genericCfg.connectionMode === "websocket" || genericCfg.connectionMode === "relay") {
    const wsManager = getGenericWSManager();
    if (wsManager) {
      wsManager.sendToClient(target.chatId, {
        type: eventType,
        data: {
          chatId: target.chatId,
          content,
          agentId,
          timestamp: Date.now(),
          ...(threadId ? { threadId } : {}),
        },
      });
    }
  }
}

// Send media message (image/voice/audio)
export async function sendMediaGeneric(params: {
  cfg: OpenClawConfig;
  to: string;
  mediaUrl: string;
  mediaType: "image" | "voice" | "audio" | "file";
  mimeType?: string;
  caption?: string;
  replyToMessageId?: string;
  chatType?: "direct" | "group";
  agentId?: string;
  threadId?: string;
  meta?: OutboundMessage["meta"];
}): Promise<GenericSendResult> {
  const { cfg, to, mediaUrl, mediaType, mimeType, caption = "", replyToMessageId, chatType, agentId, threadId, meta } = params;

  return sendMessageGeneric({
    cfg,
    to,
    text: caption,
    contentType: mediaType,
    mediaUrl,
    mimeType,
    replyToMessageId,
    chatType,
    agentId,
    threadId,
    meta,
  });
}

// Send streaming text delta to client
export async function sendStreamDelta(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  done?: boolean;
  agentId?: string;
  threadId?: string;
  phase?: "thinking" | "answer";
}): Promise<void> {
  const { cfg, to, text, done = false, agentId, threadId, phase } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg) {
    return;
  }

  const target = normalizeTarget(to);

  if (genericCfg.connectionMode === "websocket" || genericCfg.connectionMode === "relay") {
    const wsManager = getGenericWSManager();
    if (wsManager) {
      // Record streaming state at chat-level for 断点续传 across disconnections.
      if (agentId) {
        recordStreamDelta(target.chatId, agentId, text, done);
      }

      wsManager.sendToClient(target.chatId, {
        type: "text.delta" as WSEventType,
        data: {
          chatId: target.chatId,
          text,
          done,
          timestamp: Date.now(),
          ...(agentId ? { agentId } : {}),
          ...(threadId ? { threadId } : {}),
          ...(phase ? { phase } : {}),
        },
      });
    }
  }
}
