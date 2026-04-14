// Thread data types — shared between gateway and client-web

/** Thread status lifecycle */
export type ThreadStatus = "active" | "archived" | "locked" | "deleted";

/** Thread origin type */
export type ThreadType = "user" | "acp";

/** Thread metadata stored in cl_threads */
export interface Thread {
  id: string;
  channelId: string;
  parentMessageId: string;
  creatorId: string;
  title: string | null;
  status: ThreadStatus;
  type: ThreadType;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastReplyAt: string | null; // ISO 8601
  replyCount: number;
  participantIds: string[];
}

/** Per-user read position within a thread */
export interface ThreadReadStatus {
  userId: string;
  threadId: string;
  lastReadAt: string; // ISO 8601
  lastReadMessageId: string | null;
}

/** Payload for creating a new thread */
export interface ThreadCreatePayload {
  parentMessageId: string;
  title?: string;
}

/** Payload for updating thread metadata */
export interface ThreadUpdatePayload {
  title?: string;
  status?: ThreadStatus;
}

/** Filter/pagination params for listing threads in a channel */
export interface ThreadListFilter {
  channelId: string;
  status?: ThreadStatus | "all";
  participantId?: string;
  page: number;
  pageSize: number;
}

/** Response shape for thread list queries */
export interface ThreadListResponse {
  requestId?: string;
  threads: (Thread & { unreadCount: number })[];
  total: number;
}

/** Response shape for thread.get queries */
export interface ThreadGetResponse {
  requestId?: string;
  thread: Thread;
  unreadCount: number;
}

/** Broadcast payload when a thread is created or updated */
export interface ThreadUpdatedEvent {
  thread: Thread;
}

/** Broadcast payload when a new reply arrives in a thread */
export interface ThreadNewReplyEvent {
  threadId: string;
  messageId: string;
  senderId: string;
  preview: string;
}
