import { normalizeJid } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "../services/tenant.service.js";
import type { MessageDbRow, QuotedMessageData } from "./message-formatters.js";

/**
 * WhatsApp's own copy of the quoted message, stored on the reply as
 * `metadata.quotedSnapshot` by the inbound handler. It is the last resort for
 * showing a quote: a stored original (or album) always wins, because only a
 * real row can be navigated to and kept current (edits, deletions).
 */
export interface QuotedSnapshot {
  senderJid?: string;
  messageType: string;
  content: string;
}

type SnapshotReply = Pick<
  MessageDbRow,
  "metadata" | "quoted_message_id" | "whatsapp_connection_id"
>;

export function readQuotedSnapshot(
  message: SnapshotReply,
): QuotedSnapshot | null {
  if (!message.quoted_message_id) return null;
  const raw = message.metadata?.quotedSnapshot;
  if (!raw || typeof raw !== "object") return null;
  const snapshot = raw as Record<string, unknown>;
  if (typeof snapshot.messageType !== "string") return null;
  return {
    messageType: snapshot.messageType,
    content: typeof snapshot.content === "string" ? snapshot.content : "",
    ...(typeof snapshot.senderJid === "string"
      ? { senderJid: snapshot.senderJid }
      : {}),
  };
}

export interface SnapshotSenders {
  /** `${connectionId}|${jid}` -> display name */
  names: Map<string, string>;
  /** connection id -> the connected account's own JID */
  ownJids: Map<string, string>;
}

const senderKey = (connectionId: string, jid: string) =>
  `${connectionId}|${jid}`;

/**
 * Names for the authors of the snapshots on a page, from this connection's
 * contacts and the names their own messages carried. One query each, only for
 * replies that actually fall back to a snapshot.
 */
export async function loadSnapshotSenders(
  tenantDb: Kysely<TenantDatabase>,
  replies: readonly SnapshotReply[],
): Promise<SnapshotSenders> {
  const result: SnapshotSenders = { names: new Map(), ownJids: new Map() };
  const wanted = new Map<string, Set<string>>();
  for (const reply of replies) {
    const jid = normalizeJid(readQuotedSnapshot(reply)?.senderJid ?? null);
    if (!jid || !reply.whatsapp_connection_id) continue;
    const set = wanted.get(reply.whatsapp_connection_id) ?? new Set<string>();
    set.add(jid);
    wanted.set(reply.whatsapp_connection_id, set);
  }
  if (wanted.size === 0) return result;

  const connectionIds = [...wanted.keys()];
  const jids = [...new Set([...wanted.values()].flatMap((set) => [...set]))];
  const [connections, contacts, senders] = await Promise.all([
    tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "jid"])
      .where("id", "in", connectionIds)
      .execute(),
    tenantDb
      .selectFrom("contacts")
      .select(["whatsapp_connection_id", "jid", "custom_name", "push_name"])
      .where("whatsapp_connection_id", "in", connectionIds)
      .where("jid", "in", jids)
      .execute(),
    tenantDb
      .selectFrom("messages")
      .select(["whatsapp_connection_id", "sender_jid", "sender_name"])
      .distinctOn(["whatsapp_connection_id", "sender_jid"])
      .where("whatsapp_connection_id", "in", connectionIds)
      .where("sender_jid", "in", jids)
      .where("sender_name", "is not", null)
      .orderBy("whatsapp_connection_id")
      .orderBy("sender_jid")
      .orderBy("timestamp", "desc")
      .execute(),
  ]);

  for (const connection of connections) {
    const own = normalizeJid(connection.jid);
    if (own) result.ownJids.set(connection.id, own);
  }
  for (const sender of senders) {
    const name = sender.sender_name?.trim();
    if (name && sender.whatsapp_connection_id && sender.sender_jid) {
      result.names.set(
        senderKey(sender.whatsapp_connection_id, sender.sender_jid),
        name,
      );
    }
  }
  // A saved contact name outranks the name a message happened to carry.
  for (const contact of contacts) {
    const name = contact.custom_name?.trim() || contact.push_name?.trim();
    if (name && contact.whatsapp_connection_id && contact.jid) {
      result.names.set(
        senderKey(contact.whatsapp_connection_id, contact.jid),
        name,
      );
    }
  }
  return result;
}

/**
 * A display-only quote built from the snapshot. Flagged `isSnapshot` so the
 * client navigates by WhatsApp reference rather than to a row that does not
 * exist.
 */
export function buildSnapshotQuote(
  reply: SnapshotReply & Pick<MessageDbRow, "contact_id" | "timestamp">,
  senders: SnapshotSenders,
): QuotedMessageData | null {
  const snapshot = readQuotedSnapshot(reply);
  if (!snapshot || !reply.quoted_message_id) return null;
  const jid = normalizeJid(snapshot.senderJid ?? null);
  const connectionId = reply.whatsapp_connection_id;
  const isOwn = Boolean(
    jid && connectionId && senders.ownJids.get(connectionId) === jid,
  );
  const name =
    jid && connectionId
      ? senders.names.get(senderKey(connectionId, jid))
      : null;
  const timestamp = new Date(reply.timestamp);
  return {
    id: reply.quoted_message_id,
    conversationId: reply.contact_id,
    senderId: jid ?? "",
    senderType: isOwn ? "user" : "contact",
    senderJid: jid,
    senderName: isOwn ? null : (name ?? null),
    sentByUserId: null,
    sentByUserName: null,
    messageType: snapshot.messageType,
    content: snapshot.content,
    isDeleted: false,
    status: isOwn ? "sent" : "delivered",
    createdAt: timestamp,
    updatedAt: timestamp,
    isSnapshot: true,
  };
}
