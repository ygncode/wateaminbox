import type { Message, RemoteHistoryStatus } from "@wateaminbox/shared";

export interface SendMessageInput {
  contactId: string;
  content: string;
  messageType?: "text" | "image" | "video" | "audio" | "document";
  mediaUrl?: string;
  replyToMessageId?: string;
}

export interface RetryMessageResponse {
  success: boolean;
  message: Message;
  originalMessageId: string;
}

export interface MediaDownloadResponse {
  status: "downloading" | "completed";
  mediaUrl?: string;
}

export interface ForwardMessageResponse {
  success: boolean;
  forwardedMessageId: string;
  autoAssigned: boolean;
}

export interface InfiniteMessagesData {
  pages: {
    messages: Message[];
    hasMore: boolean;
    nextCursor: string | null;
    remoteHistoryStatus: RemoteHistoryStatus;
  }[];
  pageParams: (string | undefined)[];
}
