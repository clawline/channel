/**
 * Tool Call Event Broadcasting
 *
 * Converts OpenClaw plugin hook events (before_tool_call / after_tool_call)
 * into Clawline WS events (tool.start / tool.end) and broadcasts to clients.
 */

import type { GenericChannelConfig, WSEventType } from "./types.js";
import { getGenericWSManager } from "./monitor.js";
import { getGenericRuntime } from "./runtime.js";

/** Sensitive parameter keys that should not be sent to clients */
const REDACTED_KEYS = new Set([
  "api_key", "apiKey", "token", "secret", "password", "authorization",
  "cookie", "session", "credential", "private_key", "privateKey",
]);

/** Extract a human-readable summary from tool args */
function summarizeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args) return undefined;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      summary[key] = "[redacted]";
    } else if (typeof value === "string" && value.length > 200) {
      summary[key] = value.slice(0, 200) + "…";
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Broadcast a tool call event to all connected Clawline clients.
 *
 * @param eventType - "tool.start" or "tool.end"
 * @param hookEvent - The OpenClaw hook event payload (before_tool_call or after_tool_call)
 */
export function broadcastToolCallEvent(
  eventType: "tool.start" | "tool.end",
  hookEvent: {
    toolName?: string;
    name?: string;
    params?: Record<string, unknown>;
    args?: Record<string, unknown>;
    toolCallId?: string;
    result?: unknown;
    agentId?: string;
    chatId?: string;
    sessionKey?: string;
  },
): void {
  const wsManager = getGenericWSManager();
  if (!wsManager) return;

  const toolName = hookEvent.toolName || hookEvent.name || "unknown";
  const args = hookEvent.params || hookEvent.args;
  const toolCallId = hookEvent.toolCallId || `tc-${Date.now()}`;

  const payload: Record<string, unknown> = {
    toolName,
    toolCallId,
    agentId: hookEvent.agentId,
    timestamp: Date.now(),
  };

  if (eventType === "tool.start" && args) {
    payload.args = summarizeArgs(args as Record<string, unknown>);
  }

  if (eventType === "tool.end" && hookEvent.result) {
    // Only send a brief summary of the result, not the full content
    const resultStr = typeof hookEvent.result === "string"
      ? hookEvent.result
      : JSON.stringify(hookEvent.result);
    payload.resultPreview = resultStr.length > 100
      ? resultStr.slice(0, 100) + "…"
      : resultStr;
  }

  // Broadcast to all connected clients
  // If chatId is available, target that specific chat; otherwise broadcast to all
  const chatId = hookEvent.chatId;
  if (chatId) {
    wsManager.sendToClient(chatId, {
      type: eventType as WSEventType,
      data: payload,
    });
  } else {
    // Broadcast to all clients — they filter by agentId on the frontend
    wsManager.broadcast({
      type: eventType as WSEventType,
      data: payload,
    });
  }
}
