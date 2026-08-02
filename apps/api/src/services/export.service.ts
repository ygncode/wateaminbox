import { dayjs, toISOString } from "@wateaminbox/shared";
import { sql } from "kysely";
import { NotFoundError } from "../lib/errors.js";
import {
  type BackupZipOptions,
  type FullBackupData,
  generateBackupZip,
} from "./export/compression.js";
import { getSchemaName, getTenantConnection } from "./tenant.service.js";

/**
 * Export format types
 */
export type ExportFormat = "csv" | "json";

/**
 * Contact export data
 */
export interface ContactExport {
  whatsapp_id: string;
  phone_number: string | null;
  push_name: string | null;
  custom_name: string | null;
  shared_notes: string | null;
  tags: string;
  assigned_to: string | null;
  created_at: string;
  last_message_at: string | null;
}

/**
 * Message export data
 */
export interface MessageExport {
  message_id: string;
  contact_whatsapp_id: string;
  contact_name: string | null;
  direction: "sent" | "received";
  message_type: string;
  text_content: string | null;
  timestamp: string;
  sent_by_user: string | null;
  has_media: boolean;
}

/**
 * Export contacts to array
 */
export async function exportContacts(
  companyId: string,
  options: {
    tagIds?: string[];
    assignedTo?: string;
    hasCustomName?: boolean;
    assignedUserId?: string;
    includeGroups?: boolean;
  } = {},
): Promise<ContactExport[]> {
  const tenantDb = getTenantConnection(companyId);

  // Raw SQL is not transformed by Kysely's withSchema() plugin. Qualify all
  // tenant tables explicitly and compose value filters as bound SQL fragments.
  const schemaName = getSchemaName(companyId);
  const contactsTable = sql.table(`${schemaName}.contacts`);
  const contactTagsTable = sql.table(`${schemaName}.contact_tags`);
  const tagsTable = sql.table(`${schemaName}.tags`);
  const assignmentsTable = sql.table(`${schemaName}.contact_assignments`);
  const messagesTable = sql.table(`${schemaName}.messages`);

  const conditions = options.includeGroups
    ? [sql`true`]
    : [sql`c.is_group = false`];
  if (options.tagIds && options.tagIds.length > 0) {
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ${contactTagsTable} filtered_ct
      WHERE filtered_ct.contact_id = c.id
        AND filtered_ct.tag_id = ANY(${options.tagIds}::uuid[])
    )`);
  }
  if (options.assignedTo) {
    conditions.push(sql`ca.assigned_to = ${options.assignedTo}`);
  }
  if (options.assignedUserId) {
    conditions.push(sql`ca.assigned_to = ${options.assignedUserId}`);
  }
  if (options.hasCustomName) {
    conditions.push(sql`c.custom_name IS NOT NULL`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const result = await sql<{
    whatsapp_id: string;
    phone_number: string | null;
    push_name: string | null;
    custom_name: string | null;
    shared_notes: string | null;
    tags: string | null;
    assigned_to: string | null;
    created_at: Date;
    last_message_at: Date | null;
  }>`
    SELECT
      c.jid as whatsapp_id,
      c.phone_number,
      c.push_name,
      c.custom_name,
      c.notes_shared as shared_notes,
      STRING_AGG(t.name, ',' ORDER BY t.name) as tags,
      ca.assigned_to,
      c.created_at,
      lm.last_message_at
    FROM ${contactsTable} c
    LEFT JOIN ${contactTagsTable} ct ON ct.contact_id = c.id
    LEFT JOIN ${tagsTable} t ON t.id = ct.tag_id
    LEFT JOIN ${assignmentsTable} ca
      ON ca.contact_id = c.id AND ca.unassigned_at IS NULL
    LEFT JOIN LATERAL (
      SELECT MAX(m.timestamp) as last_message_at
      FROM ${messagesTable} m
      WHERE m.contact_id = c.id
    ) lm ON true
    WHERE ${whereClause}
    GROUP BY c.id, c.jid, c.phone_number, c.push_name, c.custom_name,
             c.notes_shared, c.created_at, lm.last_message_at, ca.assigned_to
    ORDER BY lm.last_message_at DESC NULLS LAST
  `.execute(tenantDb);

  return result.rows.map((c) => ({
    whatsapp_id: c.whatsapp_id,
    phone_number: c.phone_number,
    push_name: c.push_name,
    custom_name: c.custom_name,
    shared_notes: c.shared_notes,
    tags: c.tags || "",
    assigned_to: c.assigned_to,
    created_at: toISOString(c.created_at),
    last_message_at: c.last_message_at ? toISOString(c.last_message_at) : null,
  }));
}

/**
 * Valid message types for export filtering
 */
const VALID_MESSAGE_TYPES = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contact",
  "poll",
  "reaction",
] as const;

/**
 * Maximum messages to export at once to prevent memory issues
 */
const MAX_EXPORT_LIMIT = 50000;

/**
 * Default batch size for pagination
 */
const DEFAULT_BATCH_SIZE = 5000;

interface MessageExportOptions {
  contactId?: string;
  startDate?: Date;
  endDate?: Date;
  messageTypes?: string[];
  limit?: number;
  offset?: number;
  assignedUserId?: string;
}

interface MessageCursor {
  timestamp: Date;
  id: string;
}

interface MessageQueryOptions extends MessageExportOptions {
  cursor?: MessageCursor;
}

/**
 * Export messages to array with proper parameterized queries
 * Supports offset pagination for the public export endpoint.
 */
export async function exportMessages(
  companyId: string,
  options: MessageExportOptions = {},
): Promise<MessageExport[]> {
  return (await queryMessages(companyId, options)).messages;
}

/**
 * Execute the tenant-scoped message query and retain the last database key for
 * stable keyset pagination by internal batch consumers.
 */
async function queryMessages(
  companyId: string,
  options: MessageQueryOptions,
): Promise<{ messages: MessageExport[]; nextCursor?: MessageCursor }> {
  const tenantDb = getTenantConnection(companyId);

  // Validate and sanitize limit
  const limit = Math.min(
    Math.max(1, options.limit ?? MAX_EXPORT_LIMIT),
    MAX_EXPORT_LIMIT,
  );
  const offset = Math.max(0, options.offset ?? 0);

  // Validate message types to prevent injection (whitelist approach)
  const hasMessageTypeFilter = Boolean(options.messageTypes?.length);
  const validatedMessageTypes = options.messageTypes?.filter((t) =>
    VALID_MESSAGE_TYPES.includes(t as (typeof VALID_MESSAGE_TYPES)[number]),
  );

  // Raw SQL needs explicit tenant qualification; values remain parameters.
  const schemaName = getSchemaName(companyId);
  const messagesTable = sql.table(`${schemaName}.messages`);
  const contactsTable = sql.table(`${schemaName}.contacts`);
  const assignmentsTable = sql.table(`${schemaName}.contact_assignments`);

  // Build optional WHERE clauses using Kysely's parameterized sql template
  const contactIdFilter = options.contactId
    ? sql`AND m.contact_id = ${options.contactId}`
    : sql``;
  const startDateFilter = options.startDate
    ? sql`AND m.timestamp >= ${options.startDate}`
    : sql``;
  const endDateFilter = options.endDate
    ? sql`AND m.timestamp <= ${options.endDate}`
    : sql``;
  const messageTypesFilter = !hasMessageTypeFilter
    ? sql``
    : validatedMessageTypes && validatedMessageTypes.length > 0
      ? sql`AND m.message_type::text = ANY(${validatedMessageTypes}::text[])`
      : sql`AND false`;
  const cursorFilter = options.cursor
    ? sql`AND (m.timestamp, m.id) < (${options.cursor.timestamp}, ${options.cursor.id})`
    : sql``;

  // Use parameterized raw SQL query for complex joins with aliases
  const result = await sql<{
    export_cursor_id: string;
    message_id: string | null;
    contact_whatsapp_id: string;
    contact_name: string | null;
    from_me: boolean;
    message_type: string | null;
    text_content: string | null;
    timestamp: Date;
    sent_by_user: string | null;
    media_url: string | null;
  }>`
    SELECT
      m.id as export_cursor_id,
      m.message_id,
      c.jid as contact_whatsapp_id,
      c.custom_name as contact_name,
      m.from_me,
      m.message_type,
      m.content as text_content,
      m.timestamp,
      m.sent_by_user_id as sent_by_user,
      m.media_url
    FROM ${messagesTable} m
    INNER JOIN ${contactsTable} c ON c.id = m.contact_id
    ${
      options.assignedUserId
        ? sql`INNER JOIN ${assignmentsTable} ca
            ON ca.contact_id = c.id
            AND ca.assigned_to = ${options.assignedUserId}
            AND ca.unassigned_at IS NULL`
        : sql``
    }
    WHERE 1=1
      ${contactIdFilter}
      ${startDateFilter}
      ${endDateFilter}
      ${messageTypesFilter}
      ${cursorFilter}
    ORDER BY m.timestamp DESC, m.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(tenantDb);

  const lastRow = result.rows.at(-1);
  return {
    messages: result.rows.map((m) => ({
      message_id: m.message_id || "",
      contact_whatsapp_id: m.contact_whatsapp_id,
      contact_name: m.contact_name,
      direction: m.from_me ? ("sent" as const) : ("received" as const),
      message_type: m.message_type || "text",
      text_content: m.text_content,
      timestamp: toISOString(m.timestamp),
      sent_by_user: m.sent_by_user,
      has_media: !!m.media_url,
    })),
    nextCursor: lastRow
      ? { timestamp: lastRow.timestamp, id: lastRow.export_cursor_id }
      : undefined,
  };
}

