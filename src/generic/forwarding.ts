import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig, InboundMessage } from "./types.js";
import { getGenericWSManager } from "./client.js";
import { sendMessageGeneric, sendMediaGeneric } from "./send.js";

export type ForwardedMessage = {
  originalMessageId: string;
  originalChatId: string;
  originalSenderId: string;
  originalSenderName?: string;
  forwardedBy: string;
  forwardedByName?: string;
  targetChatId: string;
  timestamp: number;
  content: string;
  messageType: "text" | "image" | "voice" | "audio" | "file";
  mediaUrl?: string;
  mimeType?: string;
};

export type ForwardEvent = {
  type: "message.forward";
  data: ForwardedMessage;
};

// Track forwarded messages
const forwardedMessages = new Map<string, ForwardedMessage[]>();

/**
 * Forward a message to another chat
 */
export async function forwardMessage(params: {
  cfg: OpenClawConfig;
  originalMessageId: string;
  originalChatId: string;
  originalSenderId: string;
  originalSenderName?: string;
  forwardedBy: string;
  forwardedByName?: string;
  targetChatId: string;
  content: string;
  messageType: "text" | "image" | "voice" | "audio" | "file";
  mediaUrl?: string;
  mimeType?: string;
}): Promise<ForwardedMessage> {
  const {
    cfg,
    originalMessageId,
    originalChatId,
    originalSenderId,
    originalSenderName,
    forwardedBy,
    forwardedByName,
    targetChatId,
    content,
    messageType,
    mediaUrl,
    mimeType,
  } = params;

  const forwarded: ForwardedMessage = {
    originalMessageId,
    originalChatId,
    originalSenderId,
    originalSenderName,
    forwardedBy,
    forwardedByName,
    targetChatId,
    timestamp: Date.now(),
    content,
    messageType,
    mediaUrl,
    mimeType,
  };

  // Store forwarded message reference
  const key = `${targetChatId}:${originalMessageId}`;
  if (!forwardedMessages.has(key)) {
    forwardedMessages.set(key, []);
  }
  forwardedMessages.get(key)!.push(forwarded);

  // Send the forwarded message to target chat
  const forwardLabel = `[Forwarded from ${originalSenderName || originalSenderId}]`;
  const forwardedContent = `${forwardLabel}\n\n${content}`;

  if (messageType === "text") {
    await sendMessageGeneric({
      cfg,
      to: `chat:${targetChatId}`,
      text: forwardedContent,
      contentType: "text",
    });
  } else if (messageType === "image" || messageType === "voice" || messageType === "audio") {
    await sendMediaGeneric({
      cfg,
      to: `chat:${targetChatId}`,
      mediaUrl: mediaUrl ?? "",
      mediaType: messageType,
      mimeType,
      caption: forwardedContent,
    });
  } else {
    const fileText = mediaUrl ? `${forwardedContent}\n\nFile URL: ${mediaUrl}` : forwardedContent;
    await sendMessageGeneric({
      cfg,
      to: `chat:${targetChatId}`,
      text: fileText,
      contentType: "text",
    });
  }

  return forwarded;
}

/**
 * Forward multiple messages to a chat
 */
export async function forwardMultipleMessages(params: {
  cfg: OpenClawConfig;
  messages: Array<{
    messageId: string;
    chatId: string;
    senderId: string;
    senderName?: string;
    content: string;
    messageType: "text" | "image" | "voice" | "audio" | "file";
    mediaUrl?: string;
    mimeType?: string;
  }>;
  forwardedBy: string;
  forwardedByName?: string;
  targetChatId: string;
}): Promise<ForwardedMessage[]> {
  const { cfg, messages, forwardedBy, forwardedByName, targetChatId } = params;

  const forwarded: ForwardedMessage[] = [];

  for (const msg of messages) {
    const result = await forwardMessage({
      cfg,
      originalMessageId: msg.messageId,
      originalChatId: msg.chatId,
      originalSenderId: msg.senderId,
      originalSenderName: msg.senderName,
      forwardedBy,
      forwardedByName,
      targetChatId,
      content: msg.content,
      messageType: msg.messageType,
      mediaUrl: msg.mediaUrl,
      mimeType: msg.mimeType,
    });
    forwarded.push(result);
  }

  return forwarded;
}

/**
 * Get forwarded messages for a chat
 */
export function getForwardedMessages(params: {
  chatId: string;
  originalMessageId?: string;
}): ForwardedMessage[] {
  const { chatId, originalMessageId } = params;

  if (originalMessageId) {
    const key = `${chatId}:${originalMessageId}`;
    return forwardedMessages.get(key) || [];
  }

  // Get all forwarded messages for this chat
  const result: ForwardedMessage[] = [];
  for (const [key, messages] of forwardedMessages.entries()) {
    if (key.startsWith(`${chatId}:`)) {
      result.push(...messages);
    }
  }

  return result;
}

/**
 * Broadcast forward event to clients
 */
export function broadcastForwardEvent(params: {
  cfg: OpenClawConfig;
  chatId: string;
  forwarded: ForwardedMessage;
}): void {
  const { cfg, chatId, forwarded } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: "message.forward",
      data: forwarded,
    });
  }
}

/**
 * Handle incoming forward request from client
 */
export async function handleForwardRequest(params: {
  cfg: OpenClawConfig;
  forward: ForwardedMessage;
}): Promise<void> {
  const { cfg, forward } = params;

  const result = await forwardMessage({
    cfg,
    ...forward,
  });

  // Broadcast to target chat
  broadcastForwardEvent({
    cfg,
    chatId: forward.targetChatId,
    forwarded: result,
  });
}
