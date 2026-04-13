import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { ChannelThreadingContext, ChannelThreadingToolContext } from "openclaw/plugin-sdk/channel-contract";
import { randomUUID } from "node:crypto";

type ChannelThreadingAdapter = NonNullable<ChannelPlugin["threading"]>;

function stripTargetPrefix(to: string): string {
  return to.replace(/^(user|chat):/, "");
}

function normalizeThreadId(raw: string | number | null | undefined): string | undefined {
  return raw != null ? String(raw) : undefined;
}

export function threadConversationId(threadId: string): string {
  return `thread:${threadId}`;
}

export const clawlineThreadingAdapter: ChannelThreadingAdapter = {
  buildToolContext: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    context: ChannelThreadingContext;
    hasRepliedRef?: { value: boolean };
  }): ChannelThreadingToolContext | undefined => {
    const chatId =
      stripTargetPrefix(params.context.To ?? "") ||
      params.context.NativeChannelId;
    if (!chatId) return undefined;

    return {
      currentChannelId: chatId,
      currentThreadTs: normalizeThreadId(params.context.MessageThreadId),
      replyToMode: "all",
      hasRepliedRef: params.hasRepliedRef,
    };
  },

  resolveAutoThreadId: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    to: string;
    toolContext?: ChannelThreadingToolContext;
    replyToId?: string | null;
  }): string | undefined => {
    // If replying to a message in an existing thread, continue that thread
    if (params.replyToId) {
      return params.toolContext?.currentThreadTs;
    }

    // If a thread was already created during inbound processing (like Discord's autoThread),
    // reuse it instead of generating a new one
    if (params.toolContext?.currentThreadTs) {
      return params.toolContext.currentThreadTs;
    }

    const channelId = params.toolContext?.currentChannelId;
    if (!channelId) return undefined;

    return `clawline-thread-${randomUUID()}`;
  },

  resolveReplyTransport: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    threadId?: string | number | null;
    replyToId?: string | null;
  }) => ({
    replyToId: params.replyToId ?? undefined,
    threadId: params.threadId ?? null,
  }),

  resolveFocusedBinding: (params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    context: ChannelThreadingContext;
  }) => {
    const chatId = stripTargetPrefix(params.context.To ?? "");
    if (!chatId) return null;

    const threadId = normalizeThreadId(params.context.MessageThreadId);

    return {
      conversationId: threadId ? threadConversationId(threadId) : chatId,
      parentConversationId: threadId ? chatId : undefined,
      placement: (threadId ? "child" : "current") as "current" | "child",
      labelNoun: "conversation",
    };
  },
};
