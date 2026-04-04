/**
 * Tool Call Event Broadcasting
 *
 * Converts OpenClaw plugin hook events (before_tool_call / after_tool_call)
 * into Clawline WS events (tool.start / tool.end) and broadcasts to clients.
 */

import type { WSEventType } from "./types.js";
import { getGenericWSManager } from "./monitor.js";

// ---------------------------------------------------------------------------
// Types (B6: explicit typing instead of `any`)
// ---------------------------------------------------------------------------

/** Shape of OpenClaw SDK tool call hook events */
export interface ToolCallHookEvent {
  toolName?: string;
  name?: string;
  params?: Record<string, unknown>;
  args?: Record<string, unknown>;
  toolCallId?: string;
  result?: unknown;
  agentId?: string;
  chatId?: string;
}

// ---------------------------------------------------------------------------
// Redaction (B7: pattern-based + recursive)
// ---------------------------------------------------------------------------

/** Pattern matching sensitive keys (case-insensitive) */
const SENSITIVE_KEY_PATTERN = /key|token|secret|password|auth|credential|cookie|session|bearer|passphrase|dsn|connection.?string|private/i;

/** Max recursion depth for nested object redaction */
const MAX_REDACT_DEPTH = 3;

/** Recursively redact sensitive values from an object */
function redactSensitive(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth >= MAX_REDACT_DEPTH) return { _truncated: true };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[redacted]";
    } else if (typeof value === "string" && value.length > 200) {
      result[key] = value.slice(0, 200) + "…";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactSensitive(value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Throttling (S13: prevent WS flood from high-frequency tool calls)
// ---------------------------------------------------------------------------

const THROTTLE_WINDOW_MS = 200;
const MAX_EVENTS_PER_WINDOW = 10;

let eventWindow: { start: number; count: number } = { start: 0, count: 0 };

function shouldThrottle(): boolean {
  const now = Date.now();
  if (now - eventWindow.start > THROTTLE_WINDOW_MS) {
    eventWindow = { start: now, count: 1 };
    return false;
  }
  eventWindow.count++;
  return eventWindow.count > MAX_EVENTS_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// Unique ID fallback (nit: Date.now() not unique)
// ---------------------------------------------------------------------------

let tcCounter = 0;
function uniqueFallbackId(): string {
  return `tc-${Date.now()}-${++tcCounter}`;
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/**
 * Broadcast a tool call event to connected Clawline clients.
 *
 * @param eventType - "tool.start" or "tool.end"
 * @param hookEvent - The OpenClaw hook event payload
 */
export function broadcastToolCallEvent(
  eventType: "tool.start" | "tool.end",
  hookEvent: ToolCallHookEvent,
): void {
  const wsManager = getGenericWSManager();
  if (!wsManager) {
    // S15: log when events are silently dropped
    console.debug?.(`[clawline] tool event dropped (no wsManager): ${eventType}`);
    return;
  }

  // S13: throttle high-frequency tool calls
  if (shouldThrottle()) return;

  const toolName = hookEvent.toolName || hookEvent.name || "unknown";
  const args = hookEvent.params || hookEvent.args;
  const toolCallId = hookEvent.toolCallId || uniqueFallbackId();

  const payload: Record<string, unknown> = {
    toolName,
    toolCallId,
    agentId: hookEvent.agentId,
    timestamp: Date.now(),
  };

  if (eventType === "tool.start" && args) {
    payload.args = redactSensitive(args as Record<string, unknown>);
  }

  if (eventType === "tool.end") {
    payload.completed = true;
    // Include a truncated result summary for client-side detail view
    const result = hookEvent.result;
    if (result != null) {
      const raw = typeof result === "string" ? result : JSON.stringify(result);
      payload.resultSummary = raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
    }
  }

  const event = {
    type: eventType as WSEventType,
    data: payload,
  };

  // S14: agent-isolated delivery — never broadcast without agentId
  const agentId = hookEvent.agentId;
  if (!agentId) {
    // No agentId means we can't isolate; drop to avoid cross-agent leakage
    console.debug?.(`[clawline] tool event dropped (no agentId): ${eventType}`);
    return;
  }

  const chatId = hookEvent.chatId;
  if (chatId) {
    wsManager.sendToClient(chatId, event);
  } else {
    // Deliver to all connected clients, relying on sendToClient's agent isolation
    for (const clientId of wsManager.getConnectedClients()) {
      wsManager.sendToClient(clientId, event);
    }
  }
}
