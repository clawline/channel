import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { HistoryEntry } from "openclaw/plugin-sdk/reply-history";
import type { AgentContextFile, GenericChannelConfig, InboundMessage, WSEventType } from "./types.js";
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
// D8: history.ts removed — local file is no longer source of truth.
// history.sync / conversation.list WS frames now return empty;
// clients fall back to gateway /api/messages/sync (Supabase).
import { listGenericAgents, resolveGenericAgentId, resolveGenericAgentModel, resolveGenericAgentWorkspaceCandidates } from "./agents.js";
import { isGenericAgentAllowed } from "./auth.js";
import { consumeStreamState, pruneExpiredStreams } from "./stream-state.js";
import { createClawlineSessionBindingAdapter } from "./session-bindings.js";

export type MonitorGenericOpts = {
  config?: OpenClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

let currentWSManager: ReturnType<typeof createGenericWSManager> | null = null;

/** Get the current active WS manager instance (for tool events, etc.) */
export function getGenericWSManager() {
  return currentWSManager;
}
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

  // Register session binding adapter for thread support (ACP --thread auto)
  // Pass Supabase credentials when available so ACP sessions are registered in cl_threads
  const supabaseUrl = process.env.RELAY_SUPABASE_URL;
  const supabaseKey = process.env.RELAY_SUPABASE_SERVICE_ROLE_KEY;
  const relayChannelId = genericCfg.relay?.channelId || "";
  const acpThreadHooks = supabaseUrl && supabaseKey && relayChannelId
    ? { supabaseUrl, supabaseKey, channelId: relayChannelId }
    : undefined;
  const bindingAdapter = createClawlineSessionBindingAdapter(
    params.cfg.channels?.["clawline"] ? "default" : "default",
    acpThreadHooks,
  );
  bindingAdapter.register();

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
    before?: number;
    agentId?: string;
  }) => {
    // D8: history.sync now empty; clients fall back to gateway /api/messages/sync.
    const messages: unknown[] = [];
    wsManager.sendDirect(params.ws, {
      type: "history.sync",
      data: {
        requestId: params.requestId,
        chatId: params.chatId,
        agentId: params.agentId,
        messages,
        hasMore: false,
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

        // Check for interrupted stream state (断点续传 on reconnect with agentId in URL)
        const streamState = consumeStreamState(chatId, resolvedAgentId);
        if (streamState && streamState.streamText) {
          wsManager.sendDirect(ws, {
            type: "stream.resume" as WSEventType,
            data: {
              chatId,
              agentId: resolvedAgentId,
              text: streamState.streamText,
              isComplete: streamState.completed,
              startTime: streamState.startTime,
              timestamp: Date.now(),
            },
          });
          log(`generic: stream.resume sent on connect for ${resolvedAgentId} (${streamState.streamText.length} chars)`);
        }
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
      before: data.before,
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

    // Flush any buffered events for the newly selected agent (断点续传).
    // If the previous agent was streaming while the user switched away,
    // those events were buffered. Now deliver them.
    const chatId = wsManager.getCurrentChatId(ws);
    const pending = wsManager.flushPendingForAgent(ws, resolvedAgentId);
    if (pending) {
      // If we have a final message, deliver it directly (contains full text).
      if (pending.finalMessage) {
        wsManager.sendDirect(ws, pending.finalMessage);
      } else if (pending.streamText) {
        // Streaming was in progress when user switched away — deliver accumulated text
        // as a single delta chunk so the client can render it, then continue streaming.
        wsManager.sendDirect(ws, {
          type: "text.delta" as WSEventType,
          data: {
            chatId: chatId ?? "",
            text: pending.streamText,
            done: pending.streamDone,
            agentId: resolvedAgentId,
            timestamp: Date.now(),
          },
        });
      }
    } else if (chatId) {
      // No per-connection buffer — check chat-level stream state (断点续传 across disconnections).
      // This covers the case where the browser was closed mid-stream and the client reconnects.
      const streamState = consumeStreamState(chatId, resolvedAgentId);
      if (streamState && streamState.streamText) {
        wsManager.sendDirect(ws, {
          type: "stream.resume" as WSEventType,
          data: {
            chatId,
            agentId: resolvedAgentId,
            text: streamState.streamText,
            isComplete: streamState.completed,
            startTime: streamState.startTime,
            timestamp: Date.now(),
          },
        });
        log(`generic: stream.resume sent for ${resolvedAgentId} (${streamState.streamText.length} chars, complete=${streamState.completed})`);
      }
    }
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
        // D8: local history file removed; clients should use gateway REST for conversation listing.
        conversations: [],
        timestamp: Date.now(),
      },
    });
  };

  // Models list handler — returns available providers and models from OpenClaw config
  wsManager.onModelsListRequest = ({ ws, data }) => {
    (async () => {
      try {
        // @ts-expect-error — dynamic import of OpenClaw plugin-sdk export
        const { buildModelsProviderData } = await import("openclaw/plugin-sdk/models-provider-runtime");
        const providerData = await buildModelsProviderData(cfg, data.agentId || undefined);
        const models: Record<string, string[]> = {};
        for (const [provider, modelSet] of providerData.byProvider) {
          models[provider] = [...modelSet];
        }
        const modelNames: Record<string, string> = {};
        for (const [key, name] of providerData.modelNames) {
          modelNames[key] = name;
        }
        wsManager.sendDirect(ws, {
          type: "models.list",
          data: {
            requestId: data.requestId,
            models,
            modelNames,
            defaultModel: `${providerData.resolvedDefault.provider}/${providerData.resolvedDefault.model}`,
            currentModel: data.agentId ? resolveGenericAgentModel(cfg, data.agentId) : undefined,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        error(`generic: error loading models list: ${String(err)}`);
        wsManager.sendDirect(ws, {
          type: "models.list",
          data: {
            requestId: data.requestId,
            models: {},
            modelNames: {},
            error: String(err),
            timestamp: Date.now(),
          },
        });
      }
    })();
  };

  // Model switch handler — sends /model command to the agent session
  wsManager.onModelSwitch = ({ chatId, ws, data }) => {
    if (!chatId) return;
    const modelKey = data.model;
    // Synthesize an inbound message with /model command
    const synthMessage: InboundMessage = {
      messageId: `synth-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      senderId: chatId,
      chatType: "direct",
      messageType: "text",
      content: `/model ${modelKey}`,
      timestamp: Date.now(),
      ...(data.agentId ? { agentId: data.agentId } : {}),
    };
    handleGenericMessage({
      cfg,
      message: synthMessage,
      runtime,
      chatHistories,
    }).catch((err) => {
      error(`generic: model switch error: ${String(err)}`);
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

  // Set up suggestion handler (server-side AI suggestion generation)
  wsManager.onSuggestionRequest = async ({ ws, data }) => {
  
    try {
      const { generateSuggestions } = await import("./suggestions.js");
      const result = await generateSuggestions(cfg, data.messages);
      wsManager.sendDirect(ws, {
        type: "suggestion.response" as WSEventType,
        data: {
          requestId: data.requestId,
          suggestions: result.suggestions,
          source: "server",
          timestamp: Date.now(),
        },
      });
    } catch (err) {
      error(`generic: error generating suggestions: ${String(err)}`);
      wsManager.sendDirect(ws, {
        type: "suggestion.response" as WSEventType,
        data: {
          requestId: data.requestId,
          suggestions: [],
          source: "server",
          error: String(err),
          timestamp: Date.now(),
        },
      });
    }
  };

  // Thread event handlers (in relay mode, these are handled by the gateway directly)
  // These stubs are provided for direct websocket mode forward-compatibility
  wsManager.onThreadCreate = ({ ws, data, userId }) => {
    log(`generic: thread.create from user=${userId ?? 'unknown'}, parentMessageId=${data.parentMessageId}`);
    // In relay mode, handled by gateway. In direct websocket mode, would need Supabase access.
    wsManager.sendDirect(ws, {
      type: "thread.create" as WSEventType,
      data: { requestId: data.requestId, error: "Thread operations require relay mode" },
    });
  };

  wsManager.onThreadGet = ({ ws, data, userId }) => {
    log(`generic: thread.get from user=${userId ?? 'unknown'}, threadId=${data.threadId}`);
    wsManager.sendDirect(ws, {
      type: "thread.get" as WSEventType,
      data: { requestId: data.requestId, error: "Thread operations require relay mode" },
    });
  };

  wsManager.onThreadList = ({ ws, data, userId }) => {
    log(`generic: thread.list from user=${userId ?? 'unknown'}, channelId=${data.channelId ?? 'default'}`);
    wsManager.sendDirect(ws, {
      type: "thread.list" as WSEventType,
      data: { requestId: data.requestId, error: "Thread operations require relay mode" },
    });
  };

  wsManager.onThreadUpdate = ({ ws, data, userId }) => {
    log(`generic: thread.update from user=${userId ?? 'unknown'}, threadId=${data.threadId}`);
    wsManager.sendDirect(ws, {
      type: "thread.update" as WSEventType,
      data: { requestId: data.requestId, error: "Thread operations require relay mode" },
    });
  };

  wsManager.onThreadDelete = ({ ws, data, userId }) => {
    log(`generic: thread.delete from user=${userId ?? 'unknown'}, threadId=${data.threadId}`);
    wsManager.sendDirect(ws, {
      type: "thread.delete" as WSEventType,
      data: { requestId: data.requestId, error: "Thread operations require relay mode" },
    });
  };

  wsManager.onThreadMarkRead = ({ ws, data, userId }) => {
    log(`generic: thread.mark_read from user=${userId ?? 'unknown'}, threadId=${data.threadId}`);
    wsManager.sendDirect(ws, {
      type: "thread.mark_read" as WSEventType,
      data: { error: "Thread operations require relay mode" },
    });
  };

  wsManager.onThreadSearch = ({ ws, data, userId }) => {
    log(`generic: thread.search from user=${userId ?? 'unknown'}, threadId=${data.threadId}, query=${data.query}`);
    wsManager.sendDirect(ws, {
      type: "thread.search" as WSEventType,
      data: { error: "Thread operations require relay mode" },
    });
  };

  // Start the WebSocket server
  wsManager.start();

  // Periodically prune expired chat-level stream state (every 5 minutes)
  const streamPruneInterval = setInterval(() => {
    pruneExpiredStreams();
  }, 5 * 60 * 1000);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearInterval(streamPruneInterval);
      bindingAdapter.unregister();
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
