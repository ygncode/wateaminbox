type ForwardSourceMessage = {
  id: string;
  contact_id: string | null;
  from_me: boolean;
  sender_jid: string | null;
  message_type: string;
  metadata: Record<string, unknown> | null;
  deleted_by_sender: boolean;
  deleted_at: Date | null;
  timestamp: Date;
};

export type ForwardAlbumContext = {
  id: string;
  index: number;
  count: number;
  imageCount: number;
  videoCount: number;
};

export type ForwardBatchItem<T extends ForwardSourceMessage> = {
  source: T;
  mediaAlbum?: ForwardAlbumContext;
};

export class IncompleteForwardAlbumError extends Error {
  constructor() {
    super("The complete media collection is not available to forward");
    this.name = "IncompleteForwardAlbumError";
  }
}

function albumId(message: ForwardSourceMessage): string | null {
  if (message.message_type !== "image" && message.message_type !== "video") {
    return null;
  }
  const value = message.metadata?.mediaAlbumId;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function albumInteger(
  message: ForwardSourceMessage,
  key: "mediaAlbumIndex" | "mediaAlbumCount",
): number | null {
  const value = message.metadata?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export function createForwardAlbumId(
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(9)),
): string {
  if (bytes.length !== 9) throw new Error("Album IDs require 9 random bytes");
  return `3EB0${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/**
 * Turn a clicked message into the complete outbound forwarding batch.
 *
 * A gallery is rendered as one bubble but stored as one row per media child.
 * WhatsApp also requires a fresh parent ID at the destination, so forwarding
 * cannot reuse either the clicked row alone or the source album parent.
 */
export function planForwardBatch<T extends ForwardSourceMessage>(
  original: T,
  albumCandidates: readonly T[],
  makeAlbumId: () => string = createForwardAlbumId,
): ForwardBatchItem<T>[] {
  const sourceAlbumId = albumId(original);
  if (!sourceAlbumId) return [{ source: original }];

  const messages = albumCandidates
    .filter(
      (candidate) =>
        candidate.contact_id === original.contact_id &&
        candidate.from_me === original.from_me &&
        candidate.sender_jid === original.sender_jid &&
        !candidate.deleted_by_sender &&
        candidate.deleted_at === null &&
        albumId(candidate) === sourceAlbumId,
    )
    .map((message, position) => ({ message, position }))
    .sort((left, right) => {
      const leftIndex =
        albumInteger(left.message, "mediaAlbumIndex") ??
        Number.MAX_SAFE_INTEGER;
      const rightIndex =
        albumInteger(right.message, "mediaAlbumIndex") ??
        Number.MAX_SAFE_INTEGER;
      return (
        leftIndex - rightIndex ||
        left.message.timestamp.getTime() - right.message.timestamp.getTime() ||
        left.position - right.position
      );
    })
    .map(({ message }) => message);

  const expectedCount = Math.max(
    albumInteger(original, "mediaAlbumCount") ?? 0,
    ...messages.map((message) => albumInteger(message, "mediaAlbumCount") ?? 0),
  );
  if (expectedCount > messages.length || messages.length > 30) {
    throw new IncompleteForwardAlbumError();
  }
  if (messages.length < 2) return [{ source: original }];

  const imageCount = messages.filter(
    (message) => message.message_type === "image",
  ).length;
  const videoCount = messages.length - imageCount;
  const destinationAlbumId = makeAlbumId();

  return messages.map((source, index) => ({
    source,
    mediaAlbum: {
      id: destinationAlbumId,
      index,
      count: messages.length,
      imageCount,
      videoCount,
    },
  }));
}
