import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { createReplyReferencePlanner } from "openclaw/plugin-sdk/reply-runtime";
import { createReplyPrefixContext, createTypingCallbacks } from "openclaw/plugin-sdk/channel-runtime";
import { logTypingFailure } from "openclaw/plugin-sdk/channel-feedback";
import { getSessionBindingService } from "openclaw/plugin-sdk/conversation-runtime";
import { findThreadIdByChatId } from "./session-bindings.js";
import type { GenericChannelConfig } from "./types.js";
import { getGenericRuntime } from "./runtime.js";
import { sendMessageGeneric, sendThinkingIndicator, sendStreamDelta } from "./send.js";
import { extractDelegateDirectives, stripDelegateTags, dispatchDelegates, type HandleMessageFn } from "./delegate.js";

export type CreateGenericReplyDispatcherParams = {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  chatType: "direct" | "group";
  replyToMessageId?: string;
  sessionKey?: string;
  /**
   * The threadId carried by the inbound message that this dispatcher is replying to.
   * Used as the highest-priority threadId source so the agent's reply lands in the
   * same thread the user sent from — even when session bindings haven't caught up
   * (TH-1: previously resolveThreadId silently returned undefined and the reply
   * leaked into main chat).
   */
  inboundThreadId?: string;
  handleMessage?: HandleMessageFn;
};

export function createGenericReplyDispatcher(params: CreateGenericReplyDispatcherParams) {
  const core = getGenericRuntime();
  const { cfg, agentId, chatId, chatType, replyToMessageId, sessionKey, inboundThreadId } = params;

  // Resolve threadId from session bindings (for ACP thread-bound sessions).
  // Called lazily on each deliver so that bindings created mid-dispatch (e.g., ACP spawn)
  // are picked up immediately.
  function resolveThreadId(): string | undefined {
    try {
      const bindingService = getSessionBindingService();
      // Try by session key first
      if (sessionKey) {
        for (const binding of bindingService.listBySession(sessionKey)) {
          const convId = binding.conversation?.conversationId;
          if (convId?.startsWith("thread:")) {
            return convId.slice(7);
          }
        }
      }
      // Try by conversation ref (for ACP sessions bound to this chat)
      const binding = bindingService.resolveByConversation({
        channel: "clawline",
        accountId: "default",
        conversationId: chatId,
      });
      if (binding) {
        const convId = binding.conversation?.conversationId;
        if (convId?.startsWith("thread:")) {
          return convId.slice(7);
        }
      }
      // Try by parent conversation (ACP binding has parentConversationId = chatId)
      const found = findThreadIdByChatId(chatId);
      if (found) return found;
    } catch (err) {
      params.runtime.log?.(`generic: resolveThreadId binding lookup failed: ${err}`);
    }
    // TH-1 fallback: if no session binding resolves, use the inbound message's
    // threadId. This guarantees the reply goes to whichever thread the user
    // posted into, even on first message in a brand-new session.
    if (inboundThreadId) {
      params.runtime.log?.(`generic: resolveThreadId falling back to inbound threadId=${inboundThreadId}`);
      return inboundThreadId;
    }
    return undefined;
  }

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      params.runtime.log?.(`generic: thinking started`);
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.start",
        agentId,
        threadId: resolveThreadId(),
      });
    },
    stop: async () => {
      params.runtime.log?.(`generic: thinking stopped`);
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.end",
        agentId,
        threadId: resolveThreadId(),
      });
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "clawline",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "clawline",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = Math.max(
    1,
    genericCfg?.textChunkLimit ??
      core.channel.text.resolveTextChunkLimit(
        cfg,
        "clawline",
        undefined,
        { fallbackLimit: 4000 },
      ),
  );

  const streamingEnabled = (genericCfg as GenericChannelConfig & { streaming?: { enabled?: boolean } } | undefined)
    ?.streaming?.enabled !== false;

  // Only first chunk of a multi-chunk reply should quote the original message
  const replyPlanner = createReplyReferencePlanner({
    startId: replyToMessageId,
    replyToMode: "first",
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      typingCallbacks,
      deliver: async (payload: ReplyPayload) => {
        const resolvedThreadId = resolveThreadId();
        params.runtime.log?.(`generic deliver called: text=${payload.text?.slice(0, 100)}, resolvedThreadId=${resolvedThreadId ?? "none"}`);
        let text = payload.text ?? "";

        if (!text.trim()) {
          params.runtime.log?.(`generic: empty text, skipping delivery`);
          return;
        }

        // Cross-agent delegate: extract and dispatch <<DELEGATE:agentId>>message<</DELEGATE>> tags
        if (params.handleMessage) {
          const { directives, cleanedText } = extractDelegateDirectives(text);
          if (directives.length > 0) {
            text = cleanedText;
            try {
              await dispatchDelegates({
                cfg,
                directives,
                senderId: chatId,
                runtime: params.runtime,
                handleMessage: params.handleMessage,
              });
            } catch (err) {
              params.runtime.log?.(`generic: delegate dispatch error: ${err}`);
            }
          }
        }

        if (streamingEnabled) {
          await sendStreamDelta({
            cfg,
            to: `chat:${chatId}`,
            text: "",
            done: true,
            agentId,
            threadId: resolvedThreadId,
          });
        }

        const chunks = core.channel.text.chunkMarkdownText(text, textChunkLimit);

        for (const chunk of chunks) {
          const chunkReplyTo = replyPlanner.use();
          await sendMessageGeneric({
            cfg,
            to: `chat:${chatId}`,
            text: chunk,
            replyToMessageId: chunkReplyTo,
            contentType: "text",
            chatType,
            agentId,
            threadId: resolvedThreadId,
          });
        }

        params.runtime.log?.(`generic: sent ${chunks.length} message chunk(s)`);
      },
    });

  // Use onPartialReply for streaming deltas — official OpenClaw SDK mechanism
  // Source: pi-embedded-subscribe.handlers.messages.ts calls ctx.params.onPartialReply(data)
  if (streamingEnabled) {
    params.runtime.log?.(`generic: streaming enabled, injecting onPartialReply for chatId=${chatId}`);
    (replyOptions as any).onPartialReply = (payload: ReplyPayload) => {
      let delta = payload.text;
      if (!delta) return;
      // Strip DELEGATE tags from streaming preview to avoid raw tags flashing
      delta = stripDelegateTags(delta);
      if (!delta.trim()) return;
      sendStreamDelta({
        cfg,
        to: `chat:${chatId}`,
        text: delta,
        agentId,
        threadId: resolveThreadId(),
      }).catch((err) => {
        params.runtime.log?.(`generic: stream delta send error: ${err}`);
      });
    };
  }

  params.runtime.log?.(`generic: streaming=${streamingEnabled}, sessionKey=${sessionKey ?? "none"}`);

  return {
    dispatcher,
    replyOptions,
    markDispatchIdle,
    cleanup: () => {
      // onPartialReply is scoped to replyOptions — no global listener to clean up
    },
  };
}
