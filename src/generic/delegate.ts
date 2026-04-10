import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { InboundMessage } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type DelegateDirective = {
  targetAgentId: string;
  message: string;
};

const DELEGATE_PATTERN = /<<DELEGATE:([a-zA-Z0-9_-]+)>>([\s\S]*?)<<\/DELEGATE>>/;

/** Returns a fresh global regex to avoid shared lastIndex state. */
function delegateRegex(): RegExp {
  return new RegExp(DELEGATE_PATTERN.source, "g");
}

/**
 * Parse <<DELEGATE:agentId>>message<</DELEGATE>> tags from text.
 * Returns extracted directives and cleaned text with notification placeholders.
 */
export function extractDelegateDirectives(text: string): {
  directives: DelegateDirective[];
  cleanedText: string;
} {
  const directives: DelegateDirective[] = [];
  const cleanedText = text.replace(delegateRegex(), (_match, agentId: string, msg: string) => {
    const trimmed = msg.trim();
    if (agentId && trimmed) {
      directives.push({ targetAgentId: agentId, message: trimmed });
    }
    return agentId ? `\n[Delegated task to **${agentId}**]\n` : "";
  }).trim();

  return { directives, cleanedText };
}

/**
 * Strip DELEGATE tags from streaming deltas to prevent raw tags flashing in UI.
 * Removes both complete tags and incomplete opening tags (mid-stream).
 */
export function stripDelegateTags(text: string): string {
  // Remove complete tags
  let result = text.replace(delegateRegex(), "");
  // Remove incomplete opening tag at the end (mid-stream): <<DELEGATE:xxx>> without closing
  result = result.replace(/<<DELEGATE:[a-zA-Z0-9_-]+>>[\s\S]*$/, "");
  // Remove partial opening tag at the very end: <<DELEGATE: or <<DELE...
  result = result.replace(/<<DELEGATE:?[a-zA-Z0-9_-]*$/, "");
  return result;
}

export type HandleMessageFn = (params: {
  cfg: OpenClawConfig;
  message: InboundMessage;
  runtime?: RuntimeEnv;
}) => Promise<void>;

const MAX_DELEGATE_DEPTH = 3;

/**
 * Dispatch delegate directives to target agents via handleGenericMessage.
 * Each directive is dispatched independently; failures are logged but don't block others.
 * @param depth Current recursion depth (0 = first delegation). Prevents infinite loops.
 */
export async function dispatchDelegates(params: {
  cfg: OpenClawConfig;
  directives: DelegateDirective[];
  senderId: string;
  runtime?: RuntimeEnv;
  handleMessage: HandleMessageFn;
  depth?: number;
}): Promise<void> {
  const { cfg, directives, senderId, runtime, handleMessage, depth = 0 } = params;
  const log = runtime?.log ?? console.log;

  if (depth >= MAX_DELEGATE_DEPTH) {
    log(`delegate: max depth ${MAX_DELEGATE_DEPTH} reached, dropping ${directives.length} directive(s)`);
    return;
  }

  for (const directive of directives) {
    try {
      const message: InboundMessage = {
        messageId: `delegate-${randomUUID()}`,
        chatId: senderId,
        chatType: "direct",
        senderId,
        agentId: directive.targetAgentId,
        messageType: "text",
        content: directive.message,
        timestamp: Date.now(),
      };

      log(`delegate: dispatching to agent=${directive.targetAgentId} from sender=${senderId} (${directive.message.length} chars)`);
      await handleMessage({ cfg, message, runtime });

      // Send the delegate message to the client so it appears in target agent's chat as a "user" message.
      // The gateway relay will also persist this to Supabase via persistMessage().
      const wsManager = getGenericWSManager();
      if (wsManager) {
        wsManager.sendToClient(senderId, {
          type: "message.send" as import("./types.js").WSEventType,
          data: {
            messageId: message.messageId,
            chatId: senderId,
            content: directive.message,
            contentType: "text",
            agentId: directive.targetAgentId,
            senderId,
            echo: true,
            timestamp: message.timestamp,
          },
        });
      }

      log(`delegate: dispatched to agent=${directive.targetAgentId} successfully`);
    } catch (err) {
      log(`delegate: failed to dispatch to agent=${directive.targetAgentId}: ${err}`);
    }
  }
}
