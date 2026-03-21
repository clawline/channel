import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { access, readFile } from "node:fs/promises";
import type { GenericChannelConfig, GenericSendResult, OutboundMessage, WSEventType } from "./types.js";
import { getGenericWSManager } from "./client.js";
import { appendOutboundHistoryMessage } from "./history.js";
import { inferMimeTypeFromSource } from "./media.js";
import { updateMessageStatus } from "./message-status.js";
import { resolveGenericAgentModel } from "./agents.js";

export type SendGenericMessageParams = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  contentType?: "text" | "markdown" | "image" | "voice" | "audio";
  mediaUrl?: string;
  mimeType?: string;
  chatType?: "direct" | "group";
  agentId?: string;
  meta?: OutboundMessage["meta"];
};

async function resolveOutboundMediaUrl(params: {
  mediaUrl?: string;
  mimeType?: string;
}): Promise<{ mediaUrl?: string; mimeType?: string }> {
  const { mediaUrl, mimeType } = params;

  if (!mediaUrl) {
    return { mediaUrl, mimeType };
  }

  if (/^(data:|https?:\/\/)/i.test(mediaUrl)) {
    return {
      mediaUrl,
      mimeType: mimeType ?? inferMimeTypeFromSource(mediaUrl),
    };
  }

  try {
    await access(mediaUrl);
    const buffer = await readFile(mediaUrl);
    const resolvedMimeType = mimeType ?? inferMimeTypeFromSource(mediaUrl) ?? "application/octet-stream";
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
  const { cfg, to, text, replyToMessageId, contentType = "text", mediaUrl, mimeType, chatType, agentId, meta } =
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
    meta: resolvedMeta,
  };

  // Send via live socket transports in websocket/relay mode.
  if (genericCfg.connectionMode === "websocket" || genericCfg.connectionMode === "relay") {
    const wsManager = getGenericWSManager();
    if (wsManager) {
      const sent = wsManager.sendToClient(target.chatId, {
        type: "message.send",
        data: outboundMessage,
      });

      if (sent) {
        appendOutboundHistoryMessage(outboundMessage, {
          chatType,
          agentId,
        });
        // Mark as sent
        updateMessageStatus({
          cfg,
          messageId,
          chatId: target.chatId,
          status: "sent",
        });
      } else {
        // Mark as failed if client not connected
        console.warn(`[generic] Client ${target.chatId} not connected, message failed`);
        updateMessageStatus({
          cfg,
          messageId,
          chatId: target.chatId,
          status: "failed",
          error: "Client not connected",
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
    appendOutboundHistoryMessage(outboundMessage, {
      chatType,
      agentId,
    });
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
}): Promise<void> {
  const { cfg, to, eventType, content = "", agentId } = params;
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
  mediaType: "image" | "voice" | "audio";
  mimeType?: string;
  caption?: string;
  replyToMessageId?: string;
  chatType?: "direct" | "group";
  agentId?: string;
  meta?: OutboundMessage["meta"];
}): Promise<GenericSendResult> {
  const { cfg, to, mediaUrl, mediaType, mimeType, caption = "", replyToMessageId, chatType, agentId, meta } = params;

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
    meta,
  });
}

// Send streaming text delta to client
export async function sendStreamDelta(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  done?: boolean;
}): Promise<void> {
  const { cfg, to, text, done = false } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg) {
    return;
  }

  const target = normalizeTarget(to);

  if (genericCfg.connectionMode === "websocket" || genericCfg.connectionMode === "relay") {
    const wsManager = getGenericWSManager();
    if (wsManager) {
      wsManager.sendToClient(target.chatId, {
        type: "text.delta" as WSEventType,
        data: {
          chatId: target.chatId,
          text,
          done,
          timestamp: Date.now(),
        },
      });
    }
  }
}
