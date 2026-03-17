import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";
import { removeHistoryMessage, updateHistoryMessage } from "./history.js";

export type MessageEdit = {
  messageId: string;
  chatId: string;
  senderId: string;
  newContent: string;
  editedAt: number;
  editHistory?: Array<{ content: string; editedAt: number }>;
};

export type MessageDelete = {
  messageId: string;
  chatId: string;
  senderId: string;
  deleteType: "soft" | "hard"; // soft = mark as deleted, hard = remove completely
  deletedAt: number;
};

// Store message edits and deletions
const messageEdits = new Map<string, MessageEdit>();
const deletedMessages = new Set<string>();

/**
 * Edit a message
 */
export function editMessage(params: {
  messageId: string;
  chatId: string;
  senderId: string;
  newContent: string;
  oldContent?: string;
}): MessageEdit {
  const { messageId, chatId, senderId, newContent, oldContent } = params;
  const key = `${chatId}:${messageId}`;

  const existingEdit = messageEdits.get(key);
  const editHistory = existingEdit?.editHistory || [];

  // Add old content to history if provided
  if (oldContent) {
    editHistory.push({
      content: oldContent,
      editedAt: existingEdit?.editedAt || Date.now(),
    });
  }

  const edit: MessageEdit = {
    messageId,
    chatId,
    senderId,
    newContent,
    editedAt: Date.now(),
    editHistory,
  };

  messageEdits.set(key, edit);
  return edit;
}

/**
 * Delete a message
 */
export function deleteMessage(params: {
  messageId: string;
  chatId: string;
  senderId: string;
  deleteType?: "soft" | "hard";
}): MessageDelete {
  const { messageId, chatId, senderId, deleteType = "soft" } = params;
  const key = `${chatId}:${messageId}`;

  deletedMessages.add(key);

  const deletion: MessageDelete = {
    messageId,
    chatId,
    senderId,
    deleteType,
    deletedAt: Date.now(),
  };

  // If hard delete, also remove from edits
  if (deleteType === "hard") {
    messageEdits.delete(key);
  }

  return deletion;
}

/**
 * Check if a message is deleted
 */
export function isMessageDeleted(params: { messageId: string; chatId: string }): boolean {
  const key = `${params.chatId}:${params.messageId}`;
  return deletedMessages.has(key);
}

/**
 * Get message edit history
 */
export function getMessageEditHistory(params: {
  messageId: string;
  chatId: string;
}): MessageEdit | undefined {
  const key = `${params.chatId}:${params.messageId}`;
  return messageEdits.get(key);
}

/**
 * Broadcast message edit event
 */
export function broadcastMessageEdit(params: {
  cfg: OpenClawConfig;
  chatId: string;
  edit: MessageEdit;
}): void {
  const { cfg, chatId, edit } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: "message.edit",
      data: edit,
    });
  }
}

/**
 * Broadcast message deletion event
 */
export function broadcastMessageDelete(params: {
  cfg: OpenClawConfig;
  chatId: string;
  deletion: MessageDelete;
}): void {
  const { cfg, chatId, deletion } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(chatId, {
      type: "message.delete",
      data: deletion,
    });
  }
}

/**
 * Handle incoming message edit event
 */
export async function handleMessageEdit(params: {
  cfg: OpenClawConfig;
  edit: MessageEdit;
}): Promise<void> {
  const { cfg, edit } = params;

  // Validate the edit (e.g., check if sender owns the message)
  // For now, we'll allow any edit
  const updatedEdit = editMessage(edit);
  updateHistoryMessage({
    chatId: edit.chatId,
    messageId: edit.messageId,
    content: updatedEdit.newContent,
    timestamp: updatedEdit.editedAt,
  });

  // Broadcast to all clients in the chat
  broadcastMessageEdit({
    cfg,
    chatId: edit.chatId,
    edit: updatedEdit,
  });
}

/**
 * Handle incoming message deletion event
 */
export async function handleMessageDelete(params: {
  cfg: OpenClawConfig;
  deletion: MessageDelete;
}): Promise<void> {
  const { cfg, deletion } = params;

  // Validate the deletion (e.g., check if sender owns the message)
  const processedDeletion = deleteMessage(deletion);
  removeHistoryMessage({
    chatId: deletion.chatId,
    messageId: deletion.messageId,
  });

  // Broadcast to all clients in the chat
  broadcastMessageDelete({
    cfg,
    chatId: deletion.chatId,
    deletion: processedDeletion,
  });
}
