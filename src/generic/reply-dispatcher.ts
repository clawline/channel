import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type OpenClawConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericRuntime } from "./runtime.js";
import { sendMessageGeneric, sendThinkingIndicator, sendStreamDelta } from "./send.js";

export type CreateGenericReplyDispatcherParams = {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  chatType: "direct" | "group";
  replyToMessageId?: string;
  sessionKey?: string;
};

export function createGenericReplyDispatcher(params: CreateGenericReplyDispatcherParams) {
  const core = getGenericRuntime();
  const { cfg, agentId, chatId, chatType, replyToMessageId, sessionKey } = params;

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
      });
    },
    stop: async () => {
      params.runtime.log?.(`generic: thinking stopped`);
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.end",
        agentId,
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
      core.channel.text.resolveTextChunkLimit({
        cfg,
        channel: "clawline",
        defaultLimit: 4000,
      }),
  );

  const streamingEnabled = (genericCfg as GenericChannelConfig & { streaming?: { enabled?: boolean } } | undefined)
    ?.streaming?.enabled !== false;

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        params.runtime.log?.(`generic deliver called: text=${payload.text?.slice(0, 100)}`);
        const text = payload.text ?? "";

        if (!text.trim()) {
          params.runtime.log?.(`generic: empty text, skipping delivery`);
          return;
        }

        if (streamingEnabled) {
          await sendStreamDelta({
            cfg,
            to: `chat:${chatId}`,
            text: "",
            done: true,
            agentId,
          });
        }

        const chunks = core.channel.text.chunkMarkdownText(text, textChunkLimit);

        for (const chunk of chunks) {
          await sendMessageGeneric({
            cfg,
            to: `chat:${chatId}`,
            text: chunk,
            replyToMessageId,
            contentType: "text",
            chatType,
            agentId,
          });
        }

        params.runtime.log?.(`generic: sent ${chunks.length} message chunk(s)`);
      },
      onReplyEnd: typingCallbacks.onReplyEnd,
      onIdle: typingCallbacks.onIdle,
    });

  // Use onPartialReply for streaming deltas — official OpenClaw SDK mechanism
  // Source: pi-embedded-subscribe.handlers.messages.ts calls ctx.params.onPartialReply(data)
  if (streamingEnabled) {
    params.runtime.log?.(`generic: streaming enabled, injecting onPartialReply for chatId=${chatId}`);
    (replyOptions as any).onPartialReply = (payload: ReplyPayload) => {
      const delta = payload.text;
      if (!delta) return;
      sendStreamDelta({
        cfg,
        to: `chat:${chatId}`,
        text: delta,
        agentId,
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
