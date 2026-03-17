import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HTTPServer } from "http";
import type {
  GenericChannelConfig,
  WSEvent,
  InboundMessage,
  ChannelStatusRequest,
  HistoryRequest,
  AgentListRequest,
  AgentSelectRequest,
  ConversationListRequest,
} from "./types.js";
import {
  authenticateGenericConnection,
  isGenericAgentAllowed,
  type GenericConnectionAuthResult,
  type GenericAuthUser,
} from "./auth.js";
import type { ForwardedMessage } from "./forwarding.js";
import type { GroupAction } from "./groups.js";
import type { UserPresence } from "./presence.js";
import type { ReactionEvent } from "./reactions.js";
import type { MessageStatusUpdate } from "./status.js";
import {
  buildRelayAuthUrl,
  type RelayBackendAckFrame,
  type RelayBackendErrorFrame,
  type RelayBackendHelloFrame,
  type RelayClientCloseFrame,
  type RelayClientEventFrame,
  type RelayClientOpenFrame,
  type RelayFrame,
  type RelayServerCloseFrame,
  type RelayServerEventFrame,
  type RelayServerRejectFrame,
  type RelayTrustedAuthUser,
} from "./relay-protocol.js";

export type TypingIndicatorData = {
  chatId: string;
  senderId: string;
  senderName?: string;
  isTyping: boolean;
  timestamp?: number;
};

export type MessageEditData = {
  messageId: string;
  chatId: string;
  senderId: string;
  newContent: string;
  oldContent?: string;
  editedAt?: number;
};

export type MessageDeleteData = {
  messageId: string;
  chatId: string;
  senderId: string;
  deleteType?: "soft" | "hard";
  deletedAt?: number;
};

export type FileTransferData = {
  fileId: string;
  chatId: string;
  senderId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
  status: "pending" | "uploading" | "uploaded" | "downloading" | "completed" | "failed";
  progress?: number;
  uploadedBytes?: number;
  url?: string;
  error?: string;
  timestamp?: number;
};

export type FileProgressData = {
  fileId: string;
  chatId: string;
  progress: number;
  uploadedBytes?: number;
  totalBytes?: number;
  status?: "uploading" | "downloading" | "completed";
  timestamp?: number;
};

export type PinMessageData = {
  messageId: string;
  chatId: string;
  pinnedBy: string;
  pinnedAt?: number;
  expiresAt?: number;
};

export type UnpinMessageData = {
  messageId: string;
  chatId: string;
};

export type ChannelStatusRequestData = ChannelStatusRequest;
export type HistoryRequestData = HistoryRequest;
export type AgentListRequestData = AgentListRequest;
export type AgentSelectRequestData = AgentSelectRequest;
export type ConversationListRequestData = ConversationListRequest;

type ClientConnectionState = {
  connectionId: string;
  currentChatId?: string;
  subscribedChatIds: Set<string>;
  selectedAgentId?: string;
  authUser?: GenericAuthUser;
};

type ConnectionStats = {
  connectedChatCount: number;
  connectedSocketCount: number;
  connectedChats: string[];
};

function isAuthFailure(
  result: GenericConnectionAuthResult,
): result is Extract<GenericConnectionAuthResult, { ok: false }> {
  return result.ok === false;
}

function toRelayCloseCode(code: number): number {
  return code >= 1000 && code <= 4999 ? code : 1008;
}

function normalizeRelayTrustedAgentList(agents?: string[]): string[] | undefined {
  if (!Array.isArray(agents)) {
    return undefined;
  }

  const normalized = agents
    .map((agentId) => String(agentId ?? "").trim().toLowerCase())
    .filter((agentId) => Boolean(agentId));

  if (normalized.includes("*")) {
    return undefined;
  }

  return normalized.length > 0 ? normalized : undefined;
}

function buildRelayTrustedAuthUser(authUser: RelayTrustedAuthUser): GenericAuthUser {
  return {
    id: String(authUser.id),
    senderId: String(authUser.senderId),
    chatId: authUser.chatId?.trim() || undefined,
    token: String(authUser.token),
    allowAgents: normalizeRelayTrustedAgentList(authUser.allowAgents),
  };
}

