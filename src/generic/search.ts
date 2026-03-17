import type { InboundMessage } from "./types.js";

export type SearchQuery = {
  query: string;
  chatId?: string;
  senderId?: string;
  messageType?: "text" | "image" | "voice" | "audio" | "file";
  startDate?: number;
  endDate?: number;
  limit?: number;
  offset?: number;
};

export type SearchResult = {
  message: InboundMessage;
  score: number; // Relevance score 0-1
  highlights?: string[]; // Highlighted text snippets
};

export type SearchResponse = {
  results: SearchResult[];
  total: number;
  query: SearchQuery;
  timestamp: number;
};

// Store messages for search (in production, use a proper search engine like Elasticsearch)
const messageStore = new Map<string, InboundMessage>();
const chatMessageIndex = new Map<string, Set<string>>();
const senderMessageIndex = new Map<string, Set<string>>();

/**
 * Index a message for search
 */
export function indexMessage(message: InboundMessage): void {
  const messageId = message.messageId;

  // Store message
  messageStore.set(messageId, message);

  // Index by chat
  if (!chatMessageIndex.has(message.chatId)) {
    chatMessageIndex.set(message.chatId, new Set());
  }
  chatMessageIndex.get(message.chatId)!.add(messageId);

  // Index by sender
  if (!senderMessageIndex.has(message.senderId)) {
    senderMessageIndex.set(message.senderId, new Set());
  }
  senderMessageIndex.get(message.senderId)!.add(messageId);
}

/**
 * Remove a message from search index
 */
export function removeMessageFromIndex(params: { messageId: string; chatId: string }): void {
  const { messageId, chatId } = params;

  const message = messageStore.get(messageId);
  if (!message) {
    return;
  }

  // Remove from store
  messageStore.delete(messageId);

  // Remove from chat index
  chatMessageIndex.get(chatId)?.delete(messageId);

  // Remove from sender index
  senderMessageIndex.get(message.senderId)?.delete(messageId);
}

/**
 * Search messages
 */
export function searchMessages(query: SearchQuery): SearchResponse {
  const {
    query: searchText,
    chatId,
    senderId,
    messageType,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
  } = query;

  let candidateIds: Set<string> = new Set();

  // Filter by chat ID
  if (chatId) {
    candidateIds = chatMessageIndex.get(chatId) || new Set();
  } else if (senderId) {
    // Filter by sender ID
    candidateIds = senderMessageIndex.get(senderId) || new Set();
  } else {
    // All messages
    candidateIds = new Set(messageStore.keys());
  }

  const results: SearchResult[] = [];

  // Search through candidate messages
  for (const messageId of candidateIds) {
    const message = messageStore.get(messageId);
    if (!message) {
      continue;
    }

    // Apply filters
    if (messageType && message.messageType !== messageType) {
      continue;
    }

    if (startDate && message.timestamp < startDate) {
      continue;
    }

    if (endDate && message.timestamp > endDate) {
      continue;
    }

    // Text search
    const searchLower = searchText.toLowerCase();
    const contentLower = message.content.toLowerCase();
    const senderNameLower = message.senderName?.toLowerCase() || "";

    let score = 0;
    const highlights: string[] = [];

    if (contentLower.includes(searchLower)) {
      score += 1.0;

      // Extract highlight snippet
      const index = contentLower.indexOf(searchLower);
      const start = Math.max(0, index - 30);
      const end = Math.min(message.content.length, index + searchText.length + 30);
      const snippet = message.content.substring(start, end);
      highlights.push(snippet);
    }

    if (senderNameLower.includes(searchLower)) {
      score += 0.5;
    }

    if (message.messageId.includes(searchText)) {
      score += 0.3;
    }

    // Boost recent messages
    const age = Date.now() - message.timestamp;
    const dayInMs = 86400000;
    const recencyBoost = Math.max(0, 1 - age / (30 * dayInMs));
    score += recencyBoost * 0.2;

    if (score > 0) {
      results.push({
        message,
        score,
        highlights,
      });
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score);

  // Apply pagination
  const total = results.length;
  const paginatedResults = results.slice(offset, offset + limit);

  return {
    results: paginatedResults,
    total,
    query,
    timestamp: Date.now(),
  };
}

/**
 * Search messages by content
 */
export function searchByContent(params: {
  content: string;
  chatId?: string;
  limit?: number;
}): SearchResponse {
  return searchMessages({
    query: params.content,
    chatId: params.chatId,
    limit: params.limit,
  });
}

/**
 * Search messages by sender
 */
export function searchBySender(params: {
  senderId: string;
  chatId?: string;
  limit?: number;
}): SearchResponse {
  return searchMessages({
    query: "",
    senderId: params.senderId,
    chatId: params.chatId,
    limit: params.limit,
  });
}

/**
 * Search messages by date range
 */
export function searchByDateRange(params: {
  startDate: number;
  endDate: number;
  chatId?: string;
  limit?: number;
}): SearchResponse {
  return searchMessages({
    query: "",
    startDate: params.startDate,
    endDate: params.endDate,
    chatId: params.chatId,
    limit: params.limit,
  });
}

/**
 * Get message by ID
 */
export function getMessageById(messageId: string): InboundMessage | undefined {
  return messageStore.get(messageId);
}

/**
 * Get recent messages for a chat
 */
export function getRecentMessages(params: { chatId: string; limit?: number }): InboundMessage[] {
  const { chatId, limit = 50 } = params;

  const messageIds = chatMessageIndex.get(chatId);
  if (!messageIds) {
    return [];
  }

  const messages: InboundMessage[] = [];

  for (const messageId of messageIds) {
    const message = messageStore.get(messageId);
    if (message) {
      messages.push(message);
    }
  }

  // Sort by timestamp (descending)
  messages.sort((a, b) => b.timestamp - a.timestamp);

  return messages.slice(0, limit);
}

/**
 * Clear chat messages from index
 */
export function clearChatMessages(chatId: string): void {
  const messageIds = chatMessageIndex.get(chatId);
  if (!messageIds) {
    return;
  }

  for (const messageId of messageIds) {
    const message = messageStore.get(messageId);
    if (message) {
      removeMessageFromIndex({ messageId, chatId });
    }
  }

  chatMessageIndex.delete(chatId);
}
