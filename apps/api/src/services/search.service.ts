import type { TenantDatabase } from "@wateaminbox/database";
import { type ExpressionBuilder, sql } from "kysely";
import {
  isMeilisearchAvailable,
  searchContactsWithMeilisearch,
  searchMessagesWithMeilisearch,
} from "./meilisearch.service.js";
import { getTenantConnection } from "./tenant.service.js";

// Cache Meilisearch availability status (refresh every 30 seconds)
let meilisearchAvailable: boolean | null = null;
let lastMeilisearchCheck = 0;
const MEILISEARCH_CHECK_INTERVAL = 30000;

async function checkMeilisearchAvailable(): Promise<boolean> {
  const now = Date.now();
  if (
    meilisearchAvailable === null ||
    now - lastMeilisearchCheck > MEILISEARCH_CHECK_INTERVAL
  ) {
    meilisearchAvailable = await isMeilisearchAvailable();
    lastMeilisearchCheck = now;
  }
  return meilisearchAvailable;
}

/**
 * Reset the Meilisearch availability cache (for testing)
 */
export function resetMeilisearchCache(): void {
  meilisearchAvailable = null;
  lastMeilisearchCheck = 0;
}

/**
 * Search result interface
 */
export interface SearchResult {
  id: string;
  contactId: string;
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
  startDate?: Date;
  endDate?: Date;
  messageTypes?: string[];
  useMeilisearch?: boolean; // Force using/not using Meilisearch
  assignedUserId?: string;
}

/**
 * Search messages using Meilisearch (with PostgreSQL fallback)
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
    startDate,
    endDate,
    messageTypes,
    useMeilisearch,
    assignedUserId,
  } = options;

  // The external index is tenant-scoped but not assignment-scoped. Restricted
  // users therefore use PostgreSQL, where authorization is part of the query.
  const shouldUseMeilisearch =
    !assignedUserId &&
    useMeilisearch !== false &&
    (await checkMeilisearchAvailable());

  if (shouldUseMeilisearch) {
    const meiliResult = await searchMessagesWithMeilisearch(companyId, {
      query,
      limit,
      offset,
      contactId,
      startDate,
      endDate,
      messageTypes,
    });

    // Always return Meilisearch results when Meilisearch is available
    // Even if empty - this ensures consistent behavior
    return {
      results: meiliResult.results.map((r) => ({
        ...r,
        rank: 1, // Meilisearch results are pre-ranked
      })),
      total: meiliResult.total,
    };
  }

  // Fall back to PostgreSQL full-text search
  const tenantDb = getTenantConnection(companyId);

  // Convert search query to tsquery format
  // Replace spaces with & for AND search, handle special characters
  const searchTerms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((term) => term.length > 0)
    .join(" & ");

  if (!searchTerms) {
    return { results: [], total: 0 };
  }

  // Build the search query using raw SQL for full-text search
  const result = await sql<{
    id: string;
    contact_id: string;
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
        COALESCE(c.custom_name, c.push_name, c.phone_number) as contact_name,
        c.jid as contact_jid,
        c.is_group,
        m.message_id,
        m.content,
        m.message_type,
        m.timestamp,
        ts_headline('english', COALESCE(m.content, ''), plainto_tsquery('english', ${query}),
          'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>') as highlights,
        ts_rank(COALESCE(m.search_vector, to_tsvector('english', COALESCE(m.content, ''))),
          plainto_tsquery('english', ${query})) as rank,
        COUNT(*) OVER() as total_count
      FROM messages m
      INNER JOIN contacts c ON c.id = m.contact_id
      ${
        assignedUserId
          ? sql`INNER JOIN contact_assignments ca
              ON ca.contact_id = c.id
              AND ca.assigned_to = ${assignedUserId}
              AND ca.unassigned_at IS NULL`
          : sql``
      }
      WHERE
        (m.search_vector @@ plainto_tsquery('english', ${query})
         OR m.content ILIKE '%' || ${query} || '%')
        ${contactId ? sql`AND m.contact_id = ${contactId}` : sql``}
        ${startDate ? sql`AND m.timestamp >= ${startDate}` : sql``}
        ${endDate ? sql`AND m.timestamp <= ${endDate}` : sql``}
        ${messageTypes && messageTypes.length > 0 ? sql`AND m.message_type = ANY(${messageTypes}::text[])` : sql``}
      ORDER BY rank DESC, m.timestamp DESC
    )
    SELECT * FROM search_results
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(tenantDb);

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  const results: SearchResult[] = result.rows.map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
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
 * Search contacts by name, phone number, or notes (with Meilisearch fallback)
 */