export interface GenericClientManager {
  start(httpServer?: HTTPServer): void;
  stop(): void;
  getSelectedAgentId(ws: WebSocket): string | undefined;
  getCurrentChatId(ws: WebSocket): string | undefined;
  getSubscribedChatIds(ws: WebSocket): string[];
  getAllowedAgentIds(ws: WebSocket): string[] | undefined;
  getAuthenticatedUser(ws: WebSocket): GenericAuthUser | undefined;
  setSelectedAgentId(ws: WebSocket, agentId?: string): void;
  sendToClient(chatId: string, event: WSEvent): boolean;
  sendDirect(ws: WebSocket, event: WSEvent): void;
  broadcast(event: WSEvent): void;
  isClientConnected(chatId: string): boolean;
  getConnectedClients(): string[];
  getConnectionCount(chatId: string): number;
  getConnectionStats(): ConnectionStats;
  onMessageReceive?: (message: InboundMessage) => void;
  onStatusUpdate?: (data: MessageStatusUpdate) => void;
  onClientConnect?: (params: { chatId?: string; ws: WebSocket; userId?: string }) => void;
  onClientDisconnect?: (params: { chatId?: string; ws: WebSocket; userId?: string }) => void;
  onTypingIndicator?: (data: TypingIndicatorData) => void;
  onMessageEdit?: (data: MessageEditData) => void;
  onMessageDelete?: (data: MessageDeleteData) => void;
  onReactionEvent?: (event: ReactionEvent) => void;
  onMessageForward?: (data: ForwardedMessage) => void;
  onUserStatusUpdate?: (data: UserPresence) => void;
  onFileTransfer?: (data: FileTransferData) => void;
  onFileProgress?: (data: FileProgressData) => void;
  onGroupAction?: (data: GroupAction) => void;
  onPinMessage?: (data: PinMessageData) => void;
  onUnpinMessage?: (data: UnpinMessageData) => void;
  onChannelStatusRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: ChannelStatusRequestData;
  }) => void;
  onHistoryRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: HistoryRequestData;
  }) => void;
  onAgentListRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: AgentListRequestData;
  }) => void;
  onAgentSelectRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: AgentSelectRequestData;
  }) => void;
  onConversationListRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: ConversationListRequestData;
  }) => void;
}

abstract class GenericClientManagerBase implements GenericClientManager {
  protected clients: Map<string, Set<WebSocket>> = new Map();
  protected clientStates: WeakMap<WebSocket, ClientConnectionState> = new WeakMap();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(protected config: GenericChannelConfig) {}

  abstract start(httpServer?: HTTPServer): void;

  stop(): void {
    this.stopHeartbeat();
    this.clients.clear();
  }

  protected abstract sendEvent(ws: WebSocket, event: WSEvent): void;

  protected abstract isHandleOpen(ws: WebSocket): boolean;

  protected onHeartbeatTick(): void {}

