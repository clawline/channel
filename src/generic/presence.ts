import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type UserStatus = "online" | "offline" | "away" | "busy";

export type UserPresence = {
  userId: string;
  userName?: string;
  status: UserStatus;
  lastSeen?: number;
  statusMessage?: string;
  timestamp: number;
};

// Store user presence information
const userPresence = new Map<string, UserPresence>();
const userHeartbeats = new Map<string, NodeJS.Timeout>();

/**
 * Update user status
 */
export function updateUserStatus(params: {
  userId: string;
  userName?: string;
  status: UserStatus;
  statusMessage?: string;
  cfg?: OpenClawConfig;
}): UserPresence {
  const { userId, userName, status, statusMessage, cfg } = params;

  const presence: UserPresence = {
    userId,
    userName,
    status,
    lastSeen: status === "offline" ? Date.now() : undefined,
    statusMessage,
    timestamp: Date.now(),
  };

  userPresence.set(userId, presence);

  // Clear existing heartbeat
  const existingHeartbeat = userHeartbeats.get(userId);
  if (existingHeartbeat) {
    clearTimeout(existingHeartbeat);
    userHeartbeats.delete(userId);
  }

  // If user is online, set up heartbeat timeout
  if (status === "online") {
    const heartbeat = setTimeout(() => {
      // Auto-set to offline after 30 seconds of inactivity and notify listeners.
      const offlinePresence = updateUserStatus({
        userId,
        userName,
        status: "offline",
      });

      if (cfg) {
        broadcastUserStatus({
          cfg,
          presence: offlinePresence,
        });
      }
    }, 30000);

    userHeartbeats.set(userId, heartbeat);
  }

  return presence;
}

/**
 * Send heartbeat to keep user online
 */
export function sendHeartbeat(params: { userId: string; userName?: string }): UserPresence {
  const { userId, userName } = params;

  const currentPresence = userPresence.get(userId);

  return updateUserStatus({
    userId,
    userName: userName || currentPresence?.userName,
    status: currentPresence?.status || "online",
    statusMessage: currentPresence?.statusMessage,
  });
}

/**
 * Get user status
 */
export function getUserStatus(userId: string): UserPresence | undefined {
  return userPresence.get(userId);
}

/**
 * Get all online users
 */
export function getOnlineUsers(): UserPresence[] {
  const online: UserPresence[] = [];

  for (const presence of userPresence.values()) {
    if (presence.status === "online") {
      online.push(presence);
    }
  }

  return online;
}

/**
 * Get last seen time for a user
 */
export function getLastSeen(userId: string): number | undefined {
  const presence = userPresence.get(userId);

  if (!presence) {
    return undefined;
  }

  if (presence.status === "online") {
    return Date.now();
  }

  return presence.lastSeen;
}

/**
 * Set user to offline
 */
export function setUserOffline(params: { userId: string; userName?: string }): UserPresence {
  const { userId, userName } = params;

  // Clear heartbeat
  const heartbeat = userHeartbeats.get(userId);
  if (heartbeat) {
    clearTimeout(heartbeat);
    userHeartbeats.delete(userId);
  }

  const currentPresence = userPresence.get(userId);

  return updateUserStatus({
    userId,
    userName: userName || currentPresence?.userName,
    status: "offline",
  });
}

/**
 * Broadcast user status to all connected clients
 */
export function broadcastUserStatus(params: {
  cfg: OpenClawConfig;
  presence: UserPresence;
  targetChatId?: string;
}): void {
  const { cfg, presence, targetChatId } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    if (targetChatId) {
      wsManager.sendToClient(targetChatId, {
        type: "user.status",
        data: presence,
      });
    } else {
      // Broadcast to all connected clients
      wsManager.broadcast({
        type: "user.status",
        data: presence,
      });
    }
  }
}

/**
 * Handle incoming status update from client
 */
export async function handleUserStatusUpdate(params: {
  cfg: OpenClawConfig;
  status: UserPresence;
}): Promise<void> {
  const { cfg, status } = params;

  const updated = updateUserStatus({
    ...status,
    cfg,
  });

  // Broadcast to all connected clients
  broadcastUserStatus({
    cfg,
    presence: updated,
  });
}

/**
 * Handle user connection (set to online)
 */
export function handleUserConnect(params: {
  cfg: OpenClawConfig;
  userId: string;
  userName?: string;
}): void {
  const { cfg, userId, userName } = params;

  const presence = updateUserStatus({
    userId,
    userName,
    status: "online",
    cfg,
  });

  broadcastUserStatus({
    cfg,
    presence,
  });
}

/**
 * Handle user disconnection (set to offline)
 */
export function handleUserDisconnect(params: {
  cfg: OpenClawConfig;
  userId: string;
  userName?: string;
}): void {
  const { cfg, userId, userName } = params;

  const presence = setUserOffline({
    userId,
    userName,
  });

  broadcastUserStatus({
    cfg,
    presence,
  });
}
