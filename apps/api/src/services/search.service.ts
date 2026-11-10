import type { TenantDatabase } from "@wateaminbox/database";
import {
  extractPhoneFromJid,
  getContactDisplayName,
} from "@wateaminbox/shared";
import { type ExpressionBuilder, sql } from "kysely";
import { getSchemaName, getTenantConnection } from "./tenant.service.js";

/**
 * PostgreSQL is the only search backend.
 *
 * Matching is `ILIKE '%term%'` on the relevant text columns, which is
 * language-agnostic (Thai, Burmese, CJK, emoji, phone fragments) and served by
 * the pg_trgm GIN indexes from migration 110. The `'english'` tsvector only
 * contributes ranking where it applies; rows it cannot tokenize rank 0 and
 * fall back to recency, which is the correct order for them.
 */

/**
 * Search result interface
 */
export interface SearchResult {
  id: string;
  contactId: string;
  conversationId?: string | null;
  contactName: string | null;
  contactJid: string | null;
  isGroup: boolean;
  messageId: string | null;
  content: string | null;
  messageType: string | null;
  timestamp: Date;
  highlights: string | null;
  rank: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  contactId?: string;
  conversationId?: string;
  startDate?: Date;
  endDate?: Date;
  messageTypes?: string[];
  /** @deprecated Search is PostgreSQL-only; the flag is accepted and ignored. */
  useMeilisearch?: boolean;
  assignedUserId?: string;
}

/**
 * Escape LIKE/ILIKE metacharacters so a user query is matched literally.
 * Used with `ESCAPE '\'`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Search messages with PostgreSQL (trigram ILIKE match, tsvector rank).
 */
