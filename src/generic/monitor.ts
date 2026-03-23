import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { AgentContextFile, GenericChannelConfig, InboundMessage } from "./types.js";
import {
  createGenericWSManager,
  destroyGenericWSManager,
  type FileProgressData,
  type FileTransferData,
} from "./client.js";
import { handleGenericMessage } from "./bot.js";
import { handleStatusUpdate } from "./status.js";
import { handleMessageEdit, handleMessageDelete } from "./message-management.js";
import { handleReactionEvent } from "./reactions.js";
import { handleForwardRequest } from "./forwarding.js";
import { handleUserStatusUpdate } from "./presence.js";
import {
  initFileTransfer,
  getFileTransfer,
  updateFileTransferProgress,
  completeFileTransfer,
  failFileTransfer,
  broadcastFileTransfer,
  broadcastFileProgress,
} from "./file-transfer.js";
import { handleGroupAction } from "./groups.js";
import { handlePinMessage, handleUnpinMessage } from "./pins-stars.js";
import { getConversationSummaries, getRecentHistoryMessages } from "./history.js";
import { listGenericAgents, resolveGenericAgentId, resolveGenericAgentWorkspaceCandidates } from "./agents.js";
import { isGenericAgentAllowed } from "./auth.js";

export type MonitorGenericOpts = {
  config?: OpenClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

let currentWSManager: ReturnType<typeof createGenericWSManager> | null = null;
const AGENT_CONTEXT_FILENAMES = ["SOUL.md", "IDENTITY.md", "USER.md", "CONTEXT.md", "AGENTS.md", "TOOLS.md", "HEARTBEAT.md"] as const;

async function readAgentContextFilesFromWorkspace(workspaceDir: string): Promise<AgentContextFile[]> {
  const files = await Promise.all(
    AGENT_CONTEXT_FILENAMES.map(async (name) => {
      const filePath = path.join(workspaceDir, name);

      try {
        const [content, fileStats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
        return {
          name,
          content,
          updatedAt: Number.isFinite(fileStats.mtimeMs) ? Math.round(fileStats.mtimeMs) : undefined,
        } satisfies AgentContextFile;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return undefined;
        }
        throw err;
      }
    }),
  );

  return files.flatMap((file) => (file ? [file] : []));
}

async function loadAgentContextFiles(cfg: OpenClawConfig, agentId: string): Promise<AgentContextFile[]> {
  const workspaceCandidates = resolveGenericAgentWorkspaceCandidates(cfg, agentId);

  for (const workspaceDir of workspaceCandidates) {
    const files = await readAgentContextFilesFromWorkspace(workspaceDir);
    if (files.length > 0) {
      return files;
    }
  }

  return [];
}

export async function monitorGenericProvider(opts: MonitorGenericOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for Generic monitor");
  }

  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;
  if (!genericCfg?.enabled) {
    throw new Error("Generic channel not enabled");
  }

  const log = opts.runtime?.log ?? console.log;
  const error = opts.runtime?.error ?? console.error;

  const connectionMode = genericCfg.connectionMode ?? "websocket";

  if (connectionMode === "websocket" || connectionMode === "relay") {
    return monitorWebSocket({ cfg, genericCfg, runtime: opts.runtime, abortSignal: opts.abortSignal });
  }

  log("generic: webhook mode requires HTTP server setup externally");
}

