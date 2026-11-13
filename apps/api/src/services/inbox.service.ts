import type { Kysely } from "kysely";
import { sql } from "kysely";
import {
  type ContactWithLastMessage,
  getContactsWithLastMessage,
} from "./contact.service.js";
import { phoneSearchDigits } from "./helpers/contact-query-builder.js";
import {
  activityMicrosSql,
  afterInboxCursorSql,
  beforeInboxCursorSql,
  CONTACT_ROW,
  compareInboxKeys,
  encodeInboxCursor,
  type InboxCursor,
  type InboxDirection,
  THREAD_ROW,
} from "./inbox-cursor.js";
import { getSchemaName, type TenantDatabase } from "./tenant.service.js";

/**
 * The unified inbox: customer rows (contacts, the WhatsApp linked-device side
 * and every merged customer) and channel threads with no contact (Telegram and
 * other spine-only providers) in ONE server-side order with keyset paging.
 *
 * Before this the web client fetched both lists separately, paged each on its
 * own offsets and interleaved them in the browser: a thread could sort above a
 * newer customer still waiting on its list's next page, filters were applied
 * partly client-side, and MCP only ever saw channel threads on its first page.
 *
 * Each side keeps its own tuned query; both apply every filter in SQL and stop
 * at the same cursor, so taking the first `limit` rows of the merged pair is
 * exactly the next `limit` rows of the combined order.
 */
export interface InboxQuery {
  search?: string;
  limit: number;
  cursor?: InboxCursor;
  /** Page down from the cursor ("after", default) or back up ("before"). */
  direction?: InboxDirection;
  includeGroups?: boolean;
  /** Narrow to one account: a WhatsApp connection or a channel account. */
  accountId?: string;
  tagIds?: string[];
  assignedToMe?: boolean;
  unassigned?: boolean;
  unreadOnly?: boolean;
  conversationStatus?: "open" | "pending" | "resolved" | "all";
  userId: string;
  /** Members without view-all permission see only what is assigned to them. */
  restrictToAssigned: boolean;
  /** Spine reads are off for this workspace: list customer rows only. */
  includeThreads: boolean;
}

export interface InboxThreadRow {
  id: string;
  channel_account_id: string;
  channel: string;
  provider: string;
  kind: "direct" | "group" | "thread";
  subject: string | null;
  external_thread_id: string | null;
  first_message_at: Date | null;
  last_message_at: Date | null;
  activity_us: string | null;
  account_display_name: string | null;
  account_provider_metadata: unknown;
  account_status: string;
  unread_count: number | string | null;
  last_message_preview: string | null;
  conversation_status: "open" | "pending" | "resolved" | null;
  assigned_to: string | null;
}

export type InboxItem =
  | { kind: "contact"; contact: ContactWithLastMessage }
  | { kind: "thread"; thread: InboxThreadRow };

export interface InboxPage {
  items: InboxItem[];
  /** Continue down the inbox from the last item, or null at the end. */
  nextCursor: string | null;
  /** Page back up from the first item, or null at the top. */
  prevCursor: string | null;
}

function keyOf(item: InboxItem): InboxCursor {
  return item.kind === "contact"
    ? {
        activityUs: item.contact.activity_us,
        kind: CONTACT_ROW,
        id: item.contact.id,
      }
    : {
        activityUs: item.thread.activity_us,
        kind: THREAD_ROW,
        id: item.thread.id,
      };
}

export async function getInboxPage(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  query: InboxQuery,
): Promise<InboxPage> {
  // One extra row from each side tells us whether anything follows the page.
  const probe = query.limit + 1;
  const [contactPage, threads] = await Promise.all([
    getContactsWithLastMessage(tenantDb, companyId, {
      search: query.search,
      limit: probe,
      cursor: query.cursor,
      cursorDirection: query.direction,
      skipCount: true,
      includeGroups: query.includeGroups,
      channelAccountId: query.accountId,
      tagIds: query.tagIds,
      assignedToMe: query.assignedToMe,
      unassigned: query.unassigned,
      userId: query.userId,
      restrictToAssigned: query.restrictToAssigned,
      conversationStatus: query.conversationStatus,
      unreadOnly: query.unreadOnly,
    }),
    query.includeThreads
      ? listInboxThreads(tenantDb, companyId, { ...query, limit: probe })
      : Promise.resolve([]),
  ]);

  const merged: InboxItem[] = [
    ...contactPage.contacts.map(
      (contact) => ({ kind: "contact", contact }) as const,
    ),
    ...threads.map((thread) => ({ kind: "thread", thread }) as const),
  ].sort((left, right) => compareInboxKeys(keyOf(left), keyOf(right)));

  const backwards = Boolean(query.cursor) && query.direction === "before";
  // Paging up keeps the rows nearest the cursor: the end of the merged order.
  const items = backwards
    ? merged.slice(Math.max(0, merged.length - query.limit))
    : merged.slice(0, query.limit);
  const overflow = merged.length > query.limit;
  const first = items.at(0);
  const last = items.at(-1);
  const hasAfter = backwards ? Boolean(query.cursor) : overflow;
  const hasBefore = backwards ? overflow : Boolean(query.cursor);
  return {
    items,
    nextCursor: hasAfter && last ? encodeInboxCursor(keyOf(last)) : null,
    prevCursor: hasBefore && first ? encodeInboxCursor(keyOf(first)) : null,
  };
}