/**
 * Export messages in batches for very large conversations
 * Uses streaming approach to avoid memory issues
 */
export async function exportMessagesInBatches(
  companyId: string,
  options: {
    contactId?: string;
    startDate?: Date;
    endDate?: Date;
    messageTypes?: string[];
    batchSize?: number;
    onBatch?: (messages: MessageExport[], batchNumber: number) => Promise<void>;
    assignedUserId?: string;
  } = {},
): Promise<{ totalExported: number; batches: number }> {
  const batchSize = Math.min(
    Math.max(100, options.batchSize || DEFAULT_BATCH_SIZE),
    MAX_EXPORT_LIMIT,
  );

  let cursor: MessageCursor | undefined;
  let batchNumber = 0;
  let totalExported = 0;

  while (true) {
    const batch = await queryMessages(companyId, {
      contactId: options.contactId,
      startDate: options.startDate,
      endDate: options.endDate,
      messageTypes: options.messageTypes,
      limit: batchSize,
      assignedUserId: options.assignedUserId,
      cursor,
    });
    const { messages } = batch;

    if (messages.length === 0) {
      break;
    }

    batchNumber++;
    totalExported += messages.length;

    if (options.onBatch) {
      await options.onBatch(messages, batchNumber);
    }

    if (messages.length < batchSize || !batch.nextCursor) {
      break; // Last batch
    }

    cursor = batch.nextCursor;
  }

  return { totalExported, batches: batchNumber };
}

