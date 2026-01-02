import { sql } from "kysely";
import { getTenantConnection } from "./tenant.service.js";

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
    created_at:
      c.created_at instanceof Date
        ? c.created_at.toISOString()
        : String(c.created_at),
    last_message_at: c.last_message_at
      ? c.last_message_at instanceof Date
        ? c.last_message_at.toISOString()
        : String(c.last_message_at)
      : null,
  }));
}

/**
 * Export messages to array
 */
export async function exportMessages(
  companyId: string,
  options: {
    contactId?: string;
    startDate?: Date;
    endDate?: Date;
    messageTypes?: string[];
    limit?: number;
  } = {},
): Promise<MessageExport[]> {
  const tenantDb = getTenantConnection(companyId);

  // Build WHERE conditions
  const conditions: string[] = ["1=1"];

  if (options.contactId) {
    conditions.push(`m.contact_id = '${options.contactId}'`);
  }
  if (options.startDate) {
    conditions.push(`m.timestamp >= '${options.startDate.toISOString()}'`);
  }
  if (options.endDate) {
    conditions.push(`m.timestamp <= '${options.endDate.toISOString()}'`);
  }
  if (options.messageTypes && options.messageTypes.length > 0) {
    const types = options.messageTypes.map((t) => `'${t}'`).join(",");
    conditions.push(`m.message_type IN (${types})`);
  }

  const whereClause = conditions.join(" AND ");
  const limitClause = options.limit ? `LIMIT ${options.limit}` : "";

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
    WHERE ${sql.raw(whereClause)}
    ORDER BY m.timestamp DESC
    ${sql.raw(limitClause)}
  `.execute(tenantDb);

  return result.rows.map((m) => ({
    message_id: m.message_id || "",
    contact_whatsapp_id: m.contact_whatsapp_id,
    contact_name: m.contact_name,
    direction: m.from_me ? ("sent" as const) : ("received" as const),
    message_type: m.message_type || "text",
    text_content: m.text_content,
    timestamp:
      m.timestamp instanceof Date
        ? m.timestamp.toISOString()
        : String(m.timestamp),
    sent_by_user: m.sent_by_user,
    has_media: !!m.media_url,
  }));
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
    throw new Error("Contact not found");
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
      created_at:
        c.created_at instanceof Date
          ? c.created_at.toISOString()
          : String(c.created_at),
      last_message_at: c.last_message_at
        ? c.last_message_at instanceof Date
          ? c.last_message_at.toISOString()
          : String(c.last_message_at)
        : null,
    },
    messages: messages.reverse(), // Chronological order
  };
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV(
  data: Record<string, unknown>[],
  columns?: string[],
): string {
  if (data.length === 0) return "";

  const keys = columns || Object.keys(data[0]);
  const header = keys.join(",");

  const rows = data.map((row) =>
    keys
      .map((key) => {
        const value = row[key];
        if (value === null || value === undefined) return "";
        const str = String(value);
        // Escape quotes and wrap in quotes if contains comma or newline
        if (str.includes(",") || str.includes("\n") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(","),
  );

  return [header, ...rows].join("\n");
}