  protected startHeartbeat(intervalMs = 30000): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.pruneClosedClients();
      this.onHeartbeatTick();
    }, intervalMs);
  }

  protected stopHeartbeat(): void {
    if (!this.heartbeatInterval) {
      return;
    }
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }

  protected logRejectedEvent(sourceId: string, eventType: WSEvent["type"], reason: string): void {
    console.warn(`[generic] Rejected ${eventType} from ${sourceId}: ${reason}`);
  }

  protected rewriteBoundFields<T extends Record<string, unknown>>(data: T, authUser: GenericAuthUser): T {
    const mutable = data as Record<string, unknown>;

    if (authUser.chatId && "chatId" in data) {
      mutable.chatId = authUser.chatId;
    }
    if ("senderId" in data) {
      mutable.senderId = authUser.senderId;
    }
    if ("userId" in data) {
      mutable.userId = authUser.senderId;
    }
    if ("readBy" in data) {
      mutable.readBy = authUser.senderId;
    }
    if ("pinnedBy" in data) {
      mutable.pinnedBy = authUser.senderId;
    }
    if ("actorId" in data) {
      mutable.actorId = authUser.senderId;
    }
    return data;
  }

  protected isChatAllowed(authUser: GenericAuthUser | undefined, targetChatId?: string | null): boolean {
    if (!authUser?.chatId) {
      return true;
    }

    const normalizedTarget = String(targetChatId ?? "").trim();
    return !normalizedTarget || normalizedTarget === authUser.chatId;
  }

  protected resolveTargetChatId(params: {
    ws: WebSocket;
    incomingChatId?: string | null;
    fallbackChatId?: string | null;
  }): string | undefined {
    const state = this.clientStates.get(params.ws);
    const candidates = [params.incomingChatId, params.fallbackChatId, state?.currentChatId];

    for (const candidate of candidates) {
      const normalized = String(candidate ?? "").trim();
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  protected subscribeClientToChat(ws: WebSocket, chatId: string): void {
    const normalizedChatId = chatId.trim();
    if (!normalizedChatId) {
      return;
    }

    const existing = this.clientStates.get(ws);
    if (existing) {
      existing.currentChatId = normalizedChatId;
      existing.subscribedChatIds.add(normalizedChatId);
      this.clientStates.set(ws, existing);
    }

    const clients = this.clients.get(normalizedChatId) ?? new Set<WebSocket>();
    clients.add(ws);
    this.clients.set(normalizedChatId, clients);
  }

  protected removeClientFromAllChats(ws: WebSocket): void {
    const state = this.clientStates.get(ws);
    if (!state) {
      return;
    }

    for (const chatId of state.subscribedChatIds) {
      const clients = this.clients.get(chatId);
      if (!clients) {
        continue;
      }

      clients.delete(ws);
      if (clients.size === 0) {
        this.clients.delete(chatId);
      }
    }
  }

  protected handleRawMessage(ws: WebSocket, sourceId: string, data: RawData): void {
    try {
      const message = JSON.parse(data.toString()) as WSEvent;
      this.handleParsedMessage(ws, sourceId, message);
    } catch (err) {
      console.error(`[generic] Failed to parse message from ${sourceId}:`, err);
    }
  }

  protected handleParsedMessage(ws: WebSocket, sourceId: string, message: WSEvent): void {
    try {
      const state = this.clientStates.get(ws);
      const authUser = state?.authUser;

      switch (message.type) {
        case "message.receive": {
          const inbound = message.data as InboundMessage;
          const resolvedChatId = this.resolveTargetChatId({
            ws,
            incomingChatId: inbound.chatId,
          });
          if (!resolvedChatId) {
            this.logRejectedEvent(sourceId, message.type, "missing chatId");
            break;
          }

          if (!this.isChatAllowed(authUser, resolvedChatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }

          inbound.chatId = resolvedChatId;
          if (authUser) {
            inbound.senderId = authUser.senderId;

            if (!isGenericAgentAllowed({
              allowedAgents: authUser.allowAgents,
              requestedAgentId: inbound.agentId,
            })) {
              this.logRejectedEvent(sourceId, message.type, `agentId not allowed: ${String(inbound.agentId)}`);
              break;
            }
          }

          this.subscribeClientToChat(ws, inbound.chatId);
          const selectedAgentId = this.getSelectedAgentId(ws);
          if (!String(inbound.agentId ?? "").trim() && selectedAgentId) {
            inbound.agentId = selectedAgentId;
          }
          this.onMessageReceive?.(inbound);
          break;
        }
        case "history.get": {
          const request = (message.data as HistoryRequestData | undefined) ?? ({} as HistoryRequestData);
          const resolvedChatId = this.resolveTargetChatId({
            ws,
            incomingChatId: request.chatId,
          });
          if (!resolvedChatId) {
            this.logRejectedEvent(sourceId, message.type, "missing chatId");
            break;
          }
          if (!this.isChatAllowed(authUser, resolvedChatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          request.chatId = resolvedChatId;
          this.subscribeClientToChat(ws, resolvedChatId);
          this.onHistoryRequest?.({
            chatId: resolvedChatId,
            ws,
            data: request,
          });
          break;
        }
        case "agent.list.get":
          this.onAgentListRequest?.({
            chatId: state?.currentChatId,
            ws,
            data: (message.data as AgentListRequestData | undefined) ?? {},
          });
          break;
        case "agent.select":
          this.onAgentSelectRequest?.({
            chatId: state?.currentChatId,
            ws,
            data: (message.data as AgentSelectRequestData | undefined) ?? {},
          });
          break;
        case "conversation.list.get":
          this.onConversationListRequest?.({
            chatId: state?.currentChatId,
            ws,
            data: (message.data as ConversationListRequestData | undefined) ?? {},
          });
          break;
        case "channel.status.get":
          this.onChannelStatusRequest?.({
            chatId: state?.currentChatId,
            ws,
            data: (message.data as ChannelStatusRequestData | undefined) ?? {},
          });
          break;
        case "typing": {
          const typing = message.data as TypingIndicatorData;
          const resolvedChatId = this.resolveTargetChatId({
            ws,
            incomingChatId: typing.chatId,
          });
          if (!resolvedChatId || !this.isChatAllowed(authUser, resolvedChatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          typing.chatId = resolvedChatId;
          if (authUser) {
            this.rewriteBoundFields(typing as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, typing.chatId);
          this.onTypingIndicator?.(typing);
          break;
        }
        case "status.delivered":
        case "status.read": {
          const statusUpdate = message.data as MessageStatusUpdate;
          if (!this.isChatAllowed(authUser, statusUpdate.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(statusUpdate as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, statusUpdate.chatId);
          this.onStatusUpdate?.(statusUpdate);
          break;
        }
        case "message.edit": {
          const edit = message.data as MessageEditData;
          if (!this.isChatAllowed(authUser, edit.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(edit as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, edit.chatId);
          this.onMessageEdit?.(edit);
          break;
        }
        case "message.delete": {
          const deletion = message.data as MessageDeleteData;
          if (!this.isChatAllowed(authUser, deletion.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(deletion as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, deletion.chatId);
          this.onMessageDelete?.(deletion);
          break;
        }
        case "reaction.add":
        case "reaction.remove": {
          const reactionEvent = message as ReactionEvent;
          const reactionData = reactionEvent.data as Record<string, unknown>;
          if (!this.isChatAllowed(authUser, String(reactionData.chatId ?? ""))) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(reactionData, authUser);
          }
          this.subscribeClientToChat(ws, String(reactionData.chatId ?? ""));
          this.onReactionEvent?.(reactionEvent);
          break;
        }
        case "message.forward": {
          const forward = message.data as ForwardedMessage;
          if (authUser) {
            if (!this.isChatAllowed(authUser, forward.targetChatId) || !this.isChatAllowed(authUser, forward.originalChatId)) {
              this.logRejectedEvent(sourceId, message.type, "forward target/origin must stay within allowed chat scope");
              break;
            }
            forward.forwardedBy = authUser.senderId;
          }
          this.subscribeClientToChat(ws, forward.originalChatId);
          this.subscribeClientToChat(ws, forward.targetChatId);
          this.onMessageForward?.(forward);
          break;
        }
        case "user.status": {
          const presence = message.data as UserPresence;
          if (!this.isChatAllowed(authUser, (presence as { chatId?: string }).chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(presence as unknown as Record<string, unknown>, authUser);
          }
          this.onUserStatusUpdate?.(presence);
          break;
        }
        case "file.transfer": {
          const transfer = message.data as FileTransferData;
          if (!this.isChatAllowed(authUser, transfer.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(transfer as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, transfer.chatId);
          this.onFileTransfer?.(transfer);
          break;
        }
        case "file.progress": {
          const progress = message.data as FileProgressData;
          if (!this.isChatAllowed(authUser, progress.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(progress as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, progress.chatId);
          this.onFileProgress?.(progress);
          break;
        }
        case "group.action": {
          const groupAction = message.data as GroupAction;
          if (authUser) {
            if (!this.isChatAllowed(authUser, groupAction.groupId)) {
              this.logRejectedEvent(sourceId, message.type, "groupId not allowed for this token");
              break;
            }
            this.rewriteBoundFields(groupAction as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, groupAction.groupId);
          this.onGroupAction?.(groupAction);
          break;
        }
        case "message.pin": {
          const pin = message.data as PinMessageData;
          if (!this.isChatAllowed(authUser, pin.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(pin as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, pin.chatId);
          this.onPinMessage?.(pin);
          break;
        }
        case "message.unpin": {
          const unpin = message.data as UnpinMessageData;
          if (!this.isChatAllowed(authUser, unpin.chatId)) {
            this.logRejectedEvent(sourceId, message.type, "chatId not allowed for this token");
            break;
          }
          if (authUser) {
            this.rewriteBoundFields(unpin as unknown as Record<string, unknown>, authUser);
          }
          this.subscribeClientToChat(ws, unpin.chatId);
          this.onUnpinMessage?.(unpin);
          break;
        }
      }
    } catch (err) {
      console.error(`[generic] Failed to handle message from ${sourceId}:`, err);
    }
  }

  getSelectedAgentId(ws: WebSocket): string | undefined {
    return this.clientStates.get(ws)?.selectedAgentId;
  }

  getCurrentChatId(ws: WebSocket): string | undefined {
    return this.clientStates.get(ws)?.currentChatId;
  }

  getSubscribedChatIds(ws: WebSocket): string[] {
    return Array.from(this.clientStates.get(ws)?.subscribedChatIds ?? []);
  }

  getAllowedAgentIds(ws: WebSocket): string[] | undefined {
    return this.clientStates.get(ws)?.authUser?.allowAgents;
  }

  getAuthenticatedUser(ws: WebSocket): GenericAuthUser | undefined {
    return this.clientStates.get(ws)?.authUser;
  }

  setSelectedAgentId(ws: WebSocket, agentId?: string): void {
    const existing = this.clientStates.get(ws);
    if (!existing) {
      return;
    }

    this.clientStates.set(ws, {
      ...existing,
      selectedAgentId: agentId?.trim() || undefined,
    });
  }

  protected pruneClosedClients(): void {
    this.clients.forEach((clients, chatId) => {
      for (const ws of clients) {
        if (!this.isHandleOpen(ws)) {
          clients.delete(ws);
        }
      }

      if (clients.size === 0) {
        this.clients.delete(chatId);
      }
    });
  }

  onMessageReceive?: (message: InboundMessage) => void;
  onStatusUpdate?: (data: MessageStatusUpdate) => void;
  onClientConnect?: (params: { chatId?: string; ws: WebSocket; userId?: string }) => void;
  onClientDisconnect?: (params: { chatId?: string; ws: WebSocket; userId?: string }) => void;
  onTypingIndicator?: (data: TypingIndicatorData) => void;
  onMessageEdit?: (data: MessageEditData) => void;
  onMessageDelete?: (data: MessageDeleteData) => void;
  onReactionEvent?: (event: ReactionEvent) => void;
  onMessageForward?: (data: ForwardedMessage) => void;
  onUserStatusUpdate?: (data: UserPresence) => void;
  onFileTransfer?: (data: FileTransferData) => void;
  onFileProgress?: (data: FileProgressData) => void;
  onGroupAction?: (data: GroupAction) => void;
  onPinMessage?: (data: PinMessageData) => void;
  onUnpinMessage?: (data: UnpinMessageData) => void;
  onChannelStatusRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: ChannelStatusRequestData;
  }) => void;
  onHistoryRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: HistoryRequestData;
  }) => void;
  onAgentListRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: AgentListRequestData;
  }) => void;
  onAgentSelectRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: AgentSelectRequestData;
  }) => void;
  onConversationListRequest?: (params: {
    chatId?: string;
    ws: WebSocket;
    data: ConversationListRequestData;
  }) => void;

  sendToClient(chatId: string, event: WSEvent): boolean {
    const clients = this.clients.get(chatId);
    if (!clients || clients.size === 0) {
      return false;
    }

    let sent = false;
    for (const ws of clients) {
      if (this.isHandleOpen(ws)) {
        this.sendEvent(ws, event);
        sent = true;
      }
    }

    return sent;
  }

  sendDirect(ws: WebSocket, event: WSEvent): void {
    if (!this.isHandleOpen(ws)) {
      return;
    }
    this.sendEvent(ws, event);
  }

  broadcast(event: WSEvent): void {
    const seen = new Set<WebSocket>();
    this.clients.forEach((clients) => {
      clients.forEach((ws) => {
        if (seen.has(ws) || !this.isHandleOpen(ws)) {
          return;
        }
        seen.add(ws);
        this.sendEvent(ws, event);
      });
    });
  }

  isClientConnected(chatId: string): boolean {
    this.pruneClosedClients();
    const clients = this.clients.get(chatId);
    if (!clients) {
      return false;
    }
    for (const ws of clients) {
      if (this.isHandleOpen(ws)) {
        return true;
      }
    }
    return false;
  }

  getConnectedClients(): string[] {
    this.pruneClosedClients();
    return Array.from(this.clients.keys());
  }

  getConnectionCount(chatId: string): number {
    this.pruneClosedClients();
    return this.clients.get(chatId)?.size ?? 0;
  }

  getConnectionStats(): ConnectionStats {
    this.pruneClosedClients();

    const sockets = new Set<WebSocket>();
    for (const clients of this.clients.values()) {
      for (const ws of clients) {
        sockets.add(ws);
      }
    }

    const connectedChats = Array.from(this.clients.keys());
    return {
      connectedChatCount: connectedChats.length,
      connectedSocketCount: sockets.size,
      connectedChats,
    };
  }
}

class GenericWSManager extends GenericClientManagerBase {
  private wss: WebSocketServer | null = null;
  private httpServer: HTTPServer | null = null;

  start(httpServer?: HTTPServer): void {
    const port = this.config.wsPort ?? 8080;
    const path = this.config.wsPath ?? "/ws";
    const verifyClient = this.verifyClient.bind(this);

    if (httpServer) {
      this.httpServer = httpServer;
      this.wss = new WebSocketServer({ server: httpServer, path, verifyClient });
    } else {
      this.wss = new WebSocketServer({ port, path, verifyClient });
    }

    this.wss.on("connection", (ws: WebSocket, req) => {
      const authResult = authenticateGenericConnection({
        config: this.config,
        url: req.url || "",
      });
      if (isAuthFailure(authResult)) {
        ws.close(authResult.code, authResult.message);
        return;
      }

      const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const chatId = authResult.authUser?.chatId ?? authResult.query.chatId;
      const agentId = authResult.query.agentId;
      const connectionLabel = authResult.authUser?.senderId ?? chatId ?? connectionId;
      console.log(`[generic] WebSocket client connected: ${connectionLabel}`);

      this.clientStates.set(ws, {
        connectionId,
        currentChatId: chatId,
        subscribedChatIds: new Set<string>(),
        selectedAgentId: agentId,
        authUser: authResult.authUser,
      });
      if (chatId) {
        this.subscribeClientToChat(ws, chatId);
      }

      ws.on("message", (data: RawData) => {
        this.handleRawMessage(ws, connectionLabel, data);
      });

      ws.on("close", () => {
        const state = this.clientStates.get(ws);
        console.log(`[generic] WebSocket client disconnected: ${connectionLabel}`);
        this.removeClientFromAllChats(ws);
        this.onClientDisconnect?.({
          chatId: state?.currentChatId,
          ws,
          userId: state?.authUser?.senderId,
        });
        this.clientStates.delete(ws);
      });

      ws.on("error", (err) => {
        console.error(`[generic] WebSocket error for ${connectionLabel}:`, err);
      });

      this.sendDirect(ws, {
        type: "connection.open",
        data: {
          chatId,
          userId: authResult.authUser?.senderId,
          timestamp: Date.now(),
        },
      });

      this.onClientConnect?.({
        chatId,
        ws,
        userId: authResult.authUser?.senderId,
      });
    });

    this.startHeartbeat();

    console.log(`[generic] WebSocket server started on ${httpServer ? "attached server" : `port ${port}`} at path ${path}`);
  }

  override stop(): void {
    super.stop();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  protected sendEvent(ws: WebSocket, event: WSEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  protected isHandleOpen(ws: WebSocket): boolean {
    return ws.readyState === WebSocket.OPEN;
  }

  protected override onHeartbeatTick(): void {
    this.clients.forEach((clients) => {
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    });
  }

  private verifyClient(
    info: { origin: string; secure: boolean; req: InstanceType<typeof import("http").IncomingMessage> },
    callback: (res: boolean, code?: number, message?: string) => void,
  ): void {
    const authResult = authenticateGenericConnection({
      config: this.config,
      url: info.req.url || "",
    });

    if (isAuthFailure(authResult)) {
      console.warn(`[generic] WebSocket auth rejected: ${authResult.message}`);
      callback(false, authResult.code, authResult.message);
      return;
    }

    callback(true);
  }
}

class GenericRelayManager extends GenericClientManagerBase {
  private backendSocket: WebSocket | null = null;
  private backendReady = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private stopped = false;
  private connectionHandles = new Map<string, WebSocket>();
  private handleConnectionIds = new WeakMap<WebSocket, string>();

  start(): void {
    this.stopped = false;
    this.connectBackend();
    this.startHeartbeat();
  }

  override stop(): void {
    this.stopped = true;
    super.stop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    this.disconnectAllVirtualClients("relay manager stopped");
    if (this.backendSocket) {
      this.backendSocket.close();
      this.backendSocket = null;
    }
    this.backendReady = false;
  }

  protected sendEvent(ws: WebSocket, event: WSEvent): void {
    const connectionId = this.handleConnectionIds.get(ws);
    if (!connectionId || !this.backendSocket || this.backendSocket.readyState !== WebSocket.OPEN || !this.backendReady) {
      return;
    }

    const frame: RelayServerEventFrame = {
      type: "relay.server.event",
      connectionId,
      event,
      timestamp: Date.now(),
    };
    this.backendSocket.send(JSON.stringify(frame));
  }

  protected isHandleOpen(ws: WebSocket): boolean {
    const connectionId = this.handleConnectionIds.get(ws);
    return Boolean(
      connectionId &&
        this.connectionHandles.get(connectionId) === ws &&
        this.backendSocket &&
        this.backendSocket.readyState === WebSocket.OPEN &&
        this.backendReady,
    );
  }

  protected override onHeartbeatTick(): void {
    if (this.backendSocket?.readyState === WebSocket.OPEN) {
      this.backendSocket.ping();
    }
  }

  private connectBackend(): void {
    const relayCfg = this.config.relay;
    if (!relayCfg?.url || !relayCfg.channelId || !relayCfg.secret) {
      console.error("[generic] relay mode enabled but relay config is incomplete");
      return;
    }

    if (this.backendSocket?.readyState === WebSocket.OPEN || this.backendSocket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const ws = new WebSocket(relayCfg.url);
    this.backendSocket = ws;
    this.backendReady = false;

    const connectTimeoutMs = Math.max(1000, relayCfg.connectTimeoutMs ?? 10000);
    this.connectTimeout = setTimeout(() => {
      if (!this.backendReady) {
        console.error("[generic] relay backend connect timeout");
        ws.close();
      }
    }, connectTimeoutMs);

    ws.on("open", () => {
      const hello: RelayBackendHelloFrame = {
        type: "relay.backend.hello",
        channelId: relayCfg.channelId,
        secret: relayCfg.secret,
        instanceId: relayCfg.instanceId,
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(hello));
    });

    ws.on("message", (data: RawData) => {
      this.handleBackendFrame(data);
    });

    ws.on("close", () => {
      this.backendReady = false;
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }
      this.disconnectAllVirtualClients("relay backend disconnected");
      this.backendSocket = null;
      if (!this.stopped) {
        const reconnectIntervalMs = Math.max(1000, relayCfg.reconnectIntervalMs ?? 3000);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connectBackend();
        }, reconnectIntervalMs);
      }
    });

    ws.on("error", (err) => {
      console.error("[generic] relay backend error:", err);
    });
  }

  private handleBackendFrame(data: RawData): void {
    let frame: RelayFrame;
    try {
      frame = JSON.parse(data.toString()) as RelayFrame;
    } catch (error) {
      console.error("[generic] failed to parse relay frame:", error);
      return;
    }

    switch (frame.type) {
      case "relay.backend.ack":
        this.handleBackendAck(frame);
        break;
      case "relay.backend.error":
        this.handleBackendError(frame);
        break;
      case "relay.client.open":
        this.handleRelayClientOpen(frame);
        break;
      case "relay.client.close":
        this.handleRelayClientClose(frame);
        break;
      case "relay.client.event":
        this.handleRelayClientEvent(frame);
        break;
    }
  }

  private handleBackendAck(_frame: RelayBackendAckFrame): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    this.backendReady = true;
    console.log("[generic] relay backend connected");
  }

  private handleBackendError(frame: RelayBackendErrorFrame): void {
    console.error(`[generic] relay backend rejected connection: ${frame.message}`);
    this.backendSocket?.close();
  }

  private handleRelayClientOpen(frame: RelayClientOpenFrame): void {
    if (this.connectionHandles.has(frame.connectionId)) {
      this.handleRelayClientClose({
        type: "relay.client.close",
        connectionId: frame.connectionId,
        timestamp: Date.now(),
      });
    }

    const authResult: GenericConnectionAuthResult = frame.authUser
      ? {
          ok: true,
          query: {
            chatId: frame.query.chatId,
            agentId: frame.query.agentId,
            token: frame.query.token,
          },
          authUser: buildRelayTrustedAuthUser(frame.authUser),
        }
      : authenticateGenericConnection({
          config: this.config,
          url: buildRelayAuthUrl("/relay", frame.query),
        });

    if (isAuthFailure(authResult)) {
      this.sendRelayReject(frame.connectionId, authResult.code, authResult.message);
      return;
    }

    const ws = {} as WebSocket;
    const chatId = authResult.authUser?.chatId ?? authResult.query.chatId;
    const connectionLabel = authResult.authUser?.senderId ?? chatId ?? frame.connectionId;

    this.connectionHandles.set(frame.connectionId, ws);
    this.handleConnectionIds.set(ws, frame.connectionId);
    this.clientStates.set(ws, {
      connectionId: frame.connectionId,
      currentChatId: chatId,
      subscribedChatIds: new Set<string>(),
      selectedAgentId: authResult.query.agentId,
      authUser: authResult.authUser,
    });

    if (chatId) {
      this.subscribeClientToChat(ws, chatId);
    }

    this.sendDirect(ws, {
      type: "connection.open",
      data: {
        chatId,
        userId: authResult.authUser?.senderId,
        timestamp: Date.now(),
      },
    });

    this.onClientConnect?.({
      chatId,
      ws,
      userId: authResult.authUser?.senderId,
    });

    console.log(`[generic] Relay client connected: ${connectionLabel}`);
  }

  private handleRelayClientClose(frame: RelayClientCloseFrame): void {
    const ws = this.connectionHandles.get(frame.connectionId);
    if (!ws) {
      return;
    }

    const state = this.clientStates.get(ws);
    this.removeClientFromAllChats(ws);
    this.onClientDisconnect?.({
      chatId: state?.currentChatId,
      ws,
      userId: state?.authUser?.senderId,
    });
    this.clientStates.delete(ws);
    this.connectionHandles.delete(frame.connectionId);
    this.handleConnectionIds.delete(ws);
  }

  private handleRelayClientEvent(frame: RelayClientEventFrame): void {
    const ws = this.connectionHandles.get(frame.connectionId);
    if (!ws) {
      return;
    }

    const state = this.clientStates.get(ws);
    const sourceId = state?.authUser?.senderId ?? state?.currentChatId ?? frame.connectionId;
    this.handleParsedMessage(ws, sourceId, frame.event);
  }

  private sendRelayReject(connectionId: string, code: number, message: string): void {
    if (!this.backendSocket || this.backendSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    const frame: RelayServerRejectFrame = {
      type: "relay.server.reject",
      connectionId,
      code: toRelayCloseCode(code),
      message,
      timestamp: Date.now(),
    };
    this.backendSocket.send(JSON.stringify(frame));
  }

  private disconnectAllVirtualClients(reason: string): void {
    for (const [connectionId, ws] of this.connectionHandles.entries()) {
      const closeFrame: RelayServerCloseFrame = {
        type: "relay.server.close",
        connectionId,
        code: 1012,
        reason,
        timestamp: Date.now(),
      };
      if (this.backendSocket?.readyState === WebSocket.OPEN) {
        this.backendSocket.send(JSON.stringify(closeFrame));
      }
      this.handleRelayClientClose({
        type: "relay.client.close",
        connectionId,
        reason,
        timestamp: Date.now(),
      });
    }
  }
}

let clientManager: GenericClientManager | null = null;
let clientManagerMode: GenericChannelConfig["connectionMode"] | null = null;

export function createGenericWSManager(config: GenericChannelConfig): GenericClientManager {
  const targetMode = config.connectionMode ?? "websocket";
  if (!clientManager || clientManagerMode !== targetMode) {
    destroyGenericWSManager();
    clientManager =
      targetMode === "relay"
        ? new GenericRelayManager(config)
        : new GenericWSManager(config);
    clientManagerMode = targetMode;
  }
  return clientManager;
}

export function getGenericWSManager(): GenericClientManager | null {
  return clientManager;
}

export function destroyGenericWSManager(): void {
  if (clientManager) {
    clientManager.stop();
    clientManager = null;
    clientManagerMode = null;
  }
}
