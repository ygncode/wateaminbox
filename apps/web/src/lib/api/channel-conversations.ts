import type { Channel, ChannelProvider } from "@wateaminbox/shared";
import { api, buildQueryString, fetchApi } from "./client";

export interface ChannelConversation {
  id: string;
  channelAccountId: string;
  channel: Channel;
  provider: ChannelProvider;
  kind: "direct" | "group" | "thread";
  subject: string | null;
  externalThreadId: string | null;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  conversationStatus: "open" | "pending" | "resolved";
  legacyContactId: string | null;
  account: {
    displayName: string | null;
    status: string;
  };
  /**
   * The other party, when the provider discloses one. Telegram supplies a
   * username only if the person set one, and never a phone number.
   */
  counterpart?: {
    displayName: string | null;
    addressDisplay: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface ChannelMessageAttachment {
  id: string;
  ordinal: number;
  kind: string;
  fileName: string | null;
  contentType: string | null;
  byteSize: string | null;
  status: "pending" | "available" | "failed" | "deleted";
  errorCode: string | null;
}

/** Normalized message shape returned for channel-neutral conversations. */
export interface ChannelMessage {
  id: string;
  channelAccountId: string;
  conversationId: string;
  externalMessageId: string | null;
  direction: "inbound" | "outbound" | "system";
  messageType: string;
  subject: string | null;
  textContent: string | null;
  sanitizedHtmlContent: string | null;
  replyToMessageId: string | null;
  sentByUserId: string | null;
  status: string;
  providerOccurredAt: string | null;
  timestamp: string;
  createdAt: string;
  attachments: ChannelMessageAttachment[];
}

export interface ChannelMessagesPage {
  messages: ChannelMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  providerStatus: string | null;
}

export function getChannelConversations(
  params: { limit?: number } = {},
): Promise<ChannelConversation[]> {
  return api.get<ChannelConversation[]>(
    `/conversations${buildQueryString(params)}`,
  );
}

export function getChannelConversation(
  conversationId: string,
): Promise<ChannelConversation> {
  return api.get<ChannelConversation>(
    `/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export function getChannelMessages(
  conversationId: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<ChannelMessagesPage> {
  return api.get<ChannelMessagesPage>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${buildQueryString(params)}`,
  );
}

export interface ConversationNote {
  id: string;
  conversationId: string;
  authorUserId: string;
  authorName: string | null;
  visibility: "shared" | "private";
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTag {
  id: string;
  name: string;
  color: string | null;
}

export function getConversationNotes(
  conversationId: string,
): Promise<ConversationNote[]> {
  return api.get<ConversationNote[]>(
    `/conversations/${encodeURIComponent(conversationId)}/notes`,
  );
}

export function createConversationNote(
  conversationId: string,
  body: { content: string; visibility: "shared" | "private" },
): Promise<unknown> {
  return api.post(
    `/conversations/${encodeURIComponent(conversationId)}/notes`,
    body,
  );
}

export function updateConversationNote(
  conversationId: string,
  noteId: string,
  content: string,
): Promise<unknown> {
  return api.patch(
    `/conversations/${encodeURIComponent(conversationId)}/notes/${encodeURIComponent(noteId)}`,
    { content },
  );
}

export function deleteConversationNote(
  conversationId: string,
  noteId: string,
): Promise<unknown> {
  return api.delete(
    `/conversations/${encodeURIComponent(conversationId)}/notes/${encodeURIComponent(noteId)}`,
  );
}

export function getConversationTags(
  conversationId: string,
): Promise<ConversationTag[]> {
  return api.get<ConversationTag[]>(
    `/conversations/${encodeURIComponent(conversationId)}/tags`,
  );
}

export function addConversationTag(
  conversationId: string,
  tagId: string,
): Promise<unknown> {
  return api.post(`/conversations/${encodeURIComponent(conversationId)}/tags`, {
    tagId,
  });
}

export function removeConversationTag(
  conversationId: string,
  tagId: string,
): Promise<unknown> {
  return api.delete(
    `/conversations/${encodeURIComponent(conversationId)}/tags/${encodeURIComponent(tagId)}`,
  );
}

export function getConversationAssignment(conversationId: string) {
  return api.get<{
    id: string;
    assigned_to: string;
    assigned_by: string;
    assigned_at: string;
  } | null>(`/conversations/${encodeURIComponent(conversationId)}/assignment`);
}

export function assignConversation(
  conversationId: string,
  targetUserId?: string,
): Promise<unknown> {
  return api.post(
    `/conversations/${encodeURIComponent(conversationId)}/assign`,
    {
      ...(targetUserId ? { targetUserId } : {}),
    },
  );
}

export function unassignConversation(conversationId: string): Promise<unknown> {
  return api.delete(
    `/conversations/${encodeURIComponent(conversationId)}/assign`,
  );
}

export function sendChannelMessage(
  conversationId: string,
  body: {
    content?: string;
    messageType?: string;
    mediaUrl?: string;
    replyToMessageId?: string;
  },
): Promise<{ messageId: string; intentStatus: string }> {
  return fetchApi(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    },
  );
}
