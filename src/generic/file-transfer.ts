import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";
import { downloadMediaFromUrl } from "./media.js";

export type FileTransfer = {
  fileId: string;
  chatId: string;
  senderId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
  url?: string;
  status: "pending" | "uploading" | "uploaded" | "downloading" | "completed" | "failed";
  progress: number; // 0-100
  uploadedBytes?: number;
  timestamp: number;
  error?: string;
};

export type FileTransferProgress = {
  fileId: string;
  chatId: string;
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  status: "uploading" | "downloading";
  timestamp: number;
};

// Store file transfer states
const fileTransfers = new Map<string, FileTransfer>();

/**
 * Initialize a file transfer
 */
export function initFileTransfer(params: {
  fileId: string;
  chatId: string;
  senderId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
}): FileTransfer {
  const { fileId, chatId, senderId, fileName, fileSize, fileType, mimeType } = params;

  const transfer: FileTransfer = {
    fileId,
    chatId,
    senderId,
    fileName,
    fileSize,
    fileType,
    mimeType,
    status: "pending",
    progress: 0,
    timestamp: Date.now(),
  };

  fileTransfers.set(fileId, transfer);

  return transfer;
}

/**
 * Update file transfer progress
 */
export function updateFileTransferProgress(params: {
  fileId: string;
  progress: number;
  uploadedBytes?: number;
  status?: "uploading" | "downloading" | "uploaded" | "completed" | "failed";
  url?: string;
  error?: string;
}): FileTransfer | undefined {
  const { fileId, progress, uploadedBytes, status, url, error } = params;

  const transfer = fileTransfers.get(fileId);
  if (!transfer) {
    return undefined;
  }

  transfer.progress = Math.min(100, Math.max(0, progress));
  if (uploadedBytes !== undefined) {
    transfer.uploadedBytes = uploadedBytes;
  }
  if (status) {
    transfer.status = status;
  }
  if (url) {
    transfer.url = url;
  }
  if (error) {
    transfer.error = error;
  }

  fileTransfers.set(fileId, transfer);

  return transfer;
}

/**
 * Complete file transfer
 */
export function completeFileTransfer(params: {
  fileId: string;
  url: string;
}): FileTransfer | undefined {
  const { fileId, url } = params;

  return updateFileTransferProgress({
    fileId,
    progress: 100,
    status: "completed",
    url,
  });
}

/**
 * Fail file transfer
 */
export function failFileTransfer(params: { fileId: string; error: string }): FileTransfer | undefined {
  const { fileId, error } = params;

  return updateFileTransferProgress({
    fileId,
    progress: 0,
    status: "failed",
    error,
  });
}

/**
 * Get file transfer status
 */
export function getFileTransfer(fileId: string): FileTransfer | undefined {
  return fileTransfers.get(fileId);
}

/**
 * Get all file transfers for a chat
 */
export function getChatFileTransfers(chatId: string): FileTransfer[] {
  const transfers: FileTransfer[] = [];

  for (const transfer of fileTransfers.values()) {
    if (transfer.chatId === chatId) {
      transfers.push(transfer);
    }
  }

  return transfers.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Broadcast file transfer progress to clients
 */
export function broadcastFileProgress(params: {
  cfg: OpenClawConfig;
  chatId: string;
  progress: FileTransferProgress;
}): void {
  const { cfg, chatId, progress } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: "file.progress",
      data: progress,
    });
  }
}

/**
 * Broadcast file transfer status to clients
 */
export function broadcastFileTransfer(params: {
  cfg: OpenClawConfig;
  chatId: string;
  transfer: FileTransfer;
}): void {
  const { cfg, chatId, transfer } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: "file.transfer",
      data: transfer,
    });
  }
}

/**
 * Handle file upload from client
 */
export async function handleFileUpload(params: {
  cfg: OpenClawConfig;
  fileId: string;
  chatId: string;
  senderId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
  url?: string;
}): Promise<FileTransfer> {
  const { cfg, fileId, chatId, senderId, fileName, fileSize, fileType, mimeType, url } = params;

  // Initialize transfer
  const transfer = initFileTransfer({
    fileId,
    chatId,
    senderId,
    fileName,
    fileSize,
    fileType,
    mimeType,
  });

  // Broadcast initial state
  broadcastFileTransfer({ cfg, chatId, transfer });

  try {
    // Update to uploading
    updateFileTransferProgress({
      fileId,
      progress: 0,
      status: "uploading",
    });

    // Simulate progress updates (in real implementation, track actual upload)
    for (let i = 10; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const updated = updateFileTransferProgress({
        fileId,
        progress: i,
        uploadedBytes: Math.floor((fileSize * i) / 100),
        status: i === 100 ? "uploaded" : "uploading",
      });

      if (updated) {
        broadcastFileProgress({
          cfg,
          chatId,
          progress: {
            fileId,
            chatId,
            progress: i,
            uploadedBytes: updated.uploadedBytes || 0,
            totalBytes: fileSize,
            status: "uploading",
            timestamp: Date.now(),
          },
        });
      }
    }

    // Complete transfer
    const completed = completeFileTransfer({
      fileId,
      url: url || `https://example.com/files/${fileId}`,
    });

    if (completed) {
      broadcastFileTransfer({ cfg, chatId, transfer: completed });
    }

    return completed!;
  } catch (error) {
    const failed = failFileTransfer({
      fileId,
      error: String(error),
    });

    if (failed) {
      broadcastFileTransfer({ cfg, chatId, transfer: failed });
    }

    throw error;
  }
}

/**
 * Handle file download request from client
 */
export async function handleFileDownload(params: {
  cfg: OpenClawConfig;
  fileId: string;
  chatId: string;
  url: string;
  maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType?: string; size: number }> {
  const { cfg, fileId, chatId, url, maxBytes } = params;

  try {
    // Update status to downloading
    updateFileTransferProgress({
      fileId,
      progress: 0,
      status: "downloading",
    });

    // Download file
    const result = await downloadMediaFromUrl({
      url,
      maxBytes: maxBytes || 100 * 1024 * 1024, // 100MB default
    });

    // Complete download
    completeFileTransfer({
      fileId,
      url,
    });

    return {
      buffer: result.buffer,
      contentType: result.contentType,
      size: result.buffer.length,
    };
  } catch (error) {
    failFileTransfer({
      fileId,
      error: String(error),
    });

    throw error;
  }
}
