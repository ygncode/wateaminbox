import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import type { MessageDbRow } from "../lib/message-formatters.js";
import { getSchemaName, type TenantDatabase } from "./tenant.service.js";

type TimelineDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/** One thread a customer can be reached on, as the timeline addresses it. */
export interface CustomerThread {
  conversationId: string | null;
  contactId: string | null;
}

export interface CustomerThreadSet {
  canonicalContactId: string;
  threads: CustomerThread[];
}

/** A position in the timeline: the message last returned. */
export interface TimelineCursor {
  timestamp: Date;
  id: string;
}

/**
 * The customer behind an id, and every thread they can be reached on.
 *
 * One query, not two. The merged view is on the hottest path in the product,
 * so learning who this is and what they own has to cost what resolving the id
 * already cost - otherwise every workspace pays for a feature only merged
 * customers use.
 *
 * The walk goes up to the canonical customer and back down to the rows merged
 * into it, bounded at eight hops the way the rest of the merge code is: a
 * cycle or an unexpectedly deep chain stops rather than looping.
 *
 * Threads are resolved through endpoints, because endpoints are what a merge
 * moves, and a neutral thread has no legacy contact to walk back from. Every
 * contact in the group is also returned on its own: one that predates the
 * spine has messages anchored only by `contact_id`, and dropping it would hide
 * a real thread.
 */
export async function resolveCustomerThreads(
  db: TimelineDb,
  companyId: string,
  requestedId: string,
): Promise<CustomerThreadSet | null> {
  const schema = sql.ref(getSchemaName(companyId));
  const result = await sql<{
    canonical_contact_id: string;
    conversation_id: string | null;
    contact_id: string | null;
  }>`
    WITH RECURSIVE requested AS (
      SELECT id AS contact_id FROM ${schema}.${sql.ref("contacts")}
       WHERE id = ${requestedId}
      UNION ALL
      SELECT legacy_contact_id FROM ${schema}.${sql.ref("conversations")}
       WHERE id = ${requestedId} AND legacy_contact_id IS NOT NULL
    ),
    up AS (
      SELECT c.id, c.merged_into_contact_id, 1 AS depth
        FROM ${schema}.${sql.ref("contacts")} c
        JOIN requested r ON r.contact_id = c.id
      UNION ALL
      SELECT p.id, p.merged_into_contact_id, up.depth + 1
        FROM ${schema}.${sql.ref("contacts")} p
        JOIN up ON p.id = up.merged_into_contact_id
       WHERE up.depth < 8
    ),
    canonical AS (
      SELECT id FROM up WHERE merged_into_contact_id IS NULL LIMIT 1
    ),
    grp AS (
      SELECT id, 1 AS depth FROM canonical
      UNION ALL
      SELECT c.id, grp.depth + 1
        FROM ${schema}.${sql.ref("contacts")} c
        JOIN grp ON c.merged_into_contact_id = grp.id
       WHERE grp.depth < 8
    )
    SELECT (SELECT id FROM canonical) AS canonical_contact_id,
           conversation.id AS conversation_id,
           conversation.legacy_contact_id AS contact_id
      FROM grp
      JOIN ${schema}.${sql.ref("contact_endpoints")} endpoint
        ON endpoint.contact_id = grp.id
      JOIN ${schema}.${sql.ref("conversation_participants")} participant
        ON participant.contact_endpoint_id = endpoint.id
       AND participant.left_at IS NULL
      JOIN ${schema}.${sql.ref("conversations")} conversation
        ON conversation.id = participant.conversation_id
       AND conversation.archived_at IS NULL
    UNION
    SELECT (SELECT id FROM canonical), NULL, grp.id FROM grp
  `.execute(db);

  const canonicalContactId = result.rows.find(
    (row) => row.canonical_contact_id,
  )?.canonical_contact_id;
  if (!canonicalContactId) return null;
  return {
    canonicalContactId,
    threads: result.rows.map((row) => ({
      conversationId: row.conversation_id,
      contactId: row.contact_id,
    })),
  };
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(
    `${cursor.timestamp.toISOString()}|${cursor.id}`,
    "utf8",
  ).toString("base64url");
}

