import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type MessageStatus = "sent" | "delivered" | "read";

export type MessageStatusUpdate = {
  messageId: string;
  chatId: string;
  senderId: string;
  status: MessageStatus;
  timestamp: number;
};

export type ReadReceipt = {
  messageId: string;
  chatId: string;
  readBy: string;
  readAt: number;
};

// Store message statuses
const messageStatuses = new Map<string, Map<string, MessageStatusUpdate>>();
const readReceipts = new Map<string, ReadReceipt[]>();

/**
 * Update message delivery status
 */
export function updateMessageStatus(params: {
  messageId: string;
  chatId: string;
  senderId: string;
  status: MessageStatus;
}): MessageStatusUpdate {
  const { messageId, chatId, senderId, status } = params;
  const key = `${chatId}:${messageId}`;

  if (!messageStatuses.has(key)) {
    messageStatuses.set(key, new Map());
  }

  const statusMap = messageStatuses.get(key)!;

  const statusUpdate: MessageStatusUpdate = {
    messageId,
    chatId,
    senderId,
    status,
    timestamp: Date.now(),
  };

  statusMap.set(senderId, statusUpdate);

  return statusUpdate;
}

/**
 * Mark message as read
 */
export function markMessageAsRead(params: {
  messageId: string;
  chatId: string;
  readBy: string;
}): ReadReceipt {
  const { messageId, chatId, readBy } = params;
  const key = `${chatId}:${messageId}`;

  if (!readReceipts.has(key)) {
    readReceipts.set(key, []);
  }

  const receipts = readReceipts.get(key)!;

  // Check if already marked as read by this user
  const existingIndex = receipts.findIndex(r => r.readBy === readBy);

  const receipt: ReadReceipt = {
    messageId,
    chatId,
    readBy,
    readAt: Date.now(),
  };

  if (existingIndex >= 0) {
    // Update existing receipt
    receipts[existingIndex] = receipt;
  } else {
    // Add new receipt
    receipts.push(receipt);
  }

  // Also update the status
  updateMessageStatus({
    messageId,
    chatId,
    senderId: readBy,
    status: "read",
  });

  return receipt;
}

/**
 * Get message status for a specific user
 */
export function getMessageStatus(params: {
  messageId: string;
  chatId: string;
  senderId: string;
}): MessageStatusUpdate | undefined {
  const key = `${params.chatId}:${params.messageId}`;
  const statusMap = messageStatuses.get(key);
  return statusMap?.get(params.senderId);
}

/**
 * Get all read receipts for a message
 */
export function getReadReceipts(params: {
  messageId: string;
  chatId: string;
}): ReadReceipt[] {
  const key = `${params.chatId}:${params.messageId}`;
  return readReceipts.get(key) || [];
}

/**
 * Get overall message status (most advanced status)
 */
export function getOverallMessageStatus(params: {
  messageId: string;
  chatId: string;
}): MessageStatus {
  const key = `${params.chatId}:${params.messageId}`;
  const statusMap = messageStatuses.get(key);

  if (!statusMap || statusMap.size === 0) {
    return "sent";
  }

  let hasRead = false;
  let hasDelivered = false;

  for (const status of statusMap.values()) {
    if (status.status === "read") {
      hasRead = true;
    } else if (status.status === "delivered") {
      hasDelivered = true;
    }
  }

  if (hasRead) {
    return "read";
  } else if (hasDelivered) {
    return "delivered";
  }

  return "sent";
}

/**
 * Broadcast status update to clients
 */
export function broadcastStatusUpdate(params: {
  cfg: OpenClawConfig;
  chatId: string;
  statusUpdate: MessageStatusUpdate;
}): void {
  const { cfg, chatId, statusUpdate } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: statusUpdate.status === "delivered" ? "status.delivered" : "status.read",
      data: statusUpdate,
    });
  }
}

/**
 * Handle incoming status update from client
 */
export async function handleStatusUpdate(params: {
  cfg: OpenClawConfig;
  statusUpdate: MessageStatusUpdate;
}): Promise<void> {
  const { cfg, statusUpdate } = params;

  const updated = updateMessageStatus(statusUpdate);

  // If marked as read, also create read receipt
  if (statusUpdate.status === "read") {
    markMessageAsRead({
      messageId: statusUpdate.messageId,
      chatId: statusUpdate.chatId,
      readBy: statusUpdate.senderId,
    });
  }

  // Broadcast to all clients in the chat
  broadcastStatusUpdate({
    cfg,
    chatId: statusUpdate.chatId,
    statusUpdate: updated,
  });
}
