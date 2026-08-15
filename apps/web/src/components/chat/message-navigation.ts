import type { Message } from "@wateaminbox/shared";

export type MessageNavigationTarget =
  | { kind: "database"; messageId: string }
  | { kind: "reference"; messageId: string };

/**
 * A resolved quote always carries the local database ID. An unresolved quote
 * only carries the WhatsApp stanza ID (apart from a short optimistic-send
 * window where it may still be a database ID), so reference targets match
 * either identity.
 */
export function getReplyNavigationTarget(
  replyToMessage: Message["replyToMessage"],
  replyToMessageId: string | undefined,
): MessageNavigationTarget | null {
  if (replyToMessage?.isDeleted) return null;
  if (replyToMessage) {
    return { kind: "database", messageId: replyToMessage.id };
  }
  if (replyToMessageId) {
    return { kind: "reference", messageId: replyToMessageId };
  }
  return null;
}

export function matchesMessageNavigationTarget(
  message: Pick<Message, "id" | "whatsappMessageId">,
  target: MessageNavigationTarget,
): boolean {
  if (message.id === target.messageId) return true;
  return (
    target.kind === "reference" &&
    message.whatsappMessageId === target.messageId
  );
}

export function resolveMessageNavigationTarget(
  messages: Message[],
  target: MessageNavigationTarget | null,
): Message | undefined {
  if (!target) return undefined;
  return messages.find((message) =>
    matchesMessageNavigationTarget(message, target),
  );
}