/**
 * Channel threads that are not already represented by a customer row.
 *
 * Mirrors the visibility rules of GET /conversations exactly (linked-device
 * mirrors and merged-away threads stay out), and answers every inbox filter in
 * SQL so a page is never short because rows were dropped after LIMIT.
 */
export async function listInboxThreads(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  query: InboxQuery,
): Promise<InboxThreadRow[]> {
  const activity = sql`conversation.last_message_at`;
  let builder = tenantDb
    .selectFrom("conversations as conversation")
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
    )
    .leftJoin(
      "conversation_states as state",
      "state.conversation_id",
      "conversation.id",
    )
    .leftJoin("contact_assignments as assignment", (join) =>
      join
        .onRef("assignment.conversation_id", "=", "conversation.id")
        .on("assignment.unassigned_at", "is", null),
    )
    .select([
      "conversation.id",
      "conversation.channel_account_id",
      "account.channel",
      "account.provider",
      "conversation.kind",
      "conversation.subject",
      "conversation.external_thread_id",
      "conversation.first_message_at",
      "conversation.last_message_at",
      "account.display_name as account_display_name",
      "account.provider_metadata as account_provider_metadata",
      "account.status as account_status",
      "state.unread_count",
      "state.last_message_preview",
      "state.status as conversation_status",
      "assignment.assigned_to",
      activityMicrosSql(activity).as("activity_us"),
    ])
    .where("conversation.archived_at", "is", null)
    .where("account.archived_at", "is", null)
    // Linked-device WhatsApp conversations mirror contact threads that the
    // customer rows already list (see GET /conversations).
    .where("account.legacy_whatsapp_connection_id", "is", null)
    // A thread bridged to a live customer is that customer's row; only
    // contactless threads and threads of merged-away contacts would otherwise
    // be listed, and merged-away ones belong to the surviving customer.
    .where((eb) =>
      eb.or([
        eb("conversation.legacy_contact_id", "is", null),
        eb.not(
          eb.exists(
            eb
              .selectFrom("contacts as bridged")
              .select("bridged.id")
              .whereRef("bridged.id", "=", "conversation.legacy_contact_id"),
          ),
        ),
      ]),
    );

  if (query.accountId) {
    builder = builder.where(
      "conversation.channel_account_id",
      "=",
      query.accountId,
    );
  }
  if (!query.includeGroups) {
    builder = builder.where("conversation.kind", "=", "direct");
  }
  if (query.conversationStatus && query.conversationStatus !== "all") {
    // A thread with no state row has never been worked: it reads as open,
    // matching what GET /conversations reported to the client.
    builder = builder.where(
      sql<boolean>`COALESCE(state.status::text, 'open') = ${query.conversationStatus}`,
    );
  }
  if (query.unreadOnly) {
    builder = builder.where("state.unread_count", ">", 0);
  }
  if (query.tagIds?.length) {
    const tagIds = query.tagIds;
    builder = builder.where((eb) =>
      eb.exists(
        eb
          .selectFrom("conversation_tags as link")
          .select("link.tag_id")
          .whereRef("link.conversation_id", "=", "conversation.id")
          .where("link.tag_id", "in", tagIds),
      ),
    );
  }
  if ((query.restrictToAssigned || query.assignedToMe) && query.userId) {
    builder = builder.where("assignment.assigned_to", "=", query.userId);
  } else if (query.unassigned) {
    builder = builder.where("assignment.assigned_to", "is", null);
  }
  if (query.search?.trim()) {
    builder = builder.where(
      threadSearchClause(getSchemaName(companyId), query.search),
    );
  }
  const backwards = Boolean(query.cursor) && query.direction === "before";
  if (query.cursor) {
    builder = builder.where(
      (backwards ? beforeInboxCursorSql : afterInboxCursorSql)(
        activity,
        sql`conversation.id`,
        THREAD_ROW,
        query.cursor,
      ),
    );
  }

  return (await (backwards
    ? builder
        .orderBy(sql`conversation.last_message_at ASC NULLS FIRST`)
        .orderBy("conversation.id", "asc")
    : builder
        .orderBy(sql`conversation.last_message_at DESC NULLS LAST`)
        .orderBy("conversation.id", "desc")
  )
    .limit(query.limit)
    .execute()) as InboxThreadRow[];
}