export async function searchMessages(
  companyId: string,
  options: SearchOptions,
): Promise<{ results: SearchResult[]; total: number }> {
  const {
    query,
    limit = 50,
    offset = 0,
    contactId,
    conversationId,
    startDate,
    endDate,
    messageTypes,
    assignedUserId,
  } = options;

  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], total: 0 };
  }
  const likePattern = `%${escapeLikePattern(trimmed)}%`;

  const tenantDb = getTenantConnection(companyId);

  // Raw SQL isn't transformed by Kysely's withSchema() plugin. Qualify every
  // tenant table explicitly so search cannot hit the public schema or another
  // tenant through a connection-level search_path.
  const schemaName = getSchemaName(companyId);
  const messagesTable = sql.table(`${schemaName}.messages`);
  const contactsTable = sql.table(`${schemaName}.contacts`);
  const conversationsTable = sql.table(`${schemaName}.conversations`);
  const assignmentsTable = sql.table(`${schemaName}.contact_assignments`);

  // One FROM/JOIN/WHERE fragment serves both the page query and the
  // past-the-end count so the two can never disagree about what matches.
  const fromAndWhere = sql`
    FROM ${messagesTable} m
    LEFT JOIN ${contactsTable} c ON c.id = m.contact_id
    LEFT JOIN ${conversationsTable} conv ON conv.id = m.conversation_id
    ${
      assignedUserId
        ? sql`INNER JOIN ${assignmentsTable} ca
            ON ca.assigned_to = ${assignedUserId}
            AND ca.unassigned_at IS NULL
            AND (
              ca.conversation_id = m.conversation_id
              OR (m.contact_id IS NOT NULL AND ca.contact_id = m.contact_id)
            )`
        : sql``
    }
    WHERE
      (m.content ILIKE ${likePattern} ESCAPE '\\'
       OR m.search_vector @@ plainto_tsquery('english', ${trimmed}))
      ${contactId ? sql`AND m.contact_id = ${contactId}` : sql``}
      ${conversationId ? sql`AND m.conversation_id = ${conversationId}` : sql``}
      ${startDate ? sql`AND m.timestamp >= ${startDate}` : sql``}
      ${endDate ? sql`AND m.timestamp <= ${endDate}` : sql``}
      ${messageTypes && messageTypes.length > 0 ? sql`AND m.message_type = ANY(${messageTypes}::text[])` : sql``}
  `;

  const result = await sql<{
    id: string;
    contact_id: string | null;
    conversation_id: string | null;
    contact_name: string | null;
    contact_jid: string | null;
    is_group: boolean;
    message_id: string | null;
    content: string | null;
    message_type: string | null;
    timestamp: Date;
    highlights: string | null;
    rank: number;
    total_count: number;
  }>`
    WITH search_results AS (
      SELECT
        m.id,
        m.contact_id,
        m.conversation_id,
        COALESCE(
          c.custom_name,
          c.push_name,
          CASE WHEN c.username IS NOT NULL THEN '@' || c.username END,
          c.phone_number,
          conv.subject
        ) as contact_name,
        c.jid as contact_jid,
        COALESCE(c.is_group, conv.kind <> 'direct') as is_group,
        m.message_id,
        m.content,
        m.message_type,
        m.timestamp,
        ts_rank(COALESCE(m.search_vector, to_tsvector('english', COALESCE(m.content, ''))),
          plainto_tsquery('english', ${trimmed})) as rank,
        COUNT(*) OVER() as total_count
      ${fromAndWhere}
      ORDER BY rank DESC, m.timestamp DESC
    ),
    page AS (
      SELECT * FROM search_results
      LIMIT ${limit}
      OFFSET ${offset}
    )
    -- ts_headline is one of Postgres's most expensive text functions: it
    -- re-parses the document and re-runs the tsquery to build the <mark> markup.
    -- It does not affect ranking or filtering, so it runs after LIMIT/OFFSET,
    -- on the page rows only.
    SELECT
      *,
      ts_headline('english', COALESCE(content, ''), plainto_tsquery('english', ${trimmed}),
        'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>') as highlights
    FROM page
  `.execute(tenantDb);

  let total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  // When the requested page sits beyond the last matching row (offset >= total),
  // the page is empty so the per-row COUNT(*) OVER() is unavailable and `total`
  // would collapse to 0 (indistinguishable from a genuine no-match search).
  // Re-count with the identical FROM/WHERE, not subject to LIMIT/OFFSET.
  if (result.rows.length === 0 && offset > 0) {
    const countResult = await sql<{ total: string | number }>`
      SELECT COUNT(*)::int AS total ${fromAndWhere}
    `.execute(tenantDb);
    total = Number(countResult.rows[0]?.total ?? 0);
  }

  const results: SearchResult[] = result.rows.map((row) => ({
    id: row.id,
    contactId: row.contact_id ?? "",
    conversationId: row.conversation_id,
    contactName: row.contact_jid
      ? getContactDisplayName(
          { jid: row.contact_jid, name: row.contact_name },
          "Unknown",
        )
      : row.contact_name,
    contactJid: row.contact_jid,
    isGroup: row.is_group,
    messageId: row.message_id,
    content: row.content,
    messageType: row.message_type,
    timestamp: row.timestamp,
    highlights: row.highlights,
    rank: row.rank,
  }));

  return { results, total };
}

/**
 * Search contacts by name, phone number, username or shared notes.
 */
