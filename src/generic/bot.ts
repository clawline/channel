import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  type HistoryEntry,
} from "openclaw/plugin-sdk/reply-history";
import type { GenericChannelConfig, GenericMessageContext, InboundMessage } from "./types.js";
import { appendInboundHistoryMessage } from "./history.js";
import { getGenericRuntime } from "./runtime.js";
import { createGenericReplyDispatcher } from "./reply-dispatcher.js";
import { resolveGenericMediaList, buildMediaPayload } from "./media.js";
import { sendMessageGeneric } from "./send.js";
import {
  formatGenericTranscriptionBlock,
  maybeTranscribeGenericAudio,
} from "./transcription.js";
import { resolveExplicitGenericAgentRoute } from "./agents.js";

const GENERIC_CHANNEL_ID = "clawline";

// Dedup: track recently processed messageIds to prevent duplicate dispatch
// (e.g. client outbox re-flush on reconnect sending same messageId)
const RECENT_MESSAGE_IDS_MAX = 200;
const recentMessageIds = new Set<string>();
const recentMessageIdOrder: string[] = [];

function trackMessageId(messageId: string): boolean {
  if (!messageId) return false; // no id = can't dedup, allow through
  if (recentMessageIds.has(messageId)) return true; // duplicate
  recentMessageIds.add(messageId);
  recentMessageIdOrder.push(messageId);
  while (recentMessageIdOrder.length > RECENT_MESSAGE_IDS_MAX) {
    const oldest = recentMessageIdOrder.shift()!;
    recentMessageIds.delete(oldest);
  }
  return false; // first time
}

function normalizeAllowEntry(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^(generic|user):/i, "");
}

function isSenderAllowed(params: {
  allowFrom: string[];
  senderId: string;
  senderName?: string;
}): boolean {
  const normalizedAllowFrom = params.allowFrom.map(normalizeAllowEntry).filter(Boolean);
  if (normalizedAllowFrom.includes("*")) {
    return true;
  }

  const candidates = [params.senderId, params.senderName]
    .filter((value): value is string => Boolean(value))
    .map(normalizeAllowEntry);

  return normalizedAllowFrom.some((entry) => candidates.includes(entry));
}

async function readPairingAllowFromStore(params: {
  runtimeCore: ReturnType<typeof getGenericRuntime>;
  log: (message: string) => void;
}): Promise<string[]> {
  const storeAllowFrom = await params.runtimeCore.channel.pairing
    .readAllowFromStore({ channel: GENERIC_CHANNEL_ID, accountId: "default" })
    .catch(() => []);

  if (storeAllowFrom.length > 0) {
    return storeAllowFrom.map(String);
  }

  const homeDir = process.env.HOME;
  if (!homeDir) {
    return [];
  }

  const fallbackPath = join(
    homeDir,
    ".openclaw",
    "credentials",
    `${GENERIC_CHANNEL_ID}-default-allowFrom.json`,
  );

  try {
    const raw = JSON.parse(await readFile(fallbackPath, "utf8")) as { allowFrom?: unknown };
    if (Array.isArray(raw.allowFrom)) {
      return raw.allowFrom.map(String);
    }
  } catch {
    params.log(`generic: pairing allowFrom fallback unavailable at ${fallbackPath}`);
  }

  return [];
}

export function parseGenericMessage(message: InboundMessage): GenericMessageContext {
  return {
    chatId: message.chatId ?? "",
    messageId: message.messageId ?? "",
    senderId: message.senderId ?? "",
    senderName: message.senderName,
    chatType: message.chatType ?? "direct",
    content: message.content ?? "",
    contentType: message.messageType ?? "text",
    mediaUrl: message.mediaUrl,
    mimeType: message.mimeType,
    parentId: message.parentId,
    threadId: message.threadId,
  };
}

