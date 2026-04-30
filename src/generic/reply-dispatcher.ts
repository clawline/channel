import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { createReplyReferencePlanner } from "openclaw/plugin-sdk/reply-runtime";
import { createReplyPrefixContext, createTypingCallbacks } from "openclaw/plugin-sdk/channel-runtime";
import { logTypingFailure } from "openclaw/plugin-sdk/channel-feedback";
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
   * D4: this is now the SOLE source of threadId. Channel plugin does not look up
   * session bindings or guess from chatId — the protocol contract is "inbound
   * decides". ACP threads still flow through here because bot.ts injects the
   * ACP virtualThreadId into ctx.threadId before constructing the dispatcher.
   */
  inboundThreadId?: string;
  handleMessage?: HandleMessageFn;
};

export function createGenericReplyDispatcher(params: CreateGenericReplyDispatcherParams) {
  const core = getGenericRuntime();
  const { cfg, agentId, chatId, chatType, replyToMessageId, sessionKey, inboundThreadId } = params;

  // D4: protocol contract — inbound decides. No session-binding lookup,
  // no findThreadIdByChatId fallback, no silent fallback to undefined.
  // If the dispatcher's caller wants the reply to land in a thread, it
  // must pass `inboundThreadId`.
  function resolveThreadId(): string | undefined {
    return inboundThreadId;
  }

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  // Phase tracking for thinking/answer split. SDK ReplyPayload only carries one
  // accumulating `text` — we slice it by phase windows so the client can route
  // thinking chunks to the orange box and answer chunks to the bubble cleanly.
  let isThinking = false;
  let thinkingEndAt: number | null = null;
  let lastSeenCumulativeLen = 0;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      params.runtime.log?.(`generic: thinking started`);
      isThinking = true;
      thinkingEndAt = null;
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.start",
        agentId,
        threadId: resolveThreadId(),
        replyToMessageId,
      });
    },
    stop: async () => {
      params.runtime.log?.(`generic: thinking stopped`);
      thinkingEndAt = lastSeenCumulativeLen;
      isThinking = false;
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.end",
        agentId,
        threadId: resolveThreadId(),
        replyToMessageId,
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
            replyToMessageId,
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
      let cumulative = payload.text;
      if (!cumulative) return;
      // Strip DELEGATE tags from streaming preview to avoid raw tags flashing
      cumulative = stripDelegateTags(cumulative);
      if (!cumulative) return;

      lastSeenCumulativeLen = cumulative.length;

      let phase: "thinking" | "answer";
      let textToSend: string;
      if (isThinking) {
        phase = "thinking";
        textToSend = cumulative;
      } else if (thinkingEndAt !== null) {
        phase = "answer";
        textToSend = cumulative.slice(thinkingEndAt).replace(/^\n+/, "");
        if (!textToSend.trim()) return;
      } else {
        phase = "answer";
        textToSend = cumulative;
        if (!textToSend.trim()) return;
      }

      sendStreamDelta({
        cfg,
        to: `chat:${chatId}`,
        text: textToSend,
        phase,
        agentId,
        threadId: resolveThreadId(),
        replyToMessageId,
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