export async function searchContacts(
  companyId: string,
  query: string,
  options: {
    limit?: number;
    offset?: number;
    includeGroups?: boolean;
    /** @deprecated Search is PostgreSQL-only; the flag is accepted and ignored. */
    useMeilisearch?: boolean;
    assignedUserId?: string;
  } = {},
): Promise<{ results: ContactSearchResult[]; total: number }> {
  const {
    limit = 50,
    offset = 0,
    includeGroups = true,
    assignedUserId,
  } = options;

  const tenantDb = getTenantConnection(companyId);

  const trimmed = query.trim();
  const searchPattern = `%${escapeLikePattern(trimmed)}%`;
  const usernameQuery = trimmed.replace(/^@+/, "") || trimmed;
  const usernameSearchPattern = `%${escapeLikePattern(usernameQuery)}%`;

  // Shared predicate for the page query and the past-the-end count. Merged-away
  // contacts are hidden here (the Meilisearch projection used to delete their
  // documents); the surviving canonical contact remains searchable.
  const filtered = () =>
    tenantDb
      .selectFrom("contacts")
      .where((eb: ExpressionBuilder<TenantDatabase, "contacts">) =>
        eb.or([
          eb("push_name", "ilike", searchPattern),
          eb("username", "ilike", usernameSearchPattern),
          eb("custom_name", "ilike", searchPattern),
          eb("phone_number", "ilike", searchPattern),
          eb("notes_shared", "ilike", searchPattern),
        ]),
      )
      .where("contacts.merged_into_contact_id", "is", null)
      .$if(!includeGroups, (qb) => qb.where("contacts.is_group", "=", false))
      .$if(Boolean(assignedUserId), (qb) =>
        qb.innerJoin("contact_assignments", (join) =>
          join
            .onRef("contact_assignments.contact_id", "=", "contacts.id")
            .on("contact_assignments.assigned_to", "=", assignedUserId ?? "")
            .on("contact_assignments.unassigned_at", "is", null),
        ),
      );

  const result = await filtered()
    .select([
      "contacts.id",
      "contacts.jid",
      "contacts.phone_number",
      "contacts.push_name",
      "contacts.username",
      "contacts.custom_name",
      "contacts.is_group",
      "contacts.profile_picture_url",
      "contacts.notes_shared",
    ])
    // Fold the page total into the page query (one ILIKE scan) instead of
    // re-running the same 5-way ILIKE scan a second time just to count.
    .select((eb) => eb.fn.count("contacts.id").over().as("total"))
    .orderBy("contacts.custom_name", "asc")
    .orderBy("contacts.push_name", "asc")
    .limit(limit)
    .offset(offset)
    .execute();

  let total = result.length > 0 ? Number(result[0].total) : 0;

  // A page past the last matching row (offset >= total) returns no rows, so the
  // per-row COUNT(*) OVER() is unavailable and total would collapse to 0. Only
  // then fall back to a standalone count — the same guard searchMessages uses.
  if (result.length === 0 && offset > 0) {
    const countResult = await filtered()
      .select((eb) => eb.fn.count("contacts.id").as("total"))
      .executeTakeFirst();
    total = Number(countResult?.total || 0);
  }

  return {
    results: result.map((c) => {
      const phoneFromJid = extractPhoneFromJid(c.jid);
      const phoneNumber =
        !c.is_group && phoneFromJid ? c.phone_number || phoneFromJid : null;
      return {
        id: c.id,
        jid: c.jid,
        phoneNumber,
        pushName: c.push_name,
        username: c.username,
        customName: c.custom_name,
        displayName: getContactDisplayName({
          jid: c.jid,
          phoneNumber,
          pushName: c.push_name,
          username: c.username,
          customName: c.custom_name,
        }),
        isGroup: c.is_group,
        profilePictureUrl: c.profile_picture_url,
        notesShared: c.notes_shared,
      };
    }),
    total,
  };
}

export interface ContactSearchResult {
  id: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  username: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  profilePictureUrl: string | null;
  notesShared: string | null;
}

/**
 * Global search across messages and contacts
 */
export async function globalSearch(
  companyId: string,
  query: string,
  options: { limit?: number; assignedUserId?: string } = {},
): Promise<{
  messages: SearchResult[];
  contacts: ContactSearchResult[];
}> {
  const { limit = 10, assignedUserId } = options;

  const [messageResults, contactResults] = await Promise.all([
    searchMessages(companyId, { query, limit, assignedUserId }),
    searchContacts(companyId, query, { limit, assignedUserId }),
  ]);

  return {
    messages: messageResults.results,
    contacts: contactResults.results,
  };
}

/**
 * Update search vector for a message. Migration 110 installs a trigger that
 * does this on every insert/update; this helper remains for callers and tests
 * that want to force a refresh.
 */
export async function updateMessageSearchVector(
  companyId: string,
  messageId: string,
): Promise<void> {
  const tenantDb = getTenantConnection(companyId);

  // Use the query builder here so withSchema() qualifies the target table.
  await tenantDb
    .updateTable("messages")
    .set({
      search_vector: sql`to_tsvector('english', COALESCE(content, ''))`,
    })
    .where("id", "=", messageId)
    .execute();
}
