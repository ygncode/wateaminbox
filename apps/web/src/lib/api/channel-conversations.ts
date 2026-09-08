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
  legacyContactId: string | null;
  account: {
    displayName: string | null;
    status: string;
  };
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

export function getChannelMessages(
  conversationId: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<ChannelMessagesPage> {
  return api.get<ChannelMessagesPage>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${buildQueryString(params)}`,
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
