import { sql } from "kysely";
import { toISOString, dayjs } from "@whatsapp-web/shared";
import { getTenantConnection } from "./tenant.service.js";
import { NotFoundError } from "../lib/errors.js";
import { toCSV } from "./export/csv.js";
import {
  generateBackupZip,
  type FullBackupData,
  type BackupZipOptions,
} from "./export/compression.js";

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
  } = {},
): Promise<ContactExport[]> {
  const tenantDb = getTenantConnection(companyId);

  // Build WHERE conditions
  const conditions: string[] = ["c.is_group = false"];
  const params: unknown[] = [];

  if (options.tagIds && options.tagIds.length > 0) {
    conditions.push(`ct.tag_id = ANY($${params.length + 1})`);
    params.push(options.tagIds);
  }
  if (options.assignedTo) {
    conditions.push(`ca.assigned_to = $${params.length + 1}`);
    params.push(options.assignedTo);
  }
  if (options.hasCustomName) {
    conditions.push("c.custom_name IS NOT NULL");
  }

  const whereClause = conditions.join(" AND ");

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
      c.whatsapp_id,
      c.phone_number,
      c.push_name,
      c.custom_name,
      c.shared_notes,
      STRING_AGG(t.name, ',') as tags,
      ca.assigned_to,
      c.created_at,
      c.last_message_at
    FROM contacts c
    LEFT JOIN contact_tags ct ON ct.contact_id = c.id
    LEFT JOIN tags t ON t.id = ct.tag_id
    LEFT JOIN contact_assignments ca ON ca.contact_id = c.id AND ca.unassigned_at IS NULL
    WHERE ${sql.raw(whereClause)}
    GROUP BY c.id, c.whatsapp_id, c.phone_number, c.push_name, c.custom_name,
             c.shared_notes, c.created_at, c.last_message_at, ca.assigned_to
    ORDER BY c.last_message_at DESC NULLS LAST
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

/**
 * Export messages to array with proper parameterized queries
 * Supports pagination for large conversations
 */
export async function exportMessages(
  companyId: string,
  options: {
    contactId?: string;
    startDate?: Date;
    endDate?: Date;
    messageTypes?: string[];
    limit?: number;
    offset?: number;
  } = {},
): Promise<MessageExport[]> {
  const tenantDb = getTenantConnection(companyId);

  // Validate and sanitize limit
  const limit = Math.min(
    Math.max(1, options.limit || MAX_EXPORT_LIMIT),
    MAX_EXPORT_LIMIT,
  );
  const offset = Math.max(0, options.offset || 0);

  // Validate message types to prevent injection (whitelist approach)
  const validatedMessageTypes = options.messageTypes?.filter((t) =>
    VALID_MESSAGE_TYPES.includes(t as (typeof VALID_MESSAGE_TYPES)[number]),
  );

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
  const messageTypesFilter =
    validatedMessageTypes && validatedMessageTypes.length > 0
      ? sql`AND m.message_type = ANY(${validatedMessageTypes}::text[])`
      : sql``;

  // Use parameterized raw SQL query for complex joins with aliases
  const result = await sql<{
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
      m.message_id,
      c.whatsapp_id as contact_whatsapp_id,
      c.custom_name as contact_name,
      m.from_me,
      m.message_type,
      m.text_content,
      m.timestamp,
      m.sent_by_user_id as sent_by_user,
      m.media_url
    FROM messages m
    INNER JOIN contacts c ON c.id = m.contact_id
    WHERE 1=1
      ${contactIdFilter}
      ${startDateFilter}
      ${endDateFilter}
      ${messageTypesFilter}
    ORDER BY m.timestamp DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `.execute(tenantDb);

  return result.rows.map((m) => ({
    message_id: m.message_id || "",
    contact_whatsapp_id: m.contact_whatsapp_id,
    contact_name: m.contact_name,
    direction: m.from_me ? ("sent" as const) : ("received" as const),
    message_type: m.message_type || "text",
    text_content: m.text_content,
    timestamp: toISOString(m.timestamp),
    sent_by_user: m.sent_by_user,
    has_media: !!m.media_url,
  }));
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
  } = {},
): Promise<{ totalExported: number; batches: number }> {
  const batchSize = Math.min(
    Math.max(100, options.batchSize || DEFAULT_BATCH_SIZE),
    MAX_EXPORT_LIMIT,
  );

  let offset = 0;
  let batchNumber = 0;
  let totalExported = 0;

  while (true) {
    const messages = await exportMessages(companyId, {
      contactId: options.contactId,
      startDate: options.startDate,
      endDate: options.endDate,
      messageTypes: options.messageTypes,
      limit: batchSize,
      offset,
    });

    if (messages.length === 0) {
      break;
    }

    batchNumber++;
    totalExported += messages.length;

    if (options.onBatch) {
      await options.onBatch(messages, batchNumber);
    }

    if (messages.length < batchSize) {
      break; // Last batch
    }

    offset += batchSize;
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
  } = {},
): Promise<{
  contact: ContactExport;
  messages: MessageExport[];
}> {
  const tenantDb = getTenantConnection(companyId);

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
      c.whatsapp_id,
      c.phone_number,
      c.push_name,
      c.custom_name,
      c.shared_notes,
      STRING_AGG(t.name, ',') as tags,
      ca.assigned_to,
      c.created_at,
      c.last_message_at
    FROM contacts c
    LEFT JOIN contact_tags ct ON ct.contact_id = c.id
    LEFT JOIN tags t ON t.id = ct.tag_id
    LEFT JOIN contact_assignments ca ON ca.contact_id = c.id AND ca.unassigned_at IS NULL
    WHERE c.id = ${contactId}
    GROUP BY c.id, c.whatsapp_id, c.phone_number, c.push_name, c.custom_name,
             c.shared_notes, c.created_at, c.last_message_at, ca.assigned_to
  `.execute(tenantDb);

  if (contactResult.rows.length === 0) {
    throw new NotFoundError("Contact");
  }

  const c = contactResult.rows[0];

  // Get messages
  const messages = await exportMessages(companyId, {
    contactId,
    ...options,
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

// Re-export CSV function for backward compatibility
export { toCSV } from "./export/csv.js";

// Re-export types for backward compatibility
export type { FullBackupData as FullBackupExport } from "./export/compression.js";

/**
 * Export full backup as ZIP file
 * Includes all contacts, messages, and a README
 * Uses async compression to avoid blocking the event loop
 */
export async function exportFullBackup(
  companyId: string,
  options: BackupZipOptions = {},
): Promise<Uint8Array> {
  // Get all contacts
  const contacts = await exportContacts(companyId);

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
  const messageTimestamps = allMessages
    .map((m) => dayjs(m.timestamp).valueOf())
    .filter((t) => !isNaN(t));

  const stats = {
    totalContacts: contacts.length,
    totalMessages: allMessages.length,
    dateRange: {
      start:
        messageTimestamps.length > 0
          ? dayjs(Math.min(...messageTimestamps)).toISOString()
          : null,
      end:
        messageTimestamps.length > 0
          ? dayjs(Math.max(...messageTimestamps)).toISOString()
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
