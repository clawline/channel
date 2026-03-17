import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type MessageReaction = {
  messageId: string;
  chatId: string;
  senderId: string;
  emoji: string;
  timestamp: number;
};

export type ReactionEvent = {
  type: "reaction.add" | "reaction.remove";
  data: MessageReaction;
};

// Store reactions in memory (in production, you'd use a database)
const messageReactions = new Map<string, Map<string, MessageReaction[]>>();

/**
 * Add a reaction to a message
 */
export function addReaction(params: {
  messageId: string;
  chatId: string;
  senderId: string;
  emoji: string;
}): MessageReaction {
  const { messageId, chatId, senderId, emoji } = params;

  const key = `${chatId}:${messageId}`;
  if (!messageReactions.has(key)) {
    messageReactions.set(key, new Map());
  }

  const reactions = messageReactions.get(key)!;
  if (!reactions.has(emoji)) {
    reactions.set(emoji, []);
  }

  const reactionList = reactions.get(emoji)!;

  // Check if user already reacted with this emoji
  const existingIndex = reactionList.findIndex(r => r.senderId === senderId);

  const reaction: MessageReaction = {
    messageId,
    chatId,
    senderId,
    emoji,
    timestamp: Date.now(),
  };

  if (existingIndex >= 0) {
    // Update existing reaction timestamp
    reactionList[existingIndex] = reaction;
  } else {
    // Add new reaction
    reactionList.push(reaction);
  }

  return reaction;
}

/**
 * Remove a reaction from a message
 */
export function removeReaction(params: {
  messageId: string;
  chatId: string;
  senderId: string;
  emoji: string;
}): boolean {
  const { messageId, chatId, senderId, emoji } = params;

  const key = `${chatId}:${messageId}`;
  const reactions = messageReactions.get(key);

  if (!reactions) {
    return false;
  }

  const reactionList = reactions.get(emoji);
  if (!reactionList) {
    return false;
  }

  const index = reactionList.findIndex(r => r.senderId === senderId);
  if (index >= 0) {
    reactionList.splice(index, 1);

    // Clean up empty arrays
    if (reactionList.length === 0) {
      reactions.delete(emoji);
    }
    if (reactions.size === 0) {
      messageReactions.delete(key);
    }

    return true;
  }

  return false;
}

/**
 * Get all reactions for a message
 */
export function getMessageReactions(params: {
  messageId: string;
  chatId: string;
}): Map<string, MessageReaction[]> {
  const { messageId, chatId } = params;
  const key = `${chatId}:${messageId}`;
  return messageReactions.get(key) || new Map();
}

/**
 * Broadcast reaction event to all clients in a chat
 */
export function broadcastReaction(params: {
  cfg: OpenClawConfig;
  chatId: string;
  event: ReactionEvent;
}): void {
  const { cfg, chatId, event } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: event.type,
      data: event.data,
    });
  }
}

/**
 * Handle incoming reaction event from client
 */
export async function handleReactionEvent(params: {
  cfg: OpenClawConfig;
  event: ReactionEvent;
}): Promise<void> {
  const { cfg, event } = params;
  const { type, data } = event;

  if (type === "reaction.add") {
    addReaction(data);
  } else if (type === "reaction.remove") {
    removeReaction(data);
  }

  // Broadcast to all clients in the chat
  broadcastReaction({
    cfg,
    chatId: data.chatId,
    event,
  });
}
