import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-send-result";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getGenericRuntime } from "./runtime.js";
import { inferMediaTypeFromMime, inferMimeTypeFromSource } from "./media.js";
import { sendMessageGeneric, sendMediaGeneric } from "./send.js";
import { getGenericWSManager } from "./client.js";

/**
 * Extract agentId from outbound context.
 * OpenClaw SDK doesn't pass agentId directly in ChannelOutboundContext,
 * but mediaAccess.workspaceDir contains it: ~/.openclaw/workspace-<agentId>
 * We also check identity as a secondary source via agents.list name matching.
 */
function extractAgentIdFromOutboundContext(ctx: {
  cfg: OpenClawConfig;
  mediaAccess?: { workspaceDir?: string };
  mediaLocalRoots?: readonly string[];
  identity?: { name?: string; emoji?: string };
}): string | undefined {
  // Strategy 1: Extract from mediaAccess.workspaceDir
  const workspaceDir = ctx.mediaAccess?.workspaceDir;
  if (workspaceDir) {
    const match = workspaceDir.match(/workspace-(.+?)\/?$/);
    if (match?.[1]) return match[1];
  }

  // Strategy 2: Extract from mediaLocalRoots (first entry with workspace- pattern)
  if (ctx.mediaLocalRoots) {
    for (const root of ctx.mediaLocalRoots) {
      const match = root.match(/workspace-(.+?)\/?(?:\/|$)/);
      if (match?.[1]) return match[1];
    }
  }

  // Strategy 3: Match identity.name against agents.list
  const agentsList = (ctx.cfg as Record<string, unknown>).agents as
    | { list?: Array<{ id: string; name?: string }> }
    | undefined;
  if (ctx.identity?.name && agentsList?.list) {
    const found = agentsList.list.find((a) => a.name === ctx.identity?.name);
    if (found) return found.id;
  }

  return undefined;
}

/**
 * Send an error event to the client via WebSocket.
 * Best-effort: if WS manager is unavailable or client is disconnected, the error is only logged server-side.
 */
function sendErrorToClient(to: string, code: string, message: string): void {
  try {
    const wsManager = getGenericWSManager();
    if (!wsManager) return;
    const chatId = to.startsWith('user:') ? to.substring(5) : to.startsWith('chat:') ? to.substring(5) : to;
    wsManager.sendToClient(chatId, {
      type: 'status.failed' as import('./types.js').WSEventType,
      data: {
        chatId,
        code,
        message,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.warn('[clawline outbound] failed to send error event to client:', err);
  }
}

export const genericOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getGenericRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async (ctx) => {
    const { cfg, to, text } = ctx;

    // Cross-agent inject: target format "agent:{targetAgentId}:{senderId}"
    // e.g. message(target="agent:nexora-docs:cobra", text="update the docs")
    if (to.startsWith("agent:")) {
      const parts = to.substring(6).split(":");
      const targetAgentId = parts[0];
      const senderId = parts[1] || "unknown";
      const sourceAgentId = extractAgentIdFromOutboundContext(ctx);
      const { handleMessageInject } = await import("./inject.js");
      const injectResult = await handleMessageInject({
        cfg,
        data: {
          targetAgentId,
          senderId,
          text: text ?? "",
          sourceAgentId,
        },
      });
      if (!injectResult.ok) {
        throw new Error(`[clawline outbound] inject failed: ${injectResult.error}`);
      }
      return { channel: "clawline", messageId: `inject-${Date.now()}`, chatId: senderId };
    }

    const agentId = extractAgentIdFromOutboundContext(ctx);
    if (!agentId) {
      const errorMsg = `Agent ID could not be resolved for this message. This is a server-side configuration issue.`;
      console.error(`[clawline outbound] ERROR: could not extract agentId from context for sendText to=${to}`);
      sendErrorToClient(to, 'AGENT_ID_MISSING', errorMsg);
      throw new Error(`[clawline outbound] agentId required but could not be extracted for sendText to=${to}`);
    }
    const result = await sendMessageGeneric({ cfg, to, text, agentId });
    return { channel: "clawline", ...result };
  },
  sendMedia: async (ctx) => {
    const { cfg, to, text, mediaUrl } = ctx;
    const agentId = extractAgentIdFromOutboundContext(ctx);
    if (!agentId) {
      const errorMsg = `Agent ID could not be resolved for this media message. This is a server-side configuration issue.`;
      console.error(`[clawline outbound] ERROR: could not extract agentId from context for sendMedia to=${to}`);
      sendErrorToClient(to, 'AGENT_ID_MISSING', errorMsg);
      throw new Error(`[clawline outbound] agentId required but could not be extracted for sendMedia to=${to}`);
    }
    const mimeType = mediaUrl ? inferMimeTypeFromSource(mediaUrl) : undefined;
    const inferredType = mimeType ? inferMediaTypeFromMime(mimeType) : undefined;

    // Map inferred type to a contentType: image/audio stay as-is, everything else → "file"
    let contentType: "image" | "audio" | "file";
    if (inferredType === "image") {
      contentType = "image";
    } else if (inferredType === "audio") {
      contentType = "audio";
    } else {
      contentType = "file";
    }

    if (mediaUrl) {
      const result = await sendMediaGeneric({
        cfg,
        to,
        mediaUrl,
        mediaType: contentType,
        mimeType,
        caption: text,
        agentId,
      });
      return { channel: "clawline", ...result };
    }

    // No media URL — send as plain text
    const result = await sendMessageGeneric({ cfg, to, text: text ?? "", agentId });
    return { channel: "clawline", ...result };
  },
};
