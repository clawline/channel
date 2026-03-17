import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type PinnedMessage = {
  messageId: string;
  chatId: string;
  pinnedBy: string;
  pinnedAt: number;
  expiresAt?: number;
};

export type StarredMessage = {
  messageId: string;
  chatId: string;
  starredBy: string;
  starredAt: number;
  note?: string;
};

// Store pinned and starred messages
const pinnedMessages = new Map<string, PinnedMessage[]>();
const starredMessages = new Map<string, StarredMessage[]>();
const userStarredMessages = new Map<string, Set<string>>();

/**
 * Pin a message in a chat
 */
export function pinMessage(params: {
  messageId: string;
  chatId: string;
  pinnedBy: string;
  expiresAt?: number;
}): PinnedMessage {
  const { messageId, chatId, pinnedBy, expiresAt } = params;
  const key = chatId;

  if (!pinnedMessages.has(key)) {
    pinnedMessages.set(key, []);
  }

  const pins = pinnedMessages.get(key)!;

  // Check if already pinned
  const existingIndex = pins.findIndex(p => p.messageId === messageId);

  const pinned: PinnedMessage = {
    messageId,
    chatId,
    pinnedBy,
    pinnedAt: Date.now(),
    expiresAt,
  };

  if (existingIndex >= 0) {
    pins[existingIndex] = pinned;
  } else {
    // Add to beginning (most recent first)
    pins.unshift(pinned);

    // Limit to 3 pinned messages per chat (like WhatsApp)
    if (pins.length > 3) {
      pins.pop();
    }
  }

  // Set auto-unpin timer if expires
  if (expiresAt) {
    const timeout = expiresAt - Date.now();
    if (timeout > 0) {
      setTimeout(() => {
        unpinMessage({ messageId, chatId });
      }, timeout);
    }
  }

  return pinned;
}

/**
 * Unpin a message from a chat
 */
export function unpinMessage(params: { messageId: string; chatId: string }): boolean {
  const { messageId, chatId } = params;
  const key = chatId;

  const pins = pinnedMessages.get(key);
  if (!pins) {
    return false;
  }

  const index = pins.findIndex(p => p.messageId === messageId);
  if (index >= 0) {
    pins.splice(index, 1);

    if (pins.length === 0) {
      pinnedMessages.delete(key);
    }

    return true;
  }

  return false;
}

/**
 * Get all pinned messages in a chat
 */
export function getPinnedMessages(chatId: string): PinnedMessage[] {
  const pins = pinnedMessages.get(chatId) || [];

  // Filter out expired pins
  const now = Date.now();
  return pins.filter(pin => !pin.expiresAt || pin.expiresAt > now);
}

/**
 * Check if a message is pinned
 */
export function isMessagePinned(params: { messageId: string; chatId: string }): boolean {
  const { messageId, chatId } = params;
  const pins = getPinnedMessages(chatId);
  return pins.some(p => p.messageId === messageId);
}

/**
 * Star a message (personal bookmark)
 */
export function starMessage(params: {
  messageId: string;
  chatId: string;
  starredBy: string;
  note?: string;
}): StarredMessage {
  const { messageId, chatId, starredBy, note } = params;
  const key = starredBy;

  if (!starredMessages.has(key)) {
    starredMessages.set(key, []);
  }

  const stars = starredMessages.get(key)!;

  // Check if already starred
  const existingIndex = stars.findIndex(s => s.messageId === messageId && s.chatId === chatId);

  const starred: StarredMessage = {
    messageId,
    chatId,
    starredBy,
    starredAt: Date.now(),
    note,
  };

  if (existingIndex >= 0) {
    stars[existingIndex] = starred;
  } else {
    stars.unshift(starred);
  }

  // Index by user
  if (!userStarredMessages.has(starredBy)) {
    userStarredMessages.set(starredBy, new Set());
  }
  userStarredMessages.get(starredBy)!.add(`${chatId}:${messageId}`);

  return starred;
}

/**
 * Unstar a message
 */
export function unstarMessage(params: {
  messageId: string;
  chatId: string;
  starredBy: string;
}): boolean {
  const { messageId, chatId, starredBy } = params;
  const key = starredBy;

  const stars = starredMessages.get(key);
  if (!stars) {
    return false;
  }

  const index = stars.findIndex(s => s.messageId === messageId && s.chatId === chatId);
  if (index >= 0) {
    stars.splice(index, 1);

    if (stars.length === 0) {
      starredMessages.delete(key);
    }

    // Remove from user index
    userStarredMessages.get(starredBy)?.delete(`${chatId}:${messageId}`);

    return true;
  }

  return false;
}

/**
 * Get all starred messages for a user
 */
export function getStarredMessages(params: {
  userId: string;
  chatId?: string;
}): StarredMessage[] {
  const { userId, chatId } = params;

  const stars = starredMessages.get(userId) || [];

  if (chatId) {
    return stars.filter(s => s.chatId === chatId);
  }

  return stars;
}

/**
 * Check if a message is starred by a user
 */
export function isMessageStarred(params: {
  messageId: string;
  chatId: string;
  userId: string;
}): boolean {
  const { messageId, chatId, userId } = params;
  const key = `${chatId}:${messageId}`;
  return userStarredMessages.get(userId)?.has(key) ?? false;
}

/**
 * Get starred message count for a user
 */
export function getStarredCount(userId: string): number {
  return starredMessages.get(userId)?.length || 0;
}

/**
 * Broadcast pin event to all clients in chat
 */
export function broadcastPinEvent(params: {
  cfg: OpenClawConfig;
  chatId: string;
  event: "message.pin" | "message.unpin";
  pinned: PinnedMessage;
}): void {
  const { cfg, chatId, event, pinned } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: event,
      data: pinned,
    });
  }
}

/**
 * Handle pin message request
 */
export async function handlePinMessage(params: {
  cfg: OpenClawConfig;
  messageId: string;
  chatId: string;
  pinnedBy: string;
  expiresAt?: number;
}): Promise<void> {
  const { cfg, messageId, chatId, pinnedBy, expiresAt } = params;

  const pinned = pinMessage({
    messageId,
    chatId,
    pinnedBy,
    expiresAt,
  });

  broadcastPinEvent({
    cfg,
    chatId,
    event: "message.pin",
    pinned,
  });
}

/**
 * Handle unpin message request
 */
export async function handleUnpinMessage(params: {
  cfg: OpenClawConfig;
  messageId: string;
  chatId: string;
}): Promise<void> {
  const { cfg, messageId, chatId } = params;

  const pins = pinnedMessages.get(chatId);
  const pinned = pins?.find(p => p.messageId === messageId);

  if (!pinned) {
    return;
  }

  unpinMessage({ messageId, chatId });

  broadcastPinEvent({
    cfg,
    chatId,
    event: "message.unpin",
    pinned,
  });
}

/**
 * Handle star message request (no broadcast, personal action)
 */
export async function handleStarMessage(params: {
  messageId: string;
  chatId: string;
  starredBy: string;
  note?: string;
}): Promise<StarredMessage> {
  return starMessage(params);
}

/**
 * Handle unstar message request
 */
export async function handleUnstarMessage(params: {
  messageId: string;
  chatId: string;
  starredBy: string;
}): Promise<boolean> {
  return unstarMessage(params);
}