/**
 * Export conversation (messages for a specific contact)
 */
export async function exportConversation(
  companyId: string,
  contactId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    assignedUserId?: string;
  } = {},
): Promise<{
  contact: ContactExport;
  messages: MessageExport[];
}> {
  const tenantDb = getTenantConnection(companyId);

  // Raw SQL needs explicit tenant qualification; values remain parameters.
  const schemaName = getSchemaName(companyId);
  const contactsTable = sql.table(`${schemaName}.contacts`);
  const contactTagsTable = sql.table(`${schemaName}.contact_tags`);
  const tagsTable = sql.table(`${schemaName}.tags`);
  const assignmentsTable = sql.table(`${schemaName}.contact_assignments`);
  const messagesTable = sql.table(`${schemaName}.messages`);

  // Get contact
  const contactResult = await sql<{
    whatsapp_id: string;
    phone_number: string | null;
    push_name: string | null;
    custom_name: string | null;
    shared_notes: string | null;
    tags: string | null;
    assigned_to: string | null;
    created_at: Date;
    last_message_at: Date | null;
  }>`
    SELECT
      c.jid as whatsapp_id,
      c.phone_number,
      c.push_name,
      c.custom_name,
      c.notes_shared as shared_notes,
      STRING_AGG(t.name, ',' ORDER BY t.name) as tags,
      ca.assigned_to,
      c.created_at,
      lm.last_message_at
    FROM ${contactsTable} c
    LEFT JOIN ${contactTagsTable} ct ON ct.contact_id = c.id
    LEFT JOIN ${tagsTable} t ON t.id = ct.tag_id
    LEFT JOIN ${assignmentsTable} ca
      ON ca.contact_id = c.id AND ca.unassigned_at IS NULL
    LEFT JOIN LATERAL (
      SELECT MAX(m.timestamp) as last_message_at
      FROM ${messagesTable} m
      WHERE m.contact_id = c.id
    ) lm ON true
    WHERE c.id = ${contactId}
      ${
        options.assignedUserId
          ? sql`AND ca.assigned_to = ${options.assignedUserId}`
          : sql``
      }
    GROUP BY c.id, c.jid, c.phone_number, c.push_name, c.custom_name,
             c.notes_shared, c.created_at, lm.last_message_at, ca.assigned_to
  `.execute(tenantDb);

  if (contactResult.rows.length === 0) {
    throw new NotFoundError("Contact");
  }

  const c = contactResult.rows[0];

  // Get every message in stable keyset-paginated batches. The conversation
  // route has no pagination contract, so silently truncating is not acceptable.
  const messages: MessageExport[] = [];
  await exportMessagesInBatches(companyId, {
    contactId,
    ...options,
    onBatch: async (batch) => {
      messages.push(...batch);
    },
  });

  return {
    contact: {
      whatsapp_id: c.whatsapp_id,
      phone_number: c.phone_number,
      push_name: c.push_name,
      custom_name: c.custom_name,
      shared_notes: c.shared_notes,
      tags: c.tags || "",
      assigned_to: c.assigned_to,
      created_at: toISOString(c.created_at),
      last_message_at: c.last_message_at
        ? toISOString(c.last_message_at)
        : null,
    },
    messages: messages.reverse(), // Chronological order
  };
}

