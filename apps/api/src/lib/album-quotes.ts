import { type Kysely, sql } from "kysely";
import type { TenantDatabase } from "../services/tenant.service.js";
import type { MessageDbRow } from "./message-formatters.js";

/**
 * WhatsApp sends a photo/video album as one parent message plus one message
 * per item, and a reply to the album quotes the PARENT's id. We store only the
 * items, each tagged `metadata.mediaAlbumId = <parent id>`, so a plain lookup
 * by `message_id` never finds the quote and the reply reads "Quoted message
 * unavailable" even though every photo is in the thread.
 *
 * These helpers resolve such a reference to a stand-in album item: the
 * earliest item (so navigation lands on the album) carrying the album caption
 * when any item has one.
 */

/** How far before a reply its album may be; bounds the unindexed scan. */
const ALBUM_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

interface AlbumQuoteReply {
  contact_id: string | null;
  whatsapp_connection_id: string | null;
  quoted_message_id: string | null;
  timestamp: Date | string;
}

/**
 * Album items for the replies whose quote is not in `resolvedIds`. Only the
 * replies' own chats and connections are searched, within the lookback window.
 */
export async function loadAlbumQuoteRows(
  tenantDb: Kysely<TenantDatabase>,
  replies: readonly AlbumQuoteReply[],
  resolvedIds: ReadonlySet<string>,
): Promise<MessageDbRow[]> {
  const unresolved = replies.filter(
    (reply) =>
      reply.quoted_message_id &&
      reply.contact_id &&
      reply.whatsapp_connection_id &&
      !resolvedIds.has(reply.quoted_message_id),
  );
  if (unresolved.length === 0) return [];

  const albumIds = [...new Set(unresolved.map((r) => r.quoted_message_id!))];
  const contactIds = [...new Set(unresolved.map((r) => r.contact_id!))];
  const connectionIds = [
    ...new Set(unresolved.map((r) => r.whatsapp_connection_id!)),
  ];
  const times = unresolved.map((r) => new Date(r.timestamp).getTime());
  const newest = new Date(Math.max(...times));
  const oldest = new Date(Math.min(...times) - ALBUM_LOOKBACK_MS);

  const rows = await tenantDb
    .selectFrom("messages")
    .selectAll()
    .where("contact_id", "in", contactIds)
    .where("whatsapp_connection_id", "in", connectionIds)
    .where("timestamp", ">=", oldest)
    .where("timestamp", "<=", newest)
    .where(sql<boolean>`metadata ->> 'mediaAlbumId' IN (${sql.join(albumIds)})`)
    .orderBy("timestamp", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows as unknown as MessageDbRow[];
}

/**
 * The stand-in album item for one reply, or undefined when the reply does not
 * quote an album in its own chat and connection.
 */
export function pickAlbumQuote(
  rows: readonly MessageDbRow[],
  reply: AlbumQuoteReply & { conversation_id?: string | null },
): MessageDbRow | undefined {
  if (!reply.quoted_message_id) return undefined;
  const items = rows.filter(
    (row) =>
      row.metadata?.mediaAlbumId === reply.quoted_message_id &&
      row.contact_id === reply.contact_id &&
      row.whatsapp_connection_id === reply.whatsapp_connection_id &&
      // A merged timeline spans threads; never borrow another thread's album.
      (reply.conversation_id === undefined ||
        (row.conversation_id ?? null) === (reply.conversation_id ?? null)),
  );
  const first = items[0];
  if (!first) return undefined;
  const caption = items.find((item) => item.content?.trim())?.content ?? null;
  return { ...first, content: caption ?? first.content };
}