/**
 * A thread is found by what the inbox shows for it: its subject, or its
 * counterpart's name, handle or address (a direct Telegram thread usually has
 * no subject - its name lives on the endpoint).
 */
function threadSearchClause(schemaName: string, search: string) {
  // Raw SQL is not schema-qualified by the tenant plugin; qualify it here.
  const participants = sql.table(`${schemaName}.conversation_participants`);
  const endpoints = sql.table(`${schemaName}.contact_endpoints`);
  const term = `%${search.trim()}%`;
  const handle = `%${search.trim().replace(/^@+/, "") || search.trim()}%`;
  const digits = phoneSearchDigits(search);
  return sql<boolean>`(
    conversation.subject ILIKE ${term}
    OR EXISTS (
      SELECT 1
      FROM ${participants} participant
      JOIN ${endpoints} endpoint
        ON endpoint.id = participant.contact_endpoint_id
      WHERE participant.conversation_id = conversation.id
        AND participant.is_self = false
        AND (
          endpoint.display_name ILIKE ${term}
          OR endpoint.address_display ILIKE ${handle}
          OR endpoint.normalized_address ILIKE ${term}
          ${digits ? sql`OR endpoint.normalized_address ILIKE ${`%${digits}%`}` : sql``}
        )
    )
  )`;
}

/**
 * Unread total across everything this reader can see: the navigation badge.
 *
 * Counted with the same visibility as the list, without loading rows, so the
 * badge includes channel threads (it used to sum only the first contact page).
 */
export async function getInboxUnreadTotal(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: {
    userId: string;
    restrictToAssigned: boolean;
    includeThreads: boolean;
  },
): Promise<number> {
  const schema = sql.ref(getSchemaName(companyId));
  const restrict = options.restrictToAssigned;
  const contactRows = await sql<{ total: string | null }>`
    SELECT COALESCE(SUM(COALESCE(csc.unread_count, csl.unread_count, 0)), 0)::bigint AS total
    FROM ${schema}.${sql.ref("contacts")} c
    LEFT JOIN ${schema}.${sql.ref("conversations")} conv
      ON conv.legacy_contact_id = c.id AND conv.archived_at IS NULL
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} csc
      ON conv.id IS NOT NULL AND csc.conversation_id = conv.id
    LEFT JOIN ${schema}.${sql.ref("conversation_states")} csl
      ON conv.id IS NULL AND csl.contact_id = c.id
    WHERE (c.jid IS NULL OR c.jid NOT LIKE '%@broadcast')
      -- The badge has always counted the default (open) inbox.
      AND COALESCE(csc.status::text, csl.status::text, 'resolved') = 'open'
      ${
        restrict
          ? // Same visibility as the list: a customer (with every contact
            // merged into it) is visible when any of its rows is assigned to
            // this reader.
            sql`AND EXISTS (
              SELECT 1
              FROM ${schema}.${sql.ref("contact_assignments")} ca
              JOIN ${schema}.${sql.ref("contacts")} g ON g.id = ca.contact_id
              WHERE ca.unassigned_at IS NULL
                AND ca.assigned_to = ${options.userId}
                AND (g.id = COALESCE(c.merged_into_contact_id, c.id)
                  OR g.merged_into_contact_id = COALESCE(c.merged_into_contact_id, c.id))
            )`
          : sql``
      }
  `.execute(tenantDb);
  let total = Number(contactRows.rows[0]?.total ?? 0);

  if (options.includeThreads) {
    let threads = tenantDb
      .selectFrom("conversations as conversation")
      .innerJoin(
        "channel_accounts as account",
        "account.id",
        "conversation.channel_account_id",
      )
      .innerJoin(
        "conversation_states as state",
        "state.conversation_id",
        "conversation.id",
      )
      .select(
        sql<string>`COALESCE(SUM(state.unread_count), 0)::bigint`.as("total"),
      )
      .where("conversation.archived_at", "is", null)
      .where("account.archived_at", "is", null)
      .where("account.legacy_whatsapp_connection_id", "is", null)
      .where(sql<boolean>`COALESCE(state.status::text, 'open') = 'open'`)
      .where((eb) =>
        eb.or([
          eb("conversation.legacy_contact_id", "is", null),
          eb.not(
            eb.exists(
              eb
                .selectFrom("contacts as bridged")
                .select("bridged.id")
                .whereRef("bridged.id", "=", "conversation.legacy_contact_id"),
            ),
          ),
        ]),
      );
    if (restrict) {
      threads = threads.where((eb) =>
        eb.exists(
          eb
            .selectFrom("contact_assignments as assignment")
            .select("assignment.id")
            .whereRef("assignment.conversation_id", "=", "conversation.id")
            .where("assignment.unassigned_at", "is", null)
            .where("assignment.assigned_to", "=", options.userId),
        ),
      );
    }
    const row = await threads.executeTakeFirst();
    total += Number(row?.total ?? 0);
  }
  return total;
}
