import {
  registerSessionBindingAdapter,
  unregisterSessionBindingAdapter,
  type SessionBindingAdapter,
  type SessionBindingRecord,
  type SessionBindingBindInput,
  type SessionBindingUnbindInput,
  type ConversationRef,
} from "openclaw/plugin-sdk/conversation-runtime";
import { randomUUID } from "node:crypto";

const CHANNEL_ID = "clawline";

/**
 * Optional hooks for registering ACP threads in cl_threads via Supabase.
 * Passed from monitor.ts when RELAY_SUPABASE_URL and RELAY_SUPABASE_SERVICE_ROLE_KEY are available.
 */
export interface AcpThreadHooks {
  supabaseUrl: string;
  supabaseKey: string;
  channelId: string;
}

/**
 * Extract the UUID part from a clawline-thread-{UUID} thread ID.
 * Returns the input unchanged if it doesn't match the pattern.
 */
function extractThreadUuid(threadIdFull: string): string {
  const match = threadIdFull.match(/^clawline-thread-(.+)$/);
  return match ? match[1] : threadIdFull;
}

/**
 * Register an ACP thread in the cl_threads table via Supabase PostgREST.
 * Uses resolution=ignore-duplicates to handle races gracefully.
 */
async function registerAcpThread(params: {
  threadId: string;
  channelId: string;
  parentConversationId?: string;
  metadata?: Record<string, unknown>;
  hooks: AcpThreadHooks;
}): Promise<void> {
  const { threadId, channelId, parentConversationId, metadata, hooks } = params;
  const now = new Date().toISOString();
  const creatorId = String(metadata?.senderId || metadata?.userId || metadata?.creatorId || "acp");
  const parentMessageId = String(metadata?.messageId || metadata?.parentMessageId || parentConversationId || "");

  const row = {
    id: threadId,
    channel_id: channelId,
    parent_message_id: parentMessageId,
    creator_id: creatorId,
    title: null,
    status: "active",
    type: "acp",
    created_at: now,
    updated_at: now,
    last_reply_at: null,
    reply_count: 0,
    participant_ids: JSON.stringify([creatorId].filter((v) => v && v !== "acp")),
  };

  try {
    const res = await fetch(`${hooks.supabaseUrl}/pg/rest/v1/cl_threads`, {
      method: "POST",
      headers: {
        apikey: hooks.supabaseKey,
        authorization: `Bearer ${hooks.supabaseKey}`,
        "content-type": "application/json",
        prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify(row),
    });
    if (res.ok || res.status === 409) {
      console.log(`[session-binding] ACP thread registered: ${threadId}`);
    } else {
      const errText = await res.text();
      console.warn(`[session-binding] ACP thread registration failed: ${res.status} ${errText}`);
    }
  } catch (err: unknown) {
    console.warn(`[session-binding] ACP thread registration error:`, (err as Error).message);
  }
}

/**
 * Archive an ACP thread in cl_threads when the session is unbound.
 * Only archives if the current status is 'active'.
 */
async function archiveAcpThread(params: {
  threadId: string;
  hooks: AcpThreadHooks;
}): Promise<void> {
  const { threadId, hooks } = params;
  const now = new Date().toISOString();

  try {
    const res = await fetch(
      `${hooks.supabaseUrl}/pg/rest/v1/cl_threads?id=eq.${encodeURIComponent(threadId)}&status=eq.active`,
      {
        method: "PATCH",
        headers: {
          apikey: hooks.supabaseKey,
          authorization: `Bearer ${hooks.supabaseKey}`,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({ status: "archived", updated_at: now }),
      },
    );
    if (res.ok) {
      console.log(`[session-binding] ACP thread archived: ${threadId}`);
    } else {
      const errText = await res.text();
      console.warn(`[session-binding] ACP thread archival failed: ${res.status} ${errText}`);
    }
  } catch (err: unknown) {
    console.warn(`[session-binding] ACP thread archival error:`, (err as Error).message);
  }
}

// In-memory binding storage
const bindingsByConversation = new Map<string, SessionBindingRecord>();
const bindingsBySession = new Map<string, SessionBindingRecord[]>();
const bindingsById = new Map<string, SessionBindingRecord>();

function addRecord(record: SessionBindingRecord): void {
  const convId = record.conversation.conversationId;
  bindingsByConversation.set(convId, record);
  bindingsById.set(record.bindingId, record);
  const list = bindingsBySession.get(record.targetSessionKey) ?? [];
  list.push(record);
  bindingsBySession.set(record.targetSessionKey, list);
}

function removeRecord(record: SessionBindingRecord): void {
  bindingsByConversation.delete(record.conversation.conversationId);
  bindingsById.delete(record.bindingId);
  const list = bindingsBySession.get(record.targetSessionKey);
  if (list) {
    const idx = list.indexOf(record);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) bindingsBySession.delete(record.targetSessionKey);
  }
}

/**
 * Find a binding where the given chatId is the parentConversationId.
 * Used by reply-dispatcher to resolve threadId for ACP replies.
 */
export function findThreadIdByChatId(chatId: string): string | undefined {
  for (const [convId, record] of bindingsByConversation.entries()) {
    if (
      record.conversation.parentConversationId === chatId &&
      convId.startsWith("thread:")
    ) {
      return convId.slice(7); // strip "thread:" prefix
    }
  }
  return undefined;
}

export function createClawlineSessionBindingAdapter(
  accountId: string,
  hooks?: AcpThreadHooks,
): { adapter: SessionBindingAdapter; register: () => void; unregister: () => void } {
  const adapter: SessionBindingAdapter = {
    channel: CHANNEL_ID,
    accountId,
    capabilities: {
      placements: ["current", "child"],
      bindSupported: true,
      unbindSupported: true,
    },

    bind: async (input: SessionBindingBindInput): Promise<SessionBindingRecord | null> => {
      console.log(`[clawline session-binding] bind called: targetSessionKey=${input.targetSessionKey}, placement=${input.placement}, conversationId=${input.conversation.conversationId}, parentConversationId=${input.conversation.parentConversationId}`);
      const record: SessionBindingRecord = {
        bindingId: `clawline-bind-${randomUUID()}`,
        targetSessionKey: input.targetSessionKey,
        targetKind: input.targetKind,
        conversation: input.conversation,
        status: "active",
        boundAt: Date.now(),
        expiresAt: input.ttlMs ? Date.now() + input.ttlMs : undefined,
        metadata: input.metadata,
      };
      addRecord(record);

      // Register ACP thread in cl_threads when binding a thread conversation
      if (hooks && input.conversation.conversationId.startsWith("thread:")) {
        const threadIdRaw = input.conversation.conversationId.slice(7); // strip "thread:" prefix
        const threadId = extractThreadUuid(threadIdRaw);
        registerAcpThread({
          threadId,
          channelId: hooks.channelId,
          parentConversationId: input.conversation.parentConversationId,
          metadata: (input.metadata ?? undefined) as Record<string, unknown> | undefined,
          hooks,
        }).catch((err) => console.warn("[session-binding] ACP thread registration failed:", err));
      }

      return record;
    },

    listBySession: (targetSessionKey: string): SessionBindingRecord[] => {
      return bindingsBySession.get(targetSessionKey) ?? [];
    },

    resolveByConversation: (ref: ConversationRef): SessionBindingRecord | null => {
      if (ref.channel !== CHANNEL_ID) return null;
      return bindingsByConversation.get(ref.conversationId) ?? null;
    },

    touch: (bindingId: string, at?: number): void => {
      const record = bindingsById.get(bindingId);
      if (record) {
        (record as Record<string, unknown>).lastActivityAt = at ?? Date.now();
      }
    },

    unbind: async (input: SessionBindingUnbindInput): Promise<SessionBindingRecord[]> => {
      const removed: SessionBindingRecord[] = [];
      if (input.bindingId) {
        const record = bindingsById.get(input.bindingId);
        if (record) {
          removeRecord(record);
          removed.push(record);
        }
      } else if (input.targetSessionKey) {
        const list = [...(bindingsBySession.get(input.targetSessionKey) ?? [])];
        for (const record of list) {
          removeRecord(record);
          removed.push(record);
        }
      }

      // Archive ACP threads when session is unbound
      if (hooks) {
        for (const record of removed) {
          if (record.conversation.conversationId.startsWith("thread:")) {
            const threadIdRaw = record.conversation.conversationId.slice(7);
            const threadId = extractThreadUuid(threadIdRaw);
            archiveAcpThread({ threadId, hooks }).catch((err) =>
              console.warn("[session-binding] ACP thread archival failed:", err),
            );
          }
        }
      }

      return removed;
    },
  };

  return {
    adapter,
    register: () => {
      console.log(`[clawline session-binding] registering adapter for channel=${CHANNEL_ID}, accountId=${accountId}`);
      registerSessionBindingAdapter(adapter);
    },
    unregister: () => unregisterSessionBindingAdapter({ channel: CHANNEL_ID, accountId, adapter }),
  };
}
