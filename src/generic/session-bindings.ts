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