function buildGenericMediaPlaceholder(messageType: InboundMessage["messageType"]): string {
  switch (messageType) {
    case "image":
      return "<media:image>";
    case "voice":
      return "<media:voice>";
    case "audio":
      return "<media:audio>";
    case "file":
      return "<media:document>";
    default:
      return "";
  }
}

export async function handleGenericMessage(params: {
  cfg: OpenClawConfig;
  message: InboundMessage;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
}): Promise<void> {
  const { cfg, message, runtime, chatHistories } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const ctx = parseGenericMessage(message);
  const isGroup = ctx.chatType === "group";

  // Dedup: skip if we've already processed this messageId
  if (ctx.messageId && trackMessageId(ctx.messageId)) {
    log(`generic: skipping duplicate messageId ${ctx.messageId} from ${ctx.senderId}`);
    return;
  }

  log(`generic: received message from ${ctx.senderId} in ${ctx.chatId} (${ctx.chatType})`);

  const historyLimit = Math.max(
    0,
    genericCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  const core = getGenericRuntime();

  // Check DM policy
  if (!isGroup) {
    const dmPolicy = genericCfg?.dmPolicy ?? "open";
    const configAllowFrom = (genericCfg?.allowFrom ?? []).map(String);
    const storeAllowFrom =
      dmPolicy !== "open"
        ? await readPairingAllowFromStore({
            runtimeCore: core,
            log,
          })
        : [];
    const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];

    if (dmPolicy !== "open") {
      const allowed = isSenderAllowed({
        allowFrom: effectiveAllowFrom,
        senderId: ctx.senderId,
        senderName: ctx.senderName,
      });

      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: GENERIC_CHANNEL_ID,
            accountId: "default",
            id: ctx.senderId,
            meta: { name: ctx.senderName || undefined },
          });

          if (created) {
            await sendMessageGeneric({
              cfg,
              to: `chat:${ctx.chatId}`,
              text: core.channel.pairing.buildPairingReply({
                channel: GENERIC_CHANNEL_ID,
                idLine: `Your Generic user id: ${ctx.senderId}`,
                code,
              }),
            });
          }
        } else {
          log(`generic: sender ${ctx.senderId} not in DM allowlist`);
        }
        return;
      }
    }
  }

  appendInboundHistoryMessage(message);

  try {
    // Build target identifiers
    const genericFrom = `generic:${ctx.senderId}`;
    const genericTo = isGroup ? `chat:${ctx.chatId}` : `user:${ctx.senderId}`;

    // Detect slash commands - check if message starts with /
    const isSlashCommand = ctx.content.trim().startsWith("/");
    const commandBody = isSlashCommand ? ctx.content.trim() : ctx.content;

    const explicitRoute = resolveExplicitGenericAgentRoute({
      cfg,
      requestedAgentId: message.agentId,
      chatType: ctx.chatType,
      chatId: ctx.chatId,
      senderId: ctx.senderId,
    });
    const route =
      explicitRoute ??
      core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "clawline",
        peer: {
          kind: isGroup ? "group" : "direct",
          id: ctx.chatId,
        },
      });

    const preview = ctx.content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `Generic message in group ${ctx.chatId}`
      : `Generic DM from ${ctx.senderId}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `generic:message:${ctx.chatId}:${ctx.messageId}`,
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    // Download and resolve media from message
    const mediaMaxBytes = (genericCfg?.mediaMaxMb ?? 30) * 1024 * 1024;
    const mediaList = await resolveGenericMediaList({
      message,
      maxBytes: mediaMaxBytes,
      log: (msg: string) => log(msg),
    });
    const transcriptionBlock = formatGenericTranscriptionBlock(
      await maybeTranscribeGenericAudio({
        cfg: genericCfg,
        messageType: ctx.contentType,
        mediaList,
        log: (msg: string) => log(msg),
      }),
    );
    const mediaPayload = buildMediaPayload(mediaList);

    const hasMediaAttachment =
      Boolean(ctx.mediaUrl) &&
      (ctx.contentType === "image" ||
        ctx.contentType === "voice" ||
        ctx.contentType === "audio" ||
        ctx.contentType === "file");
    const mediaPlaceholder = hasMediaAttachment
      ? mediaList.map((media) => media.placeholder).filter(Boolean).join("\n") ||
        buildGenericMediaPlaceholder(ctx.contentType)
      : "";
    const normalizedRawBody = [ctx.content.trim(), transcriptionBlock, mediaPlaceholder]
      .filter(Boolean)
      .join("\n")
      .trim();

    // Build message body with sender name
    const speaker = ctx.senderName ?? ctx.senderId;
    let messageBody = `${speaker}: ${normalizedRawBody || ctx.content}`;

    if (hasMediaAttachment && mediaList.length === 0 && ctx.mediaUrl) {
      messageBody += `\nMedia URL: ${ctx.mediaUrl}`;
    }

    // Handle quoted/reply messages
    if (ctx.parentId) {
      messageBody = `[Replying to message ${ctx.parentId}]\n\n${messageBody}`;
    }

    const envelopeFrom = isGroup ? `${ctx.chatId}:${ctx.senderId}` : ctx.senderId;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Generic",
      from: envelopeFrom,
      timestamp: new Date(message.timestamp),
      envelope: envelopeOptions,
      body: messageBody,
    });

    let combinedBody = body;
    const historyKey = isGroup ? ctx.chatId : undefined;

    // Add history for group messages
    if (isGroup && historyKey && chatHistories) {
      combinedBody = buildPendingHistoryContextFromMap({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
        currentMessage: combinedBody,
        formatEntry: (entry) =>
          core.channel.reply.formatAgentEnvelope({
            channel: "Generic",
            from: `${ctx.chatId}:${entry.sender}`,
            timestamp: entry.timestamp,
            body: entry.body,
            envelope: envelopeOptions,
          }),
      });
    }

    // Generate a virtual threadId for thread binding support (similar to Discord autoThread).
    // This allows ACP spawn --thread auto to read MessageThreadId from the session entry.
    // Reuse existing threadId from ACP binding if one exists for this chat, to keep
    // threadId consistent across the ACP session's lifetime.
    const { findThreadIdByChatId } = await import("./session-bindings.js");
    const existingThreadId = findThreadIdByChatId(ctx.chatId);
    const virtualThreadId = ctx.threadId ?? existingThreadId ?? `clawline-thread-${randomUUID()}`;

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: normalizedRawBody || ctx.content,
      CommandBody: normalizedRawBody || commandBody,
      From: genericFrom,
      To: genericTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.chatId : undefined,
      SenderName: ctx.senderName ?? ctx.senderId,
      SenderId: ctx.senderId,
      Provider: "clawline" as const,
      Surface: "clawline" as const,
      MessageSid: ctx.messageId,
      Timestamp: message.timestamp,
      CommandAuthorized: isSlashCommand,
      OriginatingChannel: "clawline" as const,
      OriginatingTo: genericTo,
      NativeChannelId: ctx.chatId,
      MessageThreadId: virtualThreadId,
      ReplyToId: ctx.parentId ?? undefined,
      ThreadParentId: ctx.chatId,
      ...mediaPayload, // Add MediaPath, MediaType, MediaUrl, MediaPaths, etc.
    });

    const { dispatcher, replyOptions, markDispatchIdle } = createGenericReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: ctx.chatId,
      chatType: ctx.chatType,
      replyToMessageId: ctx.messageId,
      sessionKey: route.sessionKey,
      // TH-1: pass the user-supplied threadId (if any) so the dispatcher's
      // resolveThreadId() can use it as fallback when session bindings haven't
      // resolved yet. Skip the synthetic random fallback — only pass real ones.
      inboundThreadId: ctx.threadId ?? existingThreadId,
      handleMessage: handleGenericMessage,
    });

    log(`generic: dispatching to agent (session=${route.sessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    // Clear history after successful dispatch
    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(`generic: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`generic: failed to dispatch message: ${String(err)}`);
  }
}
