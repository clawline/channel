import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { GenericChannelConfig } from "./types.js";
import { getGenericWSManager } from "./client.js";

export type GroupRole = "owner" | "admin" | "member";

export type GroupMember = {
  userId: string;
  userName?: string;
  role: GroupRole;
  joinedAt: number;
  invitedBy?: string;
};

export type GroupInfo = {
  groupId: string;
  groupName: string;
  description?: string;
  avatar?: string;
  createdBy: string;
  createdAt: number;
  members: Map<string, GroupMember>;
  settings: GroupSettings;
};

export type GroupSettings = {
  allowMemberInvites: boolean;
  allowMemberMessages: boolean;
  onlyAdminsCanEdit: boolean;
  maxMembers: number;
  isPublic: boolean;
};

export type GroupAction = {
  type:
    | "group.create"
    | "member.add"
    | "member.remove"
    | "member.promote"
    | "member.demote"
    | "group.update"
    | "group.delete"
    | "settings.update";
  groupId: string;
  actorId: string;
  targetUserId?: string;
  data?: unknown;
  timestamp: number;
};

// Store group information
const groups = new Map<string, GroupInfo>();
const userGroups = new Map<string, Set<string>>();

/**
 * Create a new group
 */
export function createGroup(params: {
  groupId: string;
  groupName: string;
  description?: string;
  avatar?: string;
  createdBy: string;
  settings?: Partial<GroupSettings>;
}): GroupInfo {
  const { groupId, groupName, description, avatar, createdBy, settings } = params;

  const defaultSettings: GroupSettings = {
    allowMemberInvites: false,
    allowMemberMessages: true,
    onlyAdminsCanEdit: true,
    maxMembers: 256,
    isPublic: false,
    ...settings,
  };

  const owner: GroupMember = {
    userId: createdBy,
    role: "owner",
    joinedAt: Date.now(),
  };

  const group: GroupInfo = {
    groupId,
    groupName,
    description,
    avatar,
    createdBy,
    createdAt: Date.now(),
    members: new Map([[createdBy, owner]]),
    settings: defaultSettings,
  };

  groups.set(groupId, group);

  // Index user groups
  if (!userGroups.has(createdBy)) {
    userGroups.set(createdBy, new Set());
  }
  userGroups.get(createdBy)!.add(groupId);

  return group;
}

/**
 * Add member to group
 */
export function addGroupMember(params: {
  groupId: string;
  userId: string;
  userName?: string;
  invitedBy: string;
  role?: GroupRole;
}): GroupMember | undefined {
  const { groupId, userId, userName, invitedBy, role = "member" } = params;

  const group = groups.get(groupId);
  if (!group) {
    return undefined;
  }

  // Check if group is full
  if (group.members.size >= group.settings.maxMembers) {
    throw new Error("Group is full");
  }

  // Check if user is already a member
  if (group.members.has(userId)) {
    return group.members.get(userId);
  }

  const member: GroupMember = {
    userId,
    userName,
    role,
    joinedAt: Date.now(),
    invitedBy,
  };

  group.members.set(userId, member);

  // Index user groups
  if (!userGroups.has(userId)) {
    userGroups.set(userId, new Set());
  }
  userGroups.get(userId)!.add(groupId);

  return member;
}

/**
 * Remove member from group
 */
export function removeGroupMember(params: { groupId: string; userId: string }): boolean {
  const { groupId, userId } = params;

  const group = groups.get(groupId);
  if (!group) {
    return false;
  }

  const member = group.members.get(userId);
  if (!member) {
    return false;
  }

  // Can't remove owner
  if (member.role === "owner") {
    throw new Error("Cannot remove group owner");
  }

  group.members.delete(userId);
  userGroups.get(userId)?.delete(groupId);

  return true;
}

/**
 * Change member role
 */
export function changeGroupMemberRole(params: {
  groupId: string;
  userId: string;
  newRole: GroupRole;
}): GroupMember | undefined {
  const { groupId, userId, newRole } = params;

  const group = groups.get(groupId);
  if (!group) {
    return undefined;
  }

  const member = group.members.get(userId);
  if (!member) {
    return undefined;
  }

  // Can't change owner role
  if (member.role === "owner" || newRole === "owner") {
    throw new Error("Cannot change owner role");
  }

  member.role = newRole;
  return member;
}

