import type { Message } from "@wateaminbox/shared";
import { nowMs, toDbDate } from "@wateaminbox/shared";
import type { InfiniteMessagesData, SendMessageInput } from "./types";

export function createOptimisticMessage(input: SendMessageInput): Message {
  const now = toDbDate();
  return {
    id: `optimistic-${nowMs()}`,
    conversationId: input.contactId,
    senderId: "current-user",
    senderType: "user",
    messageType: input.messageType || "text",
    content: input.content,
    metadata: input.mediaUrl ? { mediaUrl: input.mediaUrl } : undefined,
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
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((message) =>
        message.id === optimisticId ? confirmed : message,
      ),
    })),
  };
}
