import type { WSEvent } from "./types.js";

export type RelayConnectionQuery = {
  rawQuery?: string;
  channelId?: string;
  chatId?: string;
  agentId?: string;
  token?: string;
};

export type RelayTrustedAuthUser = {
  id: string;
  senderId: string;
  chatId?: string;
  token: string;
  allowAgents?: string[];
};

export type RelayBackendHelloFrame = {
  type: "relay.backend.hello";
  channelId: string;
  secret: string;
  instanceId?: string;
  timestamp: number;
};

export type RelayBackendAckFrame = {
  type: "relay.backend.ack";
  channelId: string;
  timestamp: number;
};

export type RelayBackendErrorFrame = {
  type: "relay.backend.error";
  message: string;
  timestamp: number;
};

export type RelayClientOpenFrame = {
  type: "relay.client.open";
  connectionId: string;
  query: RelayConnectionQuery;
  authUser?: RelayTrustedAuthUser;
  timestamp: number;
};

export type RelayClientCloseFrame = {
  type: "relay.client.close";
  connectionId: string;
  code?: number;
  reason?: string;
  timestamp: number;
};

export type RelayClientEventFrame = {
  type: "relay.client.event";
  connectionId: string;
  event: WSEvent;
  timestamp: number;
};

export type RelayServerEventFrame = {
  type: "relay.server.event";
  connectionId: string;
  event: WSEvent;
  timestamp: number;
};

export type RelayServerRejectFrame = {
  type: "relay.server.reject";
  connectionId: string;
  code: number;
  message: string;
  timestamp: number;
};

export type RelayServerCloseFrame = {
  type: "relay.server.close";
  connectionId: string;
  code?: number;
  reason?: string;
  timestamp: number;
};

export type RelayFrame =
  | RelayBackendHelloFrame
  | RelayBackendAckFrame
  | RelayBackendErrorFrame
  | RelayClientOpenFrame
  | RelayClientCloseFrame
  | RelayClientEventFrame
  | RelayServerEventFrame
  | RelayServerRejectFrame
  | RelayServerCloseFrame;

export function buildRelayAuthUrl(url: string, query: RelayConnectionQuery): string {
  const seed = query.rawQuery ? `${url}${query.rawQuery.startsWith("?") ? query.rawQuery : `?${query.rawQuery}`}` : url;
  const parsed = new URL(seed, "ws://relay.local");
  if (query.chatId) {
    parsed.searchParams.set("chatId", query.chatId);
  }
  if (query.agentId) {
    parsed.searchParams.set("agentId", query.agentId);
  }
  if (query.token) {
    parsed.searchParams.set("token", query.token);
  }
  return `${parsed.pathname}${parsed.search}`;
}
