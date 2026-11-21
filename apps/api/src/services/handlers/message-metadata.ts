import type { MessageEvent } from "../../lib/nats/index.js";

/** Metadata that must survive the worker → API → database boundary. */
export function buildIncomingMessageMetadata(
  payload: MessageEvent["payload"],
): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  if (payload.protocolSenderJid) {
    metadata.protocolSenderJid = payload.protocolSenderJid;
  }

  const groupMentions = payload.groupMentions?.filter(
    (mention) =>
      /^\d+(?:-\d+)?@g\.us$/.test(mention.jid) &&
      typeof mention.subject === "string",
  );
  if (groupMentions?.length) metadata.groupMentions = groupMentions;

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

  const quotedSnapshot = normalizeQuotedSnapshot(payload);
  if (quotedSnapshot) metadata.quotedSnapshot = quotedSnapshot;

  return Object.keys(metadata).length > 0 ? metadata : null;
}

const QUOTED_TYPES = new Set([
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contact",
]);
const MAX_QUOTED_CONTENT = 1024;

/**
 * WhatsApp's copy of the message a reply quotes, kept so the reply can show
 * its quote when the original was never synced. Validated here because it
 * crosses the worker boundary: only a known type, bounded text and a WhatsApp
 * JID survive.
 */
function normalizeQuotedSnapshot(
  payload: MessageEvent["payload"],
): { senderJid?: string; messageType: string; content: string } | null {
  const quoted = payload.quotedMessage;
  if (!payload.quotedMessageId || !quoted) return null;
  if (typeof quoted.messageType !== "string") return null;
  if (!QUOTED_TYPES.has(quoted.messageType)) return null;
  const content =
    typeof quoted.content === "string"
      ? quoted.content.trim().slice(0, MAX_QUOTED_CONTENT)
      : "";
  const senderJid =
    typeof quoted.senderJid === "string" &&
    /^[^\s@]+@(s\.whatsapp\.net|lid)$/.test(quoted.senderJid)
      ? quoted.senderJid
      : undefined;
  return {
    ...(senderJid ? { senderJid } : {}),
    messageType: quoted.messageType,
    content,
  };
}