async function monitorWebSocket(params: {
  cfg: OpenClawConfig;
  genericCfg: GenericChannelConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, genericCfg, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const modeLabel = genericCfg.connectionMode === "relay" ? "relay client" : "WebSocket server";
  log(`generic: starting ${modeLabel}...`);

  const wsManager = createGenericWSManager(genericCfg);
  currentWSManager = wsManager;

  const chatHistories = new Map<string, HistoryEntry[]>();
  const sendAgentList = (ws: Parameters<typeof wsManager.sendDirect>[0], requestId?: string) => {
    const { agents, defaultAgentId } = listGenericAgents(cfg);
    const allowedAgentIds = wsManager.getAllowedAgentIds(ws);
    const selectedAgentId = wsManager.getSelectedAgentId(ws);
    const visibleAgents = allowedAgentIds?.length
      ? agents.filter((agent) => allowedAgentIds.includes(agent.id))
      : agents;
    const visibleDefaultAgentId = visibleAgents.some((agent) => agent.id === defaultAgentId)
      ? defaultAgentId
      : visibleAgents[0]?.id ?? defaultAgentId;

    wsManager.sendDirect(ws, {
      type: "agent.list",
      data: {
        requestId,
        agents: visibleAgents,
        defaultAgentId: visibleDefaultAgentId,
        selectedAgentId,
        timestamp: Date.now(),
      },
    });
  };

  const sendAgentContext = async (params: {
    ws: Parameters<typeof wsManager.sendDirect>[0];
    requestId?: string;
    agentId: string;
  }) => {
    const requestedAgentId = String(params.agentId ?? "").trim();
    const resolvedAgentId = resolveGenericAgentId(cfg, requestedAgentId);
    const responseAgentId = resolvedAgentId ?? requestedAgentId;
    const allowedAgentIds = wsManager.getAllowedAgentIds(params.ws);
    const files =
      resolvedAgentId &&
      isGenericAgentAllowed({
        allowedAgents: allowedAgentIds,
        requestedAgentId: resolvedAgentId,
      })
        ? await loadAgentContextFiles(cfg, resolvedAgentId)
        : [];

    wsManager.sendDirect(params.ws, {
      type: "agent.context",
      data: {
        requestId: params.requestId,
        agentId: responseAgentId,
        files,
        timestamp: Date.now(),
      },
    });
  };

  const sendHistorySync = (params: {
    ws: Parameters<typeof wsManager.sendDirect>[0];
    chatId: string;
    requestId?: string;
    limit?: number;
    agentId?: string;
  }) => {
    const historyLimit = Math.max(0, params.limit ?? genericCfg.historyLimit ?? 10);
    wsManager.sendDirect(params.ws, {
      type: "history.sync",
      data: {
        requestId: params.requestId,
        chatId: params.chatId,
        agentId: params.agentId,
        messages: getRecentHistoryMessages({
          chatId: params.chatId,
          limit: historyLimit,
          agentId: params.agentId,
        }),
        timestamp: Date.now(),
      },
    });
  };

  const sendAgentSelected = (params: {
    ws: Parameters<typeof wsManager.sendDirect>[0];
    requestId?: string;
    ok: boolean;
    selectedAgentId?: string;
    error?: string;
  }) => {
    wsManager.sendDirect(params.ws, {
      type: "agent.selected",
      data: {
        requestId: params.requestId,
        ok: params.ok,
        mode: params.selectedAgentId ? "explicit" : "auto",
        selectedAgentId: params.selectedAgentId,
        error: params.error,
        timestamp: Date.now(),
      },
    });
  };

  wsManager.onClientConnect = ({ chatId, ws }) => {
    const requestedAgentId = wsManager.getSelectedAgentId(ws);
    if (!requestedAgentId) {
      // Don't send history.sync without agentId — client will selectAgent then requestHistory
      return;
    }

    if (!isGenericAgentAllowed({
      allowedAgents: wsManager.getAllowedAgentIds(ws),
      requestedAgentId,
    })) {
      wsManager.setSelectedAgentId(ws, undefined);
      sendAgentSelected({
        ws,
        ok: false,
        error: `agentId not allowed: ${requestedAgentId}`,
      });
      // Don't send history.sync — agent not allowed, client doesn't know which agent's history to show
      return;
    }

    const resolvedAgentId = resolveGenericAgentId(cfg, requestedAgentId);
    if (resolvedAgentId) {
      wsManager.setSelectedAgentId(ws, resolvedAgentId);
      sendAgentSelected({
        ws,
        ok: true,
        selectedAgentId: resolvedAgentId,
      });
      if (chatId) {
        sendHistorySync({
          ws,
          chatId,
          agentId: resolvedAgentId,
        });
      }
      return;
    }

    wsManager.setSelectedAgentId(ws, undefined);
    sendAgentSelected({
      ws,
      ok: false,
      error: `Unknown agentId: ${requestedAgentId}`,
    });
    // Don't send history.sync — unknown agent, no valid agentId to filter by
  };

  wsManager.onAgentListRequest = ({ ws, data }) => {
    sendAgentList(ws, data.requestId);
  };

  wsManager.onAgentContextRequest = ({ ws, data }) => {
    sendAgentContext({
      ws,
      requestId: data.requestId,
      agentId: data.agentId,
    }).catch((err) => {
      error(`generic: error handling agent context request: ${String(err)}`);
    });
  };

  wsManager.onHistoryRequest = ({ ws, data }) => {
    sendHistorySync({
      ws,
      chatId: data.chatId,
      requestId: data.requestId,
      limit: data.limit,
      agentId: data.agentId || wsManager.getSelectedAgentId(ws),
    });
  };

  wsManager.onAgentSelectRequest = ({ ws, data }) => {
    const requestedAgentId = String(data.agentId ?? "").trim();

    if (!requestedAgentId) {
      wsManager.setSelectedAgentId(ws, undefined);
      sendAgentSelected({
        ws,
        requestId: data.requestId,
        ok: true,
      });
      return;
    }

    if (!isGenericAgentAllowed({
      allowedAgents: wsManager.getAllowedAgentIds(ws),
      requestedAgentId,
    })) {
      sendAgentSelected({
        ws,
        requestId: data.requestId,
        ok: false,
        selectedAgentId: wsManager.getSelectedAgentId(ws),
        error: `agentId not allowed: ${requestedAgentId}`,
      });
      return;
    }

    const resolvedAgentId = resolveGenericAgentId(cfg, requestedAgentId);
    if (!resolvedAgentId) {
      sendAgentSelected({
        ws,
        requestId: data.requestId,
        ok: false,
        selectedAgentId: wsManager.getSelectedAgentId(ws),
        error: `Unknown agentId: ${requestedAgentId}`,
      });
      return;
    }

    wsManager.setSelectedAgentId(ws, resolvedAgentId);
    sendAgentSelected({
      ws,
      requestId: data.requestId,
      ok: true,
      selectedAgentId: resolvedAgentId,
    });
  };

  wsManager.onChannelStatusRequest = ({ chatId, ws, data }) => {
    const stats = wsManager.getConnectionStats();
    const connectionMode = genericCfg.connectionMode ?? "websocket";
    const port = connectionMode === "websocket"
      ? (genericCfg.wsPort ?? 8080)
      : (genericCfg.webhookPort ?? 3000);

    wsManager.sendDirect(ws, {
      type: "channel.status",
      data: {
        requestId: data.requestId,
        channel: "clawline",
        configured: true,
        enabled: true,
        running: true,
        mode: connectionMode,
        port,
        path: connectionMode === "websocket" ? (genericCfg.wsPath ?? "/ws") : genericCfg.webhookPath,
        currentChatId: chatId ?? "",
        currentChatConnectionCount: chatId ? wsManager.getConnectionCount(chatId) : 0,
        connectedChatCount: stats.connectedChatCount,
        connectedSocketCount: stats.connectedSocketCount,
        connectedChats: data.includeChats ? stats.connectedChats : undefined,
        timestamp: Date.now(),
        // New: Enhanced Server Info
        server: {
          uptime: process.uptime(),
          node: process.version,
          platform: process.platform,
          memory: process.memoryUsage(),
          pid: process.pid,
          time: new Date().toISOString(),
        }
      },
    });
  };

  wsManager.onConversationListRequest = ({ ws, data }) => {
    const authUser = wsManager.getAuthenticatedUser(ws);
    const allowedAgentIds = wsManager.getAllowedAgentIds(ws);
    const requestedAgentId = String(data.agentId ?? "").trim().toLowerCase();
    const effectiveAgentId =
      requestedAgentId && (!allowedAgentIds?.length || allowedAgentIds.includes(requestedAgentId))
        ? requestedAgentId
        : undefined;

    wsManager.sendDirect(ws, {
      type: "conversation.list",
      data: {
        requestId: data.requestId,
        conversations: getConversationSummaries({
          userId: authUser?.senderId,
          agentId: effectiveAgentId,
          chatType: data.chatType,
          limit: data.limit,
        }),
        timestamp: Date.now(),
      },
    });
  };

  // Set up message handler
  wsManager.onMessageReceive = async (message: InboundMessage) => {
    try {
      await handleGenericMessage({
        cfg,
        message,
        runtime,
        chatHistories,
      });
    } catch (err) {
      error(`generic: error handling message: ${String(err)}`);
    }
  };

  // Set up status update handler
  wsManager.onStatusUpdate = async (data) => {
    try {
      await handleStatusUpdate({
        cfg,
        statusUpdate: {
          messageId: data.messageId,
          chatId: data.chatId,
          senderId: data.senderId ?? "unknown",
          status: data.status,
          timestamp: data.timestamp ?? Date.now(),
        },
      });
    } catch (err) {
      error(`generic: error handling status update: ${String(err)}`);
    }
  };

  // Set up message edit handler
  wsManager.onMessageEdit = async (data) => {
    try {
      await handleMessageEdit({
        cfg,
        edit: {
          messageId: data.messageId,
          chatId: data.chatId,
          senderId: data.senderId,
          newContent: data.newContent,
          editedAt: Date.now(),
        },
      });
    } catch (err) {
      error(`generic: error handling message edit: ${String(err)}`);
    }
  };

  // Set up message delete handler
  wsManager.onMessageDelete = async (data) => {
    try {
      await handleMessageDelete({
        cfg,
        deletion: {
          messageId: data.messageId,
          chatId: data.chatId,
          senderId: data.senderId,
          deleteType: data.deleteType ?? "soft",
          deletedAt: Date.now(),
        },
      });
    } catch (err) {
      error(`generic: error handling message delete: ${String(err)}`);
    }
  };

  // Set up typing indicator handler
  wsManager.onTypingIndicator = async (data) => {
    log(`generic: ${data.senderId} is ${data.isTyping ? "typing" : "stopped typing"} in ${data.chatId}`);
    wsManager.sendToClient(data.chatId, {
      type: "typing",
      data,
    });
  };

  wsManager.onReactionEvent = async (event) => {
    try {
      await handleReactionEvent({
        cfg,
        event: event as any,
      });
    } catch (err) {
      error(`generic: error handling reaction event: ${String(err)}`);
    }
  };

  wsManager.onMessageForward = async (data) => {
    try {
      await handleForwardRequest({
        cfg,
        forward: data as any,
      });
    } catch (err) {
      error(`generic: error handling forward request: ${String(err)}`);
    }
  };

  wsManager.onUserStatusUpdate = async (data) => {
    try {
      await handleUserStatusUpdate({
        cfg,
        status: data as any,
      });
    } catch (err) {
      error(`generic: error handling user status: ${String(err)}`);
    }
  };

  wsManager.onFileTransfer = async (data: FileTransferData) => {
    try {
      let transfer = getFileTransfer(data.fileId);
      if (!transfer) {
        transfer = initFileTransfer({
          fileId: data.fileId,
          chatId: data.chatId,
          senderId: data.senderId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
          mimeType: data.mimeType,
        });
      }

      if (data.status === "failed") {
        transfer = failFileTransfer({
          fileId: data.fileId,
          error: data.error ?? "File transfer failed",
        });
      } else if (data.status === "uploaded" || data.status === "completed") {
        transfer = completeFileTransfer({
          fileId: data.fileId,
          url: data.url ?? transfer.url ?? `https://example.com/files/${data.fileId}`,
        });
      } else {
        transfer = updateFileTransferProgress({
          fileId: data.fileId,
          progress: data.progress ?? transfer.progress,
          uploadedBytes: data.uploadedBytes,
          status: data.status === "pending" ? undefined : data.status,
          url: data.url,
          error: data.error,
        });
      }

      if (transfer) {
        broadcastFileTransfer({
          cfg,
          chatId: transfer.chatId,
          transfer,
        });
      }
    } catch (err) {
      error(`generic: error handling file transfer: ${String(err)}`);
    }
  };

  wsManager.onFileProgress = async (data: FileProgressData) => {
    try {
      const transfer = getFileTransfer(data.fileId);
      const totalBytes = data.totalBytes ?? transfer?.fileSize ?? 0;
      const uploadedBytes = data.uploadedBytes ?? Math.floor((totalBytes * (data.progress ?? 0)) / 100);

      const updated = updateFileTransferProgress({
        fileId: data.fileId,
        progress: data.progress ?? 0,
        uploadedBytes,
        status: data.status,
      });

      if (updated) {
        broadcastFileProgress({
          cfg,
          chatId: updated.chatId,
          progress: {
            fileId: updated.fileId,
            chatId: updated.chatId,
            progress: updated.progress,
            uploadedBytes,
            totalBytes,
            status: (data.status ?? "uploading") as "uploading" | "downloading",
            timestamp: data.timestamp ?? Date.now(),
          },
        });
      }
    } catch (err) {
      error(`generic: error handling file progress: ${String(err)}`);
    }
  };

  wsManager.onGroupAction = async (data) => {
    try {
      await handleGroupAction({
        cfg,
        action: data as any,
      });
    } catch (err) {
      error(`generic: error handling group action: ${String(err)}`);
    }
  };

  wsManager.onPinMessage = async (data) => {
    try {
      await handlePinMessage({
        cfg,
        messageId: data.messageId,
        chatId: data.chatId,
        pinnedBy: data.pinnedBy,
        expiresAt: data.expiresAt,
      });
    } catch (err) {
      error(`generic: error handling pin request: ${String(err)}`);
    }
  };

  wsManager.onUnpinMessage = async (data) => {
    try {
      await handleUnpinMessage({
        cfg,
        messageId: data.messageId,
        chatId: data.chatId,
      });
    } catch (err) {
      error(`generic: error handling unpin request: ${String(err)}`);
    }
  };

  // Start the WebSocket server
  wsManager.start();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (currentWSManager === wsManager) {
        destroyGenericWSManager();
        currentWSManager = null;
      }
    };

    const handleAbort = () => {
      log(`generic: abort signal received, stopping ${genericCfg.connectionMode === "relay" ? "relay client" : "WebSocket server"}`);
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    log(`generic: ${genericCfg.connectionMode === "relay" ? "relay client" : "WebSocket server"} is running`);
  });
}

export function stopGenericMonitor(): void {
  if (currentWSManager) {
    destroyGenericWSManager();
    currentWSManager = null;
  }
}
