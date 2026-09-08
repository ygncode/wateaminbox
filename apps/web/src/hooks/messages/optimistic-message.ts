import type { Message } from "@wateaminbox/shared";
import { nowMs, toDbDate } from "@wateaminbox/shared";
import type { InfiniteMessagesData, SendMessageInput } from "./types";

/**
 * Prefix used for every optimistic-send placeholder id. The server-confirmed
 * message arrives under a uuid, so the two ids never match; reconciliation must
 * be keyed on this prefix rather than the ids themselves.
 */
export const OPTIMISTIC_ID_PREFIX = "optimistic-";

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
    id: `${OPTIMISTIC_ID_PREFIX}${nowMs()}`,
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

/**
 * Maximum clock skew tolerated between the optimistic placeholder's
 * client-stamped `createdAt` and the server-confirmed message's `createdAt`.
 * Generous enough to absorb slow networks; narrow enough to avoid collapsing
 * two legitimately identical sends separated by more than a brief burst.
 */
const OPTIMISTIC_RECONCILE_WINDOW_MS = 30_000;

/**
 * Convert a message `createdAt` to epoch milliseconds.
 *
 * The TS declaration says `Date`, but realtime `message:new` payloads are JSON
 * deserialized, so the confirmed message's `createdAt` is actually an ISO
 * string at runtime. Optimistic placeholders keep a real `Date` from
 * `toDbDate()`. `new Date()` parses both, so the conversion below is defensive
 * against the runtime/type mismatch.
 */
function toEpochMs(date: Date): number {
  return new Date(date as unknown as string).getTime();
}

/**
 * Determine whether an in-cache `candidate` is the optimistic placeholder for
 * a confirmed realtime echo of the same logical send.
 *
 * The optimistic id (`optimistic-<ms>`) never equals the server uuid, so an
 * id-only dedup cannot catch the confirmed echo. This matches on the prefix,
 * the same `senderId`, the same `content` and `messageType`, and a small
 * `createdAt` window, so {@link addMessageToCache} can replace the placeholder
 * in place rather than prepending a second row (which would briefly render the
 * same outbound send as two bubbles until a refetch or POST `onSuccess` closes
 * the gap).
 */
export function isOptimisticTwin(
  candidate: Message,
  confirmed: Message,
): boolean {
  if (!candidate.id.startsWith(OPTIMISTIC_ID_PREFIX)) return false;
  if (candidate.senderId !== confirmed.senderId) return false;
  if (candidate.content !== confirmed.content) return false;
  if (candidate.messageType !== confirmed.messageType) return false;
  const delta = Math.abs(
    toEpochMs(candidate.createdAt) - toEpochMs(confirmed.createdAt),
  );
  return delta < OPTIMISTIC_RECONCILE_WINDOW_MS;
}
