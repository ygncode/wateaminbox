import { createHash } from "node:crypto";
import {
  assertNormalizedChannelEvent,
  type MessageUpsertEventPayload,
  type NormalizedChannelEvent,
  normalizeJid,
} from "@wateaminbox/shared";
import type { MessageEvent } from "../../../lib/nats/index.js";

export function normalizeLinkedDeviceMessageEvent(
  event: MessageEvent,
): Extract<NormalizedChannelEvent, { kind: "message.upsert" }> {
  const threadJid = requireNormalizedJid(
    event.payload.isGroup
      ? (event.payload.groupId ?? event.payload.from)
      : event.payload.fromMe
        ? event.payload.to
        : event.payload.from,
  );
  const senderJid = requireNormalizedJid(
    event.payload.protocolSenderJid ?? event.payload.from,
  );
  const occurredAt = new Date(event.payload.timestamp).toISOString();
  const receivedAt = new Date(event.timestamp).toISOString();
  const payload: MessageUpsertEventPayload = {
    conversation: {
      externalThreadId: threadJid,
      clientThreadKey: `linked-device:${threadJid}`,
      kind: event.payload.isGroup ? "group" : "direct",
    },
    externalMessageId: event.payload.messageId,
    externalIdentityScope: `linked-device-thread:${threadJid}`,
    direction: event.payload.fromMe ? "outbound" : "inbound",
    sender: event.payload.fromMe
      ? undefined
      : {
          externalId: senderJid,
          identityScope: `linked-device-account:${event.connectionId}`,
          endpointKind: "person",
          displayName: event.payload.senderName,
        },
    normalizedType: event.payload.messageType,
    textContent: event.payload.content || event.payload.caption || undefined,
    replyToExternalMessageId: event.payload.quotedMessageId,
    attachments: normalizeAttachments(event),
    providerMetadata: event.payload.mediaAlbumId
      ? {
          mediaAlbumId: event.payload.mediaAlbumId,
          mediaAlbumIndex: event.payload.mediaAlbumIndex,
          mediaAlbumCount: event.payload.mediaAlbumCount,
        }
      : undefined,
  };
  const normalized: Extract<
    NormalizedChannelEvent,
    { kind: "message.upsert" }
  > = {
    contractVersion: 1,
    eventId:
      event.eventId ??
      deterministicEventId(
        event.connectionId,
        event.type,
        event.payload.messageId,
        event.payload.timestamp,
      ),
    companyId: event.companyId,
    channelAccountId: event.connectionId,
    channel: "whatsapp",
    provider: "whatsapp_linked_device",
    kind: "message.upsert",
    providerOccurredAt: occurredAt,
    receivedAt,
    payload,
  };
  assertNormalizedChannelEvent(normalized);
  return normalized;
}

function normalizeAttachments(
  event: MessageEvent,
): MessageUpsertEventPayload["attachments"] {
  if (
    !event.payload.mediaUrl &&
    !event.payload.mediaDirectPath &&
    !event.payload.mediaType &&
    !event.payload.mediaKey
  ) {
    return undefined;
  }
  return [
    {
      ordinal: 0,
      kind: event.payload.messageType,
      fileName: event.payload.fileName,
      contentType: event.payload.mediaType,
      byteSize: event.payload.mediaSize,
      storageUri: event.payload.mediaUrl,
      status: event.payload.mediaUrl ? "available" : "pending",
    },
  ];
}

function requireNormalizedJid(value: string): string {
  const normalized = normalizeJid(value);
  if (!normalized) throw new Error("linked-device event has no valid JID");
  return normalized;
}

function deterministicEventId(...parts: string[]): string {
  return `linked-device:${createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")}`;
}
