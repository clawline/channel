import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ChannelCommandConversationContext } from "openclaw/plugin-sdk/channel-contract";
import { threadConversationId } from "./threading.js";

type ChannelConfiguredBindingProvider = NonNullable<ChannelPlugin["bindings"]>;
type BindingRef = { conversationId: string; parentConversationId?: string };
type BindingMatch = BindingRef & { matchPriority?: number };

function stripTargetPrefix(to: string): string {
  return to.replace(/^(user|chat):/, "");
}

export const clawlineBindingsProvider: ChannelConfiguredBindingProvider = {
  compileConfiguredBinding: (params: {
    binding: unknown;
    conversationId: string;
  }): BindingRef | null => ({
    conversationId: params.conversationId,
  }),

  matchInboundConversation: (params: {
    binding: unknown;
    compiledBinding: BindingRef;
    conversationId: string;
    parentConversationId?: string;
  }): BindingMatch | null => {
    // Exact match
    if (params.compiledBinding.conversationId === params.conversationId) {
      return {
        conversationId: params.conversationId,
        parentConversationId: params.parentConversationId,
      };
    }
    // Parent conversation match (thread binding scenario)
    if (
      params.parentConversationId &&
      params.compiledBinding.conversationId === params.parentConversationId
    ) {
      return {
        conversationId: params.conversationId,
        parentConversationId: params.parentConversationId,
        matchPriority: 1,
      };
    }
    return null;
  },

  resolveCommandConversation: (
    params: ChannelCommandConversationContext,
  ): BindingRef | null => {
    if (params.threadId) {
      return {
        conversationId: threadConversationId(params.threadId),
        parentConversationId:
          params.threadParentId || stripTargetPrefix(params.originatingTo ?? ""),
      };
    }
    const chatId = stripTargetPrefix(params.originatingTo ?? "");
    return chatId ? { conversationId: chatId } : null;
  },
};
