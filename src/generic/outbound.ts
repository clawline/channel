import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-send-result";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getGenericRuntime } from "./runtime.js";
import { inferMediaTypeFromMime, inferMimeTypeFromSource } from "./media.js";
import { sendMessageGeneric, sendMediaGeneric } from "./send.js";

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

export const genericOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getGenericRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async (ctx) => {
    const { cfg, to, text } = ctx;
    const agentId = extractAgentIdFromOutboundContext(ctx);
    const result = await sendMessageGeneric({ cfg, to, text, agentId });
    return { channel: "clawline", ...result };
  },
  sendMedia: async (ctx) => {
    const { cfg, to, text, mediaUrl } = ctx;
    const agentId = extractAgentIdFromOutboundContext(ctx);
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
