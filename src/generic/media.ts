import type { InboundMessage } from "./types.js";
import { getGenericRuntime } from "./runtime.js";

export type MediaInfo = {
  path: string;
  contentType?: string;
  placeholder: string;
};

/**
 * Download media from a URL with size limits
 */
export async function downloadMediaFromUrl(params: {
  url: string;
  maxBytes: number;
}): Promise<{ buffer: Buffer; contentType?: string }> {
  const { url, maxBytes } = params;

  // Fetch from URL
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  // Check content length header
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > maxBytes) {
      throw new Error(`Media too large: ${size} bytes exceeds limit of ${maxBytes} bytes`);
    }
  }

  // Download content
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Check actual size
  if (buffer.length > maxBytes) {
    throw new Error(`Media too large: ${buffer.length} bytes exceeds limit of ${maxBytes} bytes`);
  }

  const contentType = response.headers.get("content-type") || undefined;

  return { buffer, contentType };
}

/**
 * Resolve and download media from an InboundMessage
 */
export async function resolveGenericMediaList(params: {
  message: InboundMessage;
  maxBytes: number;
  log?: (msg: string) => void;
}): Promise<MediaInfo[]> {
  const { message, maxBytes, log } = params;

  // Only process media messages with mediaUrl
  if (!message.mediaUrl) {
    return [];
  }

  const mediaTypes = ["image", "voice", "audio", "file"];
  if (!mediaTypes.includes(message.messageType)) {
    return [];
  }

  try {
    log?.(`generic: downloading media from ${message.mediaUrl}`);

    const { buffer, contentType } = await downloadMediaFromUrl({
      url: message.mediaUrl,
      maxBytes,
    });

    const core = getGenericRuntime();

    // Preserve the declared audio/image intent when container sniffing is ambiguous.
    let finalContentType = normalizeInboundMimeType({
      messageType: message.messageType,
      detectedContentType: contentType,
      declaredContentType: message.mimeType,
    });
    if (!finalContentType) {
      finalContentType = await core.media.detectMime({ buffer });
      finalContentType = normalizeInboundMimeType({
        messageType: message.messageType,
        detectedContentType: finalContentType,
        declaredContentType: message.mimeType,
      });
    }

    log?.(`generic: detected content type: ${finalContentType}, size: ${buffer.length} bytes`);

    // Save to disk using OpenClaw's media buffer handler
    const saved = await core.channel.media.saveMediaBuffer(buffer, finalContentType, "inbound", maxBytes);

    log?.(`generic: saved media to ${saved.path}`);

    return [
      {
        path: saved.path,
        contentType: saved.contentType,
        placeholder: inferPlaceholder(message.messageType),
      },
    ];
  } catch (err) {
    log?.(`generic: failed to download media: ${String(err)}`);
    return [];
  }
}

function normalizeInboundMimeType(params: {
  messageType: InboundMessage["messageType"];
  detectedContentType?: string;
  declaredContentType?: string;
}): string | undefined {
  const { messageType, detectedContentType, declaredContentType } = params;
  const detected = detectedContentType?.toLowerCase();
  const declared = declaredContentType?.toLowerCase();

  if (messageType === "voice" || messageType === "audio") {
    if (declared?.startsWith("audio/")) {
      return declared;
    }
    if (detected?.startsWith("audio/")) {
      return detected;
    }
    if (declared === "video/webm" || detected === "video/webm") {
      return "audio/webm";
    }
    return detectedContentType ?? declaredContentType ?? "audio/webm";
  }

  if (messageType === "image") {
    if (declared?.startsWith("image/")) {
      return declared;
    }
    if (detected?.startsWith("image/")) {
      return detected;
    }
  }

  return detectedContentType ?? declaredContentType;
}

/**
 * Infer placeholder text based on message type
 */
function inferPlaceholder(messageType: string): string {
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
      return "<media:file>";
  }
}

/**
 * Build media payload for inbound context
 */
export function buildMediaPayload(mediaList: MediaInfo[]): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
} {
  if (mediaList.length === 0) {
    return {};
  }

  const first = mediaList[0];
  const mediaPaths = mediaList.map((m) => m.path);
  const mediaTypes = mediaList.map((m) => m.contentType).filter(Boolean) as string[];

  return {
    MediaPath: first.path,
    MediaType: first.contentType,
    MediaUrl: first.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}

/**
 * Infer media type category from MIME type
 */
export function inferMediaTypeFromMime(mimeType: string): "image" | "voice" | "audio" | "file" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("audio/")) {
    // Distinguish voice (short recordings) from audio (music/long files)
    // For now, default to audio - clients can specify via messageType
    return "audio";
  }
  return "file";
}

export function inferMimeTypeFromSource(source: string): string | undefined {
  if (!source) {
    return undefined;
  }

  const dataUrlMatch = source.match(/^data:([^;,]+)[;,]/i);
  if (dataUrlMatch) {
    return dataUrlMatch[1]?.toLowerCase();
  }

  const normalized = source.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";

  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".bmp")) return "image/bmp";
  if (normalized.endsWith(".svg")) return "image/svg+xml";

  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".m4a")) return "audio/mp4";
  if (normalized.endsWith(".aac")) return "audio/aac";
  if (normalized.endsWith(".ogg") || normalized.endsWith(".oga")) return "audio/ogg";
  if (normalized.endsWith(".opus")) return "audio/opus";
  if (normalized.endsWith(".flac")) return "audio/flac";
  if (normalized.endsWith(".weba")) return "audio/webm";
  if (normalized.endsWith(".webm")) return "audio/webm";

  return undefined;
}
