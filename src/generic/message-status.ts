import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type MessageStatus = "sent" | "delivered" | "read" | "failed";

export type MessageStatusEvent = {
  messageId: string;
  chatId: string;
  status: MessageStatus;
  timestamp: number;
  error?: string;
};

// Store message statuses in memory (in production, consider using a database)
const messageStatuses = new Map<string, MessageStatusEvent>();

/**
 * Update message status and broadcast to client
 */
export function updateMessageStatus(params: {
  cfg: OpenClawConfig;
  messageId: string;
  chatId: string;
  status: MessageStatus;
  error?: string;
}): void {
  const { cfg, messageId, chatId, status, error } = params;

  const statusEvent: MessageStatusEvent = {
    messageId,
    chatId,
    status,
    timestamp: Date.now(),
    error,
  };

  // Store status
  const key = `${chatId}:${messageId}`;
  messageStatuses.set(key, statusEvent);

  // Broadcast to client
  broadcastMessageStatus({ cfg, event: statusEvent });
}

/**
 * Broadcast message status event to client
 */
export function broadcastMessageStatus(params: {
  cfg: OpenClawConfig;
  event: MessageStatusEvent;
}): void {
  const { cfg, event } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(event.chatId, {
      type: `status.${event.status}` as any,
      data: event,
    });
  }
}

/**
 * Get message status
 */
export function getMessageStatus(params: {
  messageId: string;
  chatId: string;
}): MessageStatusEvent | null {
  const { messageId, chatId } = params;
  const key = `${chatId}:${messageId}`;
  return messageStatuses.get(key) || null;
}

/**
 * Handle incoming status update from client
 */
export async function handleStatusUpdate(params: {
  cfg: OpenClawConfig;
  messageId: string;
  chatId: string;
  status: MessageStatus;
}): Promise<void> {
  const { cfg, messageId, chatId, status } = params;

  updateMessageStatus({
    cfg,
    messageId,
    chatId,
    status,
  });
}

/**
 * Clear old message statuses (cleanup)
 */
export function clearOldMessageStatuses(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleared = 0;

  for (const [key, status] of messageStatuses.entries()) {
    if (now - status.timestamp > maxAgeMs) {
      messageStatuses.delete(key);
      cleared++;
    }
  }

  return cleared;
}
