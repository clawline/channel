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
import { sendMessageGeneric, sendThinkingIndicator } from "./send.js";

export type CreateGenericReplyDispatcherParams = {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  chatType: "direct" | "group";
  replyToMessageId?: string;
};

export function createGenericReplyDispatcher(params: CreateGenericReplyDispatcherParams) {
  const core = getGenericRuntime();
  const { cfg, agentId, chatId, chatType, replyToMessageId } = params;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  // Generic channel typing/thinking indicator
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      params.runtime.log?.(`generic: thinking started`);
      // Send thinking indicator to the client
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.start",
      });
    },
    stop: async () => {
      params.runtime.log?.(`generic: thinking stopped`);
      // Send thinking end indicator to the client
      await sendThinkingIndicator({
        cfg,
        to: `chat:${chatId}`,
        eventType: "thinking.end",
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

        // Chunk text if needed
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

  return {
    dispatcher,
    replyOptions,
    markDispatchIdle,
  };
}
