import type { Message } from "@wateaminbox/shared";
import { nowMs, toDbDate } from "@wateaminbox/shared";
import type { InfiniteMessagesData, SendMessageInput } from "./types";

export function createOptimisticMessage(
  input: SendMessageInput,
  sender?: {
    id: string;
    name: string;
    avatarUrl?: string;
    gravatarUrl?: string;
  },
): Message {
  const now = toDbDate();
  return {
    id: `optimistic-${nowMs()}`,
    conversationId: input.contactId,
    senderId: sender?.id || "current-user",
    senderType: "user",
    sentByUserId: sender?.id,
    sentByUserName: sender?.name,
    sentByUserAvatarUrl: sender?.avatarUrl,
    sentByUserGravatarUrl: sender?.gravatarUrl,
    messageType: input.messageType || "text",
    content: input.content,
    metadata: input.mediaUrl
      ? {
          mediaUrl: input.mediaUrl,
          mediaAlbumId: input.mediaAlbum?.id,
          mediaAlbumIndex: input.mediaAlbum?.index,
          mediaAlbumCount: input.mediaAlbum?.count,
        }
      : undefined,
    replyToMessageId: input.replyToMessageId,
    isStarred: false,
    isDeleted: false,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

export function prependOptimisticMessage(
  data: InfiniteMessagesData | undefined,
  message: Message,
): InfiniteMessagesData | undefined {
  if (!data || data.pages.length === 0) return data;
  const pages = [...data.pages];
  pages[0] = {
    ...pages[0],
    messages: [message, ...pages[0].messages],
  };
  return { ...data, pages };
}

export function reconcileOptimisticMessage(
  data: InfiniteMessagesData | undefined,
  optimisticId: string,
  confirmed: Message,
): InfiniteMessagesData | undefined {
  if (!data) return data;
  const confirmationAlreadyArrived = data.pages.some((page) =>
    page.messages.some((message) => message.id === confirmed.id),
  );

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: confirmationAlreadyArrived
        ? page.messages.filter((message) => message.id !== optimisticId)
        : page.messages.map((message) =>
            message.id === optimisticId ? confirmed : message,
          ),
    })),
  };
}
