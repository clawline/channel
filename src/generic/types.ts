import type { GenericChannelConfigSchema } from "./config-schema.js";
import type { z } from "zod";

export type GenericChannelConfig = z.infer<typeof GenericChannelConfigSchema>;

export type GenericConnectionMode = "websocket" | "webhook" | "relay";

export type ResolvedGenericAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
};

// Inbound message (H5 → Server)
export type InboundMessage = {
  messageId: string;
  chatId: string;
  chatType: "direct" | "group";
  senderId: string;
  senderName?: string;
  agentId?: string;
  messageType: "text" | "image" | "voice" | "audio" | "file";
  content: string;
  // Media URL for image/voice/audio messages
  mediaUrl?: string;
  // MIME type for media content
  mimeType?: string;
  timestamp: number;
  parentId?: string;
};

// Outbound message (Server → H5)
export type OutboundMessageMeta = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  durationMs?: number;
};

export type OutboundMessage = {
  messageId: string;
  chatId: string;
  content: string;
  contentType: "text" | "markdown" | "image" | "voice" | "audio";
  // Media URL for image/voice/audio messages
  mediaUrl?: string;
  // MIME type for media content
  mimeType?: string;
  replyTo?: string;
  timestamp: number;
  /** Agent that produced this message (for client-side isolation) */
  agentId?: string;
  meta?: OutboundMessageMeta;
};

export type GenericMessageContext = {
  chatId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  chatType: "direct" | "group";
  content: string;
  contentType: InboundMessage["messageType"];
  // Media URL for image/voice/audio messages
  mediaUrl?: string;
  // MIME type for media content
  mimeType?: string;
  parentId?: string;
};

export type GenericSendResult = {
  messageId: string;
  chatId: string;
};

export type GenericProbeResult = {
  ok: boolean;
  error?: string;
  mode?: GenericConnectionMode;
  port?: number;
  relayUrl?: string;
};

export type ChannelStatusRequest = {
  requestId?: string;
  includeChats?: boolean;
};

export type ChannelStatusResponse = {
  requestId?: string;
  channel: "clawline";
  configured: boolean;
  enabled: boolean;
  running: boolean;
  mode: GenericConnectionMode;
  port: number;
  path?: string;
  currentChatId: string;
  currentChatConnectionCount: number;
  connectedChatCount: number;
  connectedSocketCount: number;
  connectedChats?: string[];
  timestamp: number;
};

export type HistoryRequest = {
  requestId?: string;
  chatId: string;
  limit?: number;
  before?: number;
  agentId?: string;
};

export type AgentListRequest = {
  requestId?: string;
};

export type AgentListItem = {
  id: string;
  name: string;
  isDefault: boolean;
  identityName?: string;
  identityEmoji?: string;
  model?: string;
  description?: string;
  skills?: string[];
  status?: "online" | "idle" | "busy";
};

export type AgentListResponse = {
  requestId?: string;
  agents: AgentListItem[];
  defaultAgentId: string;
  selectedAgentId?: string;
  timestamp: number;
};

export type AgentContextRequest = {
  requestId?: string;
  agentId: string;
};

export type AgentContextFile = {
  name: string;
  content: string;
  updatedAt?: number;
};

export type AgentContextResponse = {
  requestId?: string;
  agentId: string;
  files: AgentContextFile[];
  timestamp: number;
};

export type AgentSelectRequest = {
  requestId?: string;
  agentId?: string | null;
};

export type AgentSelectedResponse = {
  requestId?: string;
  ok: boolean;
  mode: "auto" | "explicit";
  selectedAgentId?: string;
  error?: string;
  timestamp: number;
};

export type ConversationListRequest = {
  requestId?: string;
  agentId?: string;
  chatType?: "direct" | "group";
  limit?: number;
};

export type ConversationSummary = {
  chatId: string;
  chatType: "direct" | "group";
  title?: string;
  lastMessageId?: string;
  lastContent?: string;
  lastContentType?: InboundMessage["messageType"] | OutboundMessage["contentType"];
  lastDirection?: "sent" | "received";
  lastTimestamp: number;
  lastSenderId?: string;
  lastSenderName?: string;
  participantIds?: string[];
  agentIds?: string[];
};

export type ConversationListResponse = {
  requestId?: string;
  conversations: ConversationSummary[];
  timestamp: number;
};

// WebSocket event types
export type WSEventType =
  | "message.receive"
  | "message.send"
  | "history.get"
  | "agent.list.get"
  | "agent.list"
  | "agent.context.get"
  | "agent.context"
  | "agent.select"
  | "agent.selected"
  | "conversation.list.get"
  | "conversation.list"
  | "channel.status.get"
  | "channel.status"
  | "history.sync"
  | "message.edit"
  | "message.delete"
  | "message.forward"
  | "message.pin"
  | "message.unpin"
  | "connection.open"
  | "connection.close"
  | "typing"
  | "thinking.start"
  | "thinking.update"
  | "thinking.end"
  | "text.delta"
  | "stream.resume"
  | "reaction.add"
  | "reaction.remove"
  | "status.sent"
  | "status.read"
  | "status.delivered"
  | "status.failed"
  | "user.status"
  | "file.progress"
  | "file.transfer"
  | "group.action"
  | "suggestion.get"
  | "suggestion.response"
  | "tool.start"
  | "tool.end";

export type WSEvent = {
  type: WSEventType;
  data: unknown;
};
