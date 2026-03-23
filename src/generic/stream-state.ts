/**
 * Chat-level streaming state store for 断点续传 (breakpoint resume).
 *
 * Unlike the per-connection pending buffer in client.ts, this store is keyed by
 * chatId + agentId and survives WebSocket disconnections. When a client reconnects
 * and selects an agent, the server checks this store and sends a `stream.resume`
 * event with accumulated text so the client can pick up where it left off.
 *
 * Lifecycle:
 *   text.delta  → accumulate text in store
 *   message.send → mark as completed, schedule cleanup
 *   TTL expiry  → auto-cleanup after 30 minutes of inactivity
 */

export type ChatStreamEntry = {
  /** Accumulated streaming text so far. */
  streamText: string;
  /** Whether streaming has finished (done=true or message.send received). */
  completed: boolean;
  /** Timestamp when streaming started. */
  startTime: number;
  /** Timestamp of most recent delta. */
  lastUpdate: number;
};

/** Key format: `${chatId}::${agentId}` */
const chatStreamStore = new Map<string, ChatStreamEntry>();

const STREAM_TTL_MS = 30 * 60 * 1000; // 30 minutes

function storeKey(chatId: string, agentId: string): string {
  return `${chatId}::${agentId}`;
}

/** Prune entries older than TTL. Called periodically. */
export function pruneExpiredStreams(): void {
  const now = Date.now();
  for (const [key, entry] of chatStreamStore) {
    if (now - entry.lastUpdate > STREAM_TTL_MS) {
      chatStreamStore.delete(key);
    }
  }
}

/**
 * Record a streaming delta. Called from sendStreamDelta().
 * Creates entry if not exists, appends text, updates timestamp.
 */
export function recordStreamDelta(chatId: string, agentId: string, text: string, done: boolean): void {
  const key = storeKey(chatId, agentId);
  let entry = chatStreamStore.get(key);

  if (!entry) {
    entry = {
      streamText: "",
      completed: false,
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };
    chatStreamStore.set(key, entry);
  }

  if (text) {
    // onPartialReply sends accumulated full text (not incremental deltas),
    // so replace rather than append to avoid duplication.
    entry.streamText = text;
  }
  if (done) {
    entry.completed = true;
  }
  entry.lastUpdate = Date.now();
}

/**
 * Mark a stream as completed. Called when message.send is emitted.
 * Does NOT remove the entry — it stays until the client reconnects and
 * picks it up, or until TTL expiry.
 */
export function markStreamCompleted(chatId: string, agentId: string): void {
  const key = storeKey(chatId, agentId);
  const entry = chatStreamStore.get(key);
  if (entry) {
    entry.completed = true;
    entry.lastUpdate = Date.now();
  }
}

/**
 * Get the current stream state for a chatId + agentId.
 * Returns undefined if no active/recent stream exists.
 */
export function getStreamState(chatId: string, agentId: string): ChatStreamEntry | undefined {
  const key = storeKey(chatId, agentId);
  const entry = chatStreamStore.get(key);
  if (!entry) return undefined;

  // Check TTL
  if (Date.now() - entry.lastUpdate > STREAM_TTL_MS) {
    chatStreamStore.delete(key);
    return undefined;
  }

  return entry;
}

/**
 * Consume (get and delete) stream state. Used when delivering stream.resume
 * to a reconnecting client — after delivery, the state is no longer needed.
 */
export function consumeStreamState(chatId: string, agentId: string): ChatStreamEntry | undefined {
  const key = storeKey(chatId, agentId);
  const entry = chatStreamStore.get(key);
  if (!entry) return undefined;

  // Check TTL
  if (Date.now() - entry.lastUpdate > STREAM_TTL_MS) {
    chatStreamStore.delete(key);
    return undefined;
  }

  // Only consume completed streams — if still streaming, keep it for future deltas.
  // For incomplete streams, return a snapshot but do NOT delete.
  if (entry.completed) {
    chatStreamStore.delete(key);
  }

  return { ...entry };
}

/** Clear a stream entry (e.g., when history.sync delivers the message). */
export function clearStreamState(chatId: string, agentId: string): void {
  chatStreamStore.delete(storeKey(chatId, agentId));
}

/** Get store size (for diagnostics). */
export function getStreamStoreSize(): number {
  return chatStreamStore.size;
}