export async function searchContacts(
  companyId: string,
  query: string,
  options: {
    limit?: number;
    offset?: number;
    includeGroups?: boolean;
    useMeilisearch?: boolean;
    assignedUserId?: string;
  } = {},
): Promise<{ results: ContactSearchResult[]; total: number }> {
  const {
    limit = 50,
    offset = 0,
    includeGroups = true,
    useMeilisearch,
    assignedUserId,
  } = options;

  const shouldUseMeilisearch =
    !assignedUserId &&
    useMeilisearch !== false &&
    (await checkMeilisearchAvailable());

  if (shouldUseMeilisearch) {
    const meiliResult = await searchContactsWithMeilisearch(companyId, query, {
      limit,
      offset,
      includeGroups,
    });

    // Always return Meilisearch results when Meilisearch is available
    // Even if empty - this ensures consistent behavior
    return {
      results: meiliResult.results.map((r) => ({
        id: r.id,
        jid: r.jid,
        phoneNumber: r.phoneNumber,
        pushName: r.pushName,
        customName: r.customName,
        displayName: r.displayName,
        isGroup: r.isGroup,
        profilePictureUrl: null, // Not indexed in Meilisearch
        notesShared: r.notesShared,
      })),
      total: meiliResult.total,
    };
  }

  // Fall back to PostgreSQL ILIKE search
  const tenantDb = getTenantConnection(companyId);

  const searchPattern = `%${query}%`;

  let resultQuery = tenantDb
    .selectFrom("contacts")
    .select([
      "id",
      "jid",
      "phone_number",
      "push_name",
      "custom_name",
      "is_group",
      "profile_picture_url",
      "notes_shared",
    ])
    .where((eb: ExpressionBuilder<TenantDatabase, "contacts">) =>
      eb.or([
        eb("push_name", "ilike", searchPattern),
        eb("custom_name", "ilike", searchPattern),
        eb("phone_number", "ilike", searchPattern),
        eb("notes_shared", "ilike", searchPattern),
      ]),
    );
  if (assignedUserId) {
    resultQuery = resultQuery.innerJoin("contact_assignments", (join) =>
      join
        .onRef("contact_assignments.contact_id", "=", "contacts.id")
        .on("contact_assignments.assigned_to", "=", assignedUserId)
        .on("contact_assignments.unassigned_at", "is", null),
    );
  }
  const result = await resultQuery
    .$if(!includeGroups, (qb) => qb.where("is_group", "=", false))
    .orderBy("custom_name", "asc")
    .orderBy("push_name", "asc")
    .limit(limit)
    .offset(offset)
    .execute();

  // Get total count
  let countQuery = tenantDb
    .selectFrom("contacts")
    .select((eb: ExpressionBuilder<TenantDatabase, "contacts">) =>
      eb.fn.count("id").as("total"),
    )
    .where((eb: ExpressionBuilder<TenantDatabase, "contacts">) =>
      eb.or([
        eb("push_name", "ilike", searchPattern),
        eb("custom_name", "ilike", searchPattern),
        eb("phone_number", "ilike", searchPattern),
        eb("notes_shared", "ilike", searchPattern),
      ]),
    );

  if (assignedUserId) {
    countQuery = countQuery.innerJoin("contact_assignments", (join) =>
      join
        .onRef("contact_assignments.contact_id", "=", "contacts.id")
        .on("contact_assignments.assigned_to", "=", assignedUserId)
        .on("contact_assignments.unassigned_at", "is", null),
    );
  }
  if (!includeGroups) {
    countQuery = countQuery.where("is_group", "=", false);
  }

  const countResult = await countQuery.executeTakeFirst();
  const total = Number(countResult?.total || 0);

  return {
    results: result.map((c) => ({
      id: c.id,
      jid: c.jid,
      phoneNumber: c.phone_number,
      pushName: c.push_name,
      customName: c.custom_name,
      displayName: c.custom_name || c.push_name || c.phone_number || "Unknown",
      isGroup: c.is_group,
      profilePictureUrl: c.profile_picture_url,
      notesShared: c.notes_shared,
    })),
    total,
  };
}

export interface ContactSearchResult {
  id: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
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
 * Update search vector for a message (called when message is saved)
 */
export async function updateMessageSearchVector(
  companyId: string,
  messageId: string,
): Promise<void> {
  const tenantDb = getTenantConnection(companyId);

  await sql`
    UPDATE messages
    SET search_vector = to_tsvector('english', COALESCE(content, ''))
    WHERE id = ${messageId}
  `.execute(tenantDb);
}
