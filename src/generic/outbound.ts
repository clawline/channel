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
    const contentType = inferredType === "image" || inferredType === "audio" ? inferredType : undefined;

    if (contentType && mediaUrl) {
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

    // Fallback: send media URL as text
    let fullText = text ?? "";
    if (mediaUrl) {
      fullText = fullText ? `${fullText}\n\n📎 ${mediaUrl}` : `📎 ${mediaUrl}`;
    }

    const result = await sendMessageGeneric({ cfg, to, text: fullText });
    return { channel: "clawline", ...result };
  },
};
