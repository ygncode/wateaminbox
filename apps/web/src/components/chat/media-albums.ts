import type { Message } from "@wateaminbox/shared";
import { getMessageAuthorKey } from "./message-grouping";

/** Conservative fallback for albums received before protocol metadata existed. */
export const INFERRED_ALBUM_GAP_MS = 1500;

export interface MediaAlbumGroup {
  id: string;
  primary: Message;
  messages: Message[];
  expectedCount: number;
}

function isAlbumMedia(message: Message): boolean {
  return (
    !message.isDeleted &&
    (message.messageType === "image" || message.messageType === "video")
  );
}

function explicitAlbumKey(message: Message): string | null {
  const albumId = message.metadata?.mediaAlbumId?.trim();
  if (!albumId) return null;
  return `${message.conversationId}:${getMessageAuthorKey(message)}:${albumId}`;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function canInferSameAlbum(previous: Message, next: Message): boolean {
  if (!isAlbumMedia(next) || explicitAlbumKey(next)) return false;
  if (getMessageAuthorKey(previous) !== getMessageAuthorKey(next)) return false;

  const previousTime = timestamp(previous.createdAt);
  const nextTime = timestamp(next.createdAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime))
    return false;
  const gap = nextTime - previousTime;
  return gap >= 0 && gap <= INFERRED_ALBUM_GAP_MS;
}

function albumIndex(message: Message): number {
  const value = message.metadata?.mediaAlbumIndex;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}

function choosePrimary(messages: Message[]): Message {
  return (
    messages.find((message) => message.content.trim().length > 0) ?? messages[0]
  );
}

function buildGroup(
  messages: Message[],
  explicitKey: string | null,
): MediaAlbumGroup {
  const ordered = explicitKey
    ? messages
        .map((message, position) => ({ message, position }))
        .sort(
          (left, right) =>
            albumIndex(left.message) - albumIndex(right.message) ||
            left.position - right.position,
        )
        .map(({ message }) => message)
    : messages;
  const expectedCount = Math.max(
    ordered.length,
    ...ordered.map((message) => message.metadata?.mediaAlbumCount ?? 0),
  );
  return {
    id:
      ordered.length > 1
        ? `album:${explicitKey ?? ordered.map((message) => message.id).join(":")}`
        : ordered[0].id,
    primary: choosePrimary(ordered),
    messages: ordered,
    expectedCount,
  };
}

/**
 * Collapse consecutive WhatsApp image/video children into one render row.
 * Exact protocol IDs win; a narrow same-author time window keeps older rows
 * album-like even when they were stored before the association was preserved.
 */
export function groupMediaAlbumMessages(
  messages: Message[],
): MediaAlbumGroup[] {
  const groups: MediaAlbumGroup[] = [];
  let index = 0;

  while (index < messages.length) {
    const first = messages[index];
    if (!isAlbumMedia(first)) {
      groups.push(buildGroup([first], null));
      index += 1;
      continue;
    }

    const exactKey = explicitAlbumKey(first);
    const albumMessages = [first];
    let cursor = index + 1;
    while (cursor < messages.length) {
      const candidate = messages[cursor];
      const belongs = exactKey
        ? isAlbumMedia(candidate) && explicitAlbumKey(candidate) === exactKey
        : canInferSameAlbum(albumMessages[albumMessages.length - 1], candidate);
      if (!belongs) break;
      albumMessages.push(candidate);
      cursor += 1;
    }

    groups.push(buildGroup(albumMessages, exactKey));
    index = cursor;
  }

  return groups;
}
