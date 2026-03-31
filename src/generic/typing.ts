import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type TypingIndicator = {
  chatId: string;
  senderId: string;
  senderName?: string;
  isTyping: boolean;
  timestamp: number;
};

// Store active typing indicators
const activeTyping = new Map<string, Map<string, NodeJS.Timeout>>();

/**
 * Start typing indicator for a user
 */
export function startTyping(params: {
  chatId: string;
  senderId: string;
  senderName?: string;
  timeout?: number;
}): TypingIndicator {
  const { chatId, senderId, senderName, timeout = 5000 } = params;
  const key = chatId;

  if (!activeTyping.has(key)) {
    activeTyping.set(key, new Map());
  }

  const typingMap = activeTyping.get(key)!;

  // Clear existing timeout for this user
  const existingTimeout = typingMap.get(senderId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Set new timeout to auto-stop typing
  const timer = setTimeout(() => {
    stopTyping({ chatId, senderId });
  }, timeout);

  typingMap.set(senderId, timer);

  return {
    chatId,
    senderId,
    senderName,
    isTyping: true,
    timestamp: Date.now(),
  };
}

/**
 * Stop typing indicator for a user
 */
export function stopTyping(params: { chatId: string; senderId: string }): TypingIndicator {
  const { chatId, senderId } = params;
  const key = chatId;

  const typingMap = activeTyping.get(key);
  if (typingMap) {
    const timer = typingMap.get(senderId);
    if (timer) {
      clearTimeout(timer);
      typingMap.delete(senderId);
    }

    if (typingMap.size === 0) {
      activeTyping.delete(key);
    }
  }

  return {
    chatId,
    senderId,
    isTyping: false,
    timestamp: Date.now(),
  };
}

/**
 * Get all users currently typing in a chat
 */
export function getTypingUsers(chatId: string): string[] {
  const typingMap = activeTyping.get(chatId);
  if (!typingMap) {
    return [];
  }

  return Array.from(typingMap.keys());
}

/**
 * Check if a specific user is typing
 */
export function isUserTyping(params: { chatId: string; senderId: string }): boolean {
  const { chatId, senderId } = params;
  const typingMap = activeTyping.get(chatId);
  return typingMap?.has(senderId) ?? false;
}

/**
 * Broadcast typing indicator to clients
 */
export function broadcastTypingIndicator(params: {
  cfg: OpenClawConfig;
  chatId: string;
  indicator: TypingIndicator;
}): void {
  const { cfg, chatId, indicator } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: "typing",
      data: indicator,
    });
  }
}

/**
 * Handle incoming typing indicator from client
 */
export async function handleTypingIndicator(params: {
  cfg: OpenClawConfig;
  indicator: TypingIndicator;
}): Promise<void> {
  const { cfg, indicator } = params;

  let processedIndicator: TypingIndicator;

  if (indicator.isTyping) {
    processedIndicator = startTyping(indicator);
  } else {
    processedIndicator = stopTyping(indicator);
  }

  // Broadcast to all clients in the chat (except sender)
  broadcastTypingIndicator({
    cfg,
    chatId: indicator.chatId,
    indicator: processedIndicator,
  });
}
