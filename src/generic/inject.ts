/**
 * Cross-Agent Message Inject
 *
 * Allows Agent A to dispatch a message to Agent B on behalf of the current user.
 * The message is routed through the standard inbound pipeline so Agent B
 * processes it as if the user sent it directly.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { HistoryEntry } from "openclaw/plugin-sdk/reply-history";
import type { InboundMessage } from "./types.js";
import { handleGenericMessage } from "./bot.js";
import { getGenericWSManager } from "./client.js";
import { resolveGenericAgentId } from "./agents.js";

export interface MessageInjectData {
  targetAgentId: string;
  senderId: string;
  senderName?: string;
  text: string;
  chatId?: string;
  sourceAgentId?: string;
  messageId?: string;
}

/**
 * Handle a cross-agent message inject.
 *
 * 1. Validate the target agent exists
 * 2. Build an InboundMessage addressed to the target agent
 * 3. Route it through handleGenericMessage() (full pipeline)
 * 4. Send a confirmation event back to the user's frontend
 */
export async function handleMessageInject(params: {
  cfg: OpenClawConfig;
  data: MessageInjectData;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
}): Promise<{ ok: boolean; error?: string }> {
  const { cfg, data, runtime, chatHistories } = params;
  const log = runtime?.log ?? console.log;

  const { targetAgentId, senderId, senderName, text, chatId, sourceAgentId, messageId } = data;

  if (!targetAgentId || !senderId || !text) {
    return { ok: false, error: "missing required fields: targetAgentId, senderId, text" };
  }

  // Validate target agent exists in config
  const resolvedAgent = resolveGenericAgentId(cfg, targetAgentId);
  if (!resolvedAgent) {
    log(`inject: target agent "${targetAgentId}" not found`);
    return { ok: false, error: `agent "${targetAgentId}" not found` };
  }

  const msgId = messageId || `inject-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ts = Date.now();

  log(`inject: ${sourceAgentId || "unknown"} → ${targetAgentId} (sender: ${senderId}): ${text.slice(0, 80)}`);

  // Build an inbound message that looks like the user sent it to the target agent
  const inboundMessage: InboundMessage = {
    messageId: msgId,
    chatId: chatId || senderId,
    chatType: "direct",
    senderId,
    senderName,
    agentId: targetAgentId,
    messageType: "text",
    content: text,
    timestamp: ts,
  };

  // Route through the standard pipeline — this builds the correct session key
  // (agent:{targetAgentId}:clawline:dm:{senderId}) and dispatches to the agent
  await handleGenericMessage({
    cfg,
    message: inboundMessage,
    runtime,
    chatHistories,
  });

  // Send confirmation to user's frontend connections
  const wsManager = getGenericWSManager();
  if (wsManager) {
    const userChatId = chatId || senderId;
    wsManager.sendToClient(userChatId, {
      type: "message.inject.confirm",
      data: {
        messageId: msgId,
        targetAgentId,
        sourceAgentId,
        text,
        senderId,
        timestamp: ts,
      },
    });
  }

  return { ok: true };
}
