import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { genericPlugin } from "./src/generic/channel.js";
import { setGenericRuntime } from "./src/generic/runtime.js";
import { broadcastToolCallEvent, type ToolCallHookEvent } from "./src/generic/tool-events.js";

// Generic channel exports
export { monitorGenericProvider } from "./src/generic/monitor.js";
export { sendMessageGeneric, sendMediaGeneric, sendThinkingIndicator } from "./src/generic/send.js";
export { probeGeneric } from "./src/generic/probe.js";
export { genericPlugin } from "./src/generic/channel.js";
export {
  downloadMediaFromUrl,
  resolveGenericMediaList,
  buildMediaPayload,
  inferMediaTypeFromMime,
  type MediaInfo,
} from "./src/generic/media.js";

// Advanced features exports
export {
  addReaction,
  removeReaction,
  getMessageReactions,
  broadcastReaction,
  handleReactionEvent,
  type MessageReaction,
  type ReactionEvent,
} from "./src/generic/reactions.js";

export {
  editMessage,
  deleteMessage,
  isMessageDeleted,
  getMessageEditHistory,
  broadcastMessageEdit,
  broadcastMessageDelete,
  handleMessageEdit,
  handleMessageDelete,
  type MessageEdit,
  type MessageDelete,
} from "./src/generic/message-management.js";

export {
  updateMessageStatus,
  markMessageAsRead,
  getMessageStatus,
  getReadReceipts,
  getOverallMessageStatus,
  broadcastStatusUpdate,
  handleStatusUpdate,
  type MessageStatus,
  type MessageStatusUpdate,
  type ReadReceipt,
} from "./src/generic/status.js";

export {
  startTyping,
  stopTyping,
  getTypingUsers,
  isUserTyping,
  broadcastTypingIndicator,
  handleTypingIndicator,
  type TypingIndicator,
} from "./src/generic/typing.js";

export {
  forwardMessage,
  forwardMultipleMessages,
  getForwardedMessages,
  broadcastForwardEvent,
  handleForwardRequest,
  type ForwardedMessage,
  type ForwardEvent,
} from "./src/generic/forwarding.js";

export {
  updateUserStatus,
  sendHeartbeat,
  getUserStatus,
  getOnlineUsers,
  getLastSeen,
  setUserOffline,
  broadcastUserStatus,
  handleUserStatusUpdate,
  handleUserConnect,
  handleUserDisconnect,
  type UserStatus,
  type UserPresence,
} from "./src/generic/presence.js";

export {
  initFileTransfer,
  updateFileTransferProgress,
  completeFileTransfer,
  failFileTransfer,
  getFileTransfer,
  getChatFileTransfers,
  broadcastFileProgress,
  broadcastFileTransfer,
  handleFileUpload,
  handleFileDownload,
  type FileTransfer,
  type FileTransferProgress,
} from "./src/generic/file-transfer.js";

export {
  indexMessage,
  removeMessageFromIndex,
  searchMessages,
  searchByContent,
  searchBySender,
  searchByDateRange,
  getMessageById,
  getRecentMessages,
  clearChatMessages,
  type SearchQuery,
  type SearchResult,
  type SearchResponse,
} from "./src/generic/search.js";

export {
  createGroup,
  addGroupMember,
  removeGroupMember,
  changeGroupMemberRole,
  updateGroupSettings,
  updateGroupInfo,
  getGroupInfo,
  getUserGroups,
  isGroupAdmin,
  broadcastGroupAction,
  handleGroupAction,
  type GroupRole,
  type GroupMember,
  type GroupInfo,
  type GroupSettings,
  type GroupAction,
} from "./src/generic/groups.js";

export {
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  isMessagePinned,
  starMessage,
  unstarMessage,
  getStarredMessages,
  isMessageStarred,
  getStarredCount,
  broadcastPinEvent,
  handlePinMessage,
  handleUnpinMessage,
  handleStarMessage,
  handleUnstarMessage,
  type PinnedMessage,
  type StarredMessage,
} from "./src/generic/pins-stars.js";

const plugin = {
  id: "clawline",
  name: "Clawline",
  description: "Generic WebSocket/Relay/Webhook channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setGenericRuntime(api.runtime);
    api.registerChannel({ plugin: genericPlugin });

    // Tool call events → broadcast to connected clients
    api.on("before_tool_call", (event: ToolCallHookEvent) => {
      broadcastToolCallEvent("tool.start", event);
    });
    api.on("after_tool_call", (event: ToolCallHookEvent) => {
      broadcastToolCallEvent("tool.end", event);
    });
  },
};

export default plugin;
