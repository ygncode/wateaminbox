import type { Kysely } from "kysely";
import type { TenantDatabase } from "@whatsapp-web/database";

/**
 * Contact import row from CSV/Excel
 */
export interface ContactImportRow {
  phone_number: string;
  custom_name?: string;
  notes?: string;
  tags?: string; // Comma-separated tag names
}

/**
 * Import result for a single contact
 */
export interface ContactImportResult {
  row: number;
  phoneNumber: string;
  status: "created" | "updated" | "skipped" | "error";
  error?: string;
  contactId?: string;
}

/**
 * Import summary
 */
export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  results: ContactImportResult[];
}

/**
 * Parse CSV content to array of objects
 */
export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  // Parse header
  const header = parseCSVLine(lines[0]);

  // Parse rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === ""))
      continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j].toLowerCase().trim().replace(/\s+/g, "_");
      row[key] = values[j] || "";
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Normalize phone number to WhatsApp JID format
 * Strips non-digits and adds @s.whatsapp.net suffix
 */
export function normalizePhoneNumber(phone: string): {
  jid: string;
  phoneNumber: string;
} {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // Remove leading + if present
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // Remove leading zeros (some formats use 00 for international)
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.substring(2);
  }

  return {
    jid: `${cleaned}@s.whatsapp.net`,
    phoneNumber: cleaned,
  };
}

/**
 * Map CSV row to contact import row
 */
export function mapToContactRow(
  row: Record<string, string>,
): ContactImportRow | null {
  // Look for phone number in various column names
  const phoneNumber =
    row.phone_number ||
    row.phone ||
    row.phonenumber ||
    row.mobile ||
    row.cell ||
    row.whatsapp ||
    row.number ||
    "";

  if (!phoneNumber) return null;

  // Look for name in various column names
  const customName =
    row.custom_name ||
    row.name ||
    row.full_name ||
    row.fullname ||
    row.display_name ||
    row.displayname ||
    row.contact_name ||
    "";

  // Look for notes
  const notes =
    row.notes || row.note || row.shared_notes || row.description || "";

  // Look for tags
  const tags = row.tags || row.tag || row.labels || row.label || "";

  return {
    phone_number: phoneNumber,
    custom_name: customName || undefined,
    notes: notes || undefined,
    tags: tags || undefined,
  };
}

/**
 * Import contacts from parsed data
 */
export async function importContacts(
  tenantDb: Kysely<TenantDatabase>,
  rows: ContactImportRow[],
  userId: string,
  options: {
    updateExisting?: boolean;
    createTags?: boolean;
  } = {},
): Promise<ImportSummary> {
  const { updateExisting = true, createTags = true } = options;

  const summary: ImportSummary = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  // Pre-fetch existing tags
  const existingTags = await tenantDb
    .selectFrom("tags")
    .select(["id", "name"])
    .execute();

  const tagMap = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.id]));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result: ContactImportResult = {
      row: i + 1,
      phoneNumber: row.phone_number,
      status: "error",
    };

    try {
      const { jid, phoneNumber } = normalizePhoneNumber(row.phone_number);

      if (!phoneNumber || phoneNumber.length < 6) {
        result.error = "Invalid phone number";
        result.status = "error";
        summary.errors++;
        summary.results.push(result);
        continue;
      }

      // Check if contact exists
      const existingContact = await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .where((eb) =>
          eb.or([eb("jid", "=", jid), eb("phone_number", "=", phoneNumber)]),
        )
        .executeTakeFirst();

      if (existingContact) {
        if (!updateExisting) {
          result.status = "skipped";
          result.contactId = existingContact.id;
          summary.skipped++;
          summary.results.push(result);
          continue;
        }

        // Update existing contact
        const updateData: Record<string, unknown> = {
          updated_at: new Date(),
        };

        if (row.custom_name) {
          updateData.custom_name = row.custom_name;
        }
        if (row.notes) {
          updateData.notes_shared = row.notes;
        }

        await tenantDb
          .updateTable("contacts")
          .set(updateData)
          .where("id", "=", existingContact.id)
          .execute();

        result.status = "updated";
        result.contactId = existingContact.id;
        summary.updated++;

        // Handle tags for existing contact
        if (row.tags && createTags) {
          await handleContactTags(
            tenantDb,
            existingContact.id,
            row.tags,
            tagMap,
            userId,
          );
        }
      } else {
        // Create new contact
        const newContact = await tenantDb
          .insertInto("contacts")
          .values({
            jid,
            phone_number: phoneNumber,
            custom_name: row.custom_name || null,
            notes_shared: row.notes || null,
            is_group: false,
          })
          .returning(["id"])
          .executeTakeFirst();

        if (newContact) {
          result.status = "created";
          result.contactId = newContact.id;
          summary.created++;

          // Handle tags for new contact
          if (row.tags && createTags) {
            await handleContactTags(
              tenantDb,
              newContact.id,
              row.tags,
              tagMap,
              userId,
            );
          }
        }
      }

      summary.results.push(result);
    } catch (error) {
      result.error =
        error instanceof Error ? error.message : "Unknown error occurred";
      result.status = "error";
      summary.errors++;
      summary.results.push(result);
    }
  }

  return summary;
}

/**
 * Handle tags for a contact during import
 */
async function handleContactTags(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  tagsString: string,
  tagMap: Map<string, string>,
  userId: string,
): Promise<void> {
  const tagNames = tagsString
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const tagName of tagNames) {
    let tagId = tagMap.get(tagName.toLowerCase());

    // Create tag if it doesn't exist
    if (!tagId) {
      const colors = [
        "#ef4444",
        "#f97316",
        "#eab308",
        "#22c55e",
        "#14b8a6",
        "#3b82f6",
        "#8b5cf6",
        "#ec4899",
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const newTag = await tenantDb
        .insertInto("tags")
        .values({
          name: tagName,
          color: randomColor,
          created_by: userId,
        })
        .returning(["id"])
        .executeTakeFirst();

      if (newTag) {
        tagId = newTag.id;
        tagMap.set(tagName.toLowerCase(), tagId);
      }
    }

    if (tagId) {
      // Check if tag already assigned
      const existing = await tenantDb
        .selectFrom("contact_tags")
        .select(["contact_id"])
        .where("contact_id", "=", contactId)
        .where("tag_id", "=", tagId)
        .executeTakeFirst();

      if (!existing) {
        await tenantDb
          .insertInto("contact_tags")
          .values({
            contact_id: contactId,
            tag_id: tagId,
          })
          .execute();
      }
    }
  }
}

/**
 * Generate a sample CSV template for contact import
 */
export function generateImportTemplate(): string {
  const header = "phone_number,name,notes,tags";
  const sampleRows = [
    "+1234567890,John Doe,Important customer,VIP,Lead",
    "+0987654321,Jane Smith,Follow up next week,Lead",
    "1122334455,Bob Wilson,,Customer",
  ];

  return [header, ...sampleRows].join("\n");
}