/**
 * A cursor that does not decode is refused rather than ignored.
 *
 * The legacy fetch route silently drops an unknown cursor and answers with the
 * newest page, which reads as the history jumping back to the bottom while
 * scrolling up. Answering nothing is easier to see and easier to fix.
 */
export function decodeTimelineCursor(value: string): TimelineCursor | null {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const separator = decoded.indexOf("|");
  if (separator < 0) return null;
  const timestamp = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(timestamp.getTime()) || !id) return null;
  return { timestamp, id };
}

export interface TimelinePage {
  messages: MessageDbRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * One page of a customer's history, interleaved across their threads.
 *
 * `(timestamp, id)` is a total order across conversations and is the trailing
 * key of both message indexes, so every thread shares one cursor and each scan
 * is index-backed. A single query spanning both anchors is not an option: the
 * index runner records that a COALESCE across `contact_id` and
 * `conversation_id` can use neither index, and measured forty milliseconds
 * against over five minutes.
 *
 * Each side is asked for a full page. That is what makes the merge safe: the
 * next row on either side is strictly older than the last row returned, so it
 * cannot belong on this page.
 */
export async function listCustomerTimeline(
  db: TimelineDb,
  input: {
    threads: CustomerThread[];
    limit: number;
    cursor?: TimelineCursor;
  },
): Promise<TimelinePage> {
  const conversationIds = [
    ...new Set(
      input.threads
        .map((thread) => thread.conversationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const contactIds = [
    ...new Set(
      input.threads
        .map((thread) => thread.contactId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (conversationIds.length === 0 && contactIds.length === 0) {
    return { messages: [], hasMore: false, nextCursor: null };
  }

  // One row beyond the page, so "is there more" is an answer rather than the
  // `length === limit` guess the conversation route makes - that reports a
  // further page whenever the last one happens to be full, which in an
  // infinite scroll is a spinner that never resolves.
  const probe = input.limit + 1;
  const keyset = input.cursor
    ? sql<boolean>`(timestamp, id) < (${input.cursor.timestamp}, ${input.cursor.id}::uuid)`
    : sql<boolean>`TRUE`;

  const [byConversation, byContact] = await Promise.all([
    conversationIds.length > 0
      ? db
          .selectFrom("messages")
          .selectAll()
          .where("conversation_id", "in", conversationIds)
          .where(keyset)
          .orderBy("timestamp", "desc")
          .orderBy("id", "desc")
          .limit(probe)
          .execute()
      : Promise.resolve([]),
    contactIds.length > 0
      ? db
          .selectFrom("messages")
          .selectAll()
          // Only rows the conversation-anchored scan cannot see. Without this
          // a bridged message is returned twice, once under each anchor.
          .where("conversation_id", "is", null)
          .where("contact_id", "in", contactIds)
          .where(keyset)
          .orderBy("timestamp", "desc")
          .orderBy("id", "desc")
          .limit(probe)
          .execute()
      : Promise.resolve([]),
  ]);

  const merged = [
    ...(byConversation as unknown as MessageDbRow[]),
    ...(byContact as unknown as MessageDbRow[]),
  ].sort(compareNewestFirst);

  const page = merged.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    messages: page,
    hasMore: merged.length > input.limit,
    nextCursor: last
      ? encodeTimelineCursor({ timestamp: last.timestamp, id: last.id })
      : null,
  };
}

/**
 * Newest first, by the same key the scans are ordered and paginated on.
 *
 * The `id` tiebreak is arbitrary but stable, which is what pagination needs:
 * two messages sharing a timestamp must fall on the same side of a page
 * boundary on every request.
 */
function compareNewestFirst(left: MessageDbRow, right: MessageDbRow): number {
  const difference = right.timestamp.getTime() - left.timestamp.getTime();
  if (difference !== 0) return difference;
  return right.id.localeCompare(left.id);
}
