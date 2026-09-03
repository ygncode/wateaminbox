import type { MessageEvent } from "../../lib/nats/index.js";

/** Metadata that must survive the worker → API → database boundary. */
export function buildIncomingMessageMetadata(
  payload: MessageEvent["payload"],
): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  if (payload.protocolSenderJid) {
    metadata.protocolSenderJid = payload.protocolSenderJid;
  }

  const albumId = payload.mediaAlbumId?.trim();
  if (albumId) {
    metadata.mediaAlbumId = albumId;
    if (
      Number.isInteger(payload.mediaAlbumIndex) &&
      (payload.mediaAlbumIndex ?? -1) >= 0
    ) {
      metadata.mediaAlbumIndex = payload.mediaAlbumIndex;
    }
    if (
      Number.isInteger(payload.mediaAlbumCount) &&
      (payload.mediaAlbumCount ?? 0) >= 2
    ) {
      metadata.mediaAlbumCount = payload.mediaAlbumCount;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}
