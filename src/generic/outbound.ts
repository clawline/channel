import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-send-result";
import { getGenericRuntime } from "./runtime.js";
import { inferMediaTypeFromMime, inferMimeTypeFromSource } from "./media.js";
import { sendMessageGeneric, sendMediaGeneric } from "./send.js";

export const genericOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getGenericRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text }) => {
    const result = await sendMessageGeneric({ cfg, to, text });
    return { channel: "clawline", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl }) => {
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
      });
      return { channel: "clawline", ...result };
    }

    // No media URL — send as plain text
    const result = await sendMessageGeneric({ cfg, to, text: text ?? "" });
    return { channel: "clawline", ...result };
  },
};