/**
 * Update group settings
 */
export function updateGroupSettings(params: {
  groupId: string;
  settings: Partial<GroupSettings>;
}): GroupInfo | undefined {
  const { groupId, settings } = params;

  const group = groups.get(groupId);
  if (!group) {
    return undefined;
  }

  group.settings = {
    ...group.settings,
    ...settings,
  };

  return group;
}

/**
 * Update group info
 */
export function updateGroupInfo(params: {
  groupId: string;
  groupName?: string;
  description?: string;
  avatar?: string;
}): GroupInfo | undefined {
  const { groupId, groupName, description, avatar } = params;

  const group = groups.get(groupId);
  if (!group) {
    return undefined;
  }

  if (groupName) {
    group.groupName = groupName;
  }
  if (description !== undefined) {
    group.description = description;
  }
  if (avatar !== undefined) {
    group.avatar = avatar;
  }

  return group;
}

/**
 * Get group info
 */
export function getGroupInfo(groupId: string): GroupInfo | undefined {
  return groups.get(groupId);
}

/**
 * Get user's groups
 */
export function getUserGroups(userId: string): GroupInfo[] {
  const groupIds = userGroups.get(userId);
  if (!groupIds) {
    return [];
  }

  const result: GroupInfo[] = [];
  for (const groupId of groupIds) {
    const group = groups.get(groupId);
    if (group) {
      result.push(group);
    }
  }

  return result;
}

/**
 * Check if user has admin privileges
 */
export function isGroupAdmin(params: { groupId: string; userId: string }): boolean {
  const { groupId, userId } = params;

  const group = groups.get(groupId);
  if (!group) {
    return false;
  }

  const member = group.members.get(userId);
  if (!member) {
    return false;
  }

  return member.role === "owner" || member.role === "admin";
}

/**
 * Broadcast group action to all members
 */
export function broadcastGroupAction(params: {
  cfg: OpenClawConfig;
  action: GroupAction;
}): void {
  const { cfg, action } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  if (!genericCfg || genericCfg.connectionMode !== "websocket") {
    return;
  }

  const wsManager = getGenericWSManager();
  if (wsManager) {
    wsManager.sendToClient(action.groupId, {
      type: "group.action",
      data: action,
    });
  }
}

/**
 * Handle group action request
 */
export async function handleGroupAction(params: {
  cfg: OpenClawConfig;
  action: GroupAction;
}): Promise<void> {
  const { cfg, action } = params;
  const { type, groupId, actorId, targetUserId } = action;

  if (type !== "group.create" && !isGroupAdmin({ groupId, userId: actorId })) {
    throw new Error("User does not have admin privileges");
  }

  switch (type) {
    case "group.create":
      createGroup({
        groupId,
        groupName: (action.data as { groupName?: string } | undefined)?.groupName || groupId,
        description: (action.data as { description?: string } | undefined)?.description,
        avatar: (action.data as { avatar?: string } | undefined)?.avatar,
        createdBy: actorId,
        settings: (action.data as { settings?: Partial<GroupSettings> } | undefined)?.settings,
      });
      break;

    case "member.add":
      if (targetUserId) {
        addGroupMember({
          groupId,
          userId: targetUserId,
          invitedBy: actorId,
        });
      }
      break;

    case "member.remove":
      if (targetUserId) {
        removeGroupMember({ groupId, userId: targetUserId });
      }
      break;

    case "member.promote":
      if (targetUserId) {
        changeGroupMemberRole({
          groupId,
          userId: targetUserId,
          newRole: "admin",
        });
      }
      break;

    case "member.demote":
      if (targetUserId) {
        changeGroupMemberRole({
          groupId,
          userId: targetUserId,
          newRole: "member",
        });
      }
      break;

    case "settings.update":
      if (action.data) {
        updateGroupSettings({
          groupId,
          settings: action.data as Partial<GroupSettings>,
        });
      }
      break;

    case "group.update":
      if (action.data) {
        const data = action.data as { groupName?: string; description?: string; avatar?: string };
        updateGroupInfo({
          groupId,
          ...data,
        });
      }
      break;

    case "group.delete":
      groups.delete(groupId);
      break;
  }

  // Broadcast action to all group members
  broadcastGroupAction({ cfg, action });
}