// Re-export types for backward compatibility
export type { FullBackupData as FullBackupExport } from "./export/compression.js";
// Re-export CSV function for backward compatibility
export { toCSV } from "./export/csv.js";

/**
 * Export full backup as ZIP file
 * Includes all contacts, messages, and a README
 * Uses async compression to avoid blocking the event loop
 */
export async function exportFullBackup(
  companyId: string,
  options: BackupZipOptions = {},
): Promise<Uint8Array> {
  // Include group contacts because message backup includes group messages.
  const contacts = await exportContacts(companyId, { includeGroups: true });

  // Get all messages with date filters using batched approach for large datasets
  const allMessages: MessageExport[] = [];
  await exportMessagesInBatches(companyId, {
    startDate: options.startDate,
    endDate: options.endDate,
    batchSize: DEFAULT_BATCH_SIZE,
    onBatch: async (messages) => {
      allMessages.push(...messages);
    },
  });

  // Calculate stats
  let earliestMessageTimestamp = Number.POSITIVE_INFINITY;
  let latestMessageTimestamp = Number.NEGATIVE_INFINITY;
  for (const message of allMessages) {
    const timestamp = dayjs(message.timestamp).valueOf();
    if (!isNaN(timestamp)) {
      earliestMessageTimestamp = Math.min(earliestMessageTimestamp, timestamp);
      latestMessageTimestamp = Math.max(latestMessageTimestamp, timestamp);
    }
  }
  const hasMessageTimestamps = Number.isFinite(earliestMessageTimestamp);

  const stats = {
    totalContacts: contacts.length,
    totalMessages: allMessages.length,
    dateRange: {
      start: hasMessageTimestamps
        ? dayjs(earliestMessageTimestamp).toISOString()
        : null,
      end: hasMessageTimestamps
        ? dayjs(latestMessageTimestamp).toISOString()
        : null,
    },
  };

  // Create full backup data
  const backupData: FullBackupData = {
    exportedAt: toISOString(),
    contacts,
    messages: allMessages,
    stats,
  };

  // Generate ZIP file using compression module
  return generateBackupZip(backupData, options);
}
