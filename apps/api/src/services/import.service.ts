import type { TenantDatabase } from "@whatsapp-web/database";
import type { Kysely, Transaction } from "kysely";

/**
 * Validation error during import - doesn't abort transaction
 * Used for data validation issues like invalid phone numbers
 */
export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

/**
 * Critical error during import - causes transaction rollback
 * Used for database errors and other critical failures
 */
export class ImportCriticalError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ImportCriticalError";
  }
}

/**
 * Contact import row from CSV/Excel
 *
 * @remarks
 * Represents a single row from an imported CSV/Excel file.
 * The `tags` field should contain comma-separated tag names.
 */
export interface ContactImportRow {
  /** Phone number in any format (will be normalized) */
  phone_number: string;
  /** Optional custom display name */
  custom_name?: string;
  /** Optional notes/shared notes */
  notes?: string;
  /** Comma-separated tag names (e.g., "VIP,Lead,Customer") */
  tags?: string;
}

/**
 * Import result for a single contact
 *
 * @remarks
 * Represents the result of importing a single contact row.
 * The status indicates what happened: created, updated, skipped, or error.
 */
export interface ContactImportResult {
  /** Row number in the original import (1-indexed) */
  row: number;
  /** Original phone number from the import */
  phoneNumber: string;
  /** Import status for this contact */
  status: "created" | "updated" | "skipped" | "error";
  /** Error message if status is 'error' */
  error?: string;
  /** Database ID of the contact (if created/updated) */
  contactId?: string;
}

/**
 * Import summary
 *
 * @remarks
 * Aggregated results from a contact import operation.
 * All counts are cumulative; `total` equals `created + updated + skipped + errors`.
 */
export interface ImportSummary {
  /** Total number of rows processed */
  total: number;
  /** Number of new contacts created */
  created: number;
  /** Number of existing contacts updated */
  updated: number;
  /** Number of contacts skipped (not currently used, reserved for future) */
  skipped: number;
  /** Number of rows with validation errors (these don't cause rollback) */
  errors: number;
  /** Detailed results for each row */
  results: ContactImportResult[];
}

/**
 * Parse CSV content to array of objects
 *
 * @remarks
 * Parses CSV content with support for quoted values and escaped quotes.
 * Column names are normalized to lowercase with underscores (e.g., "Phone Number" → "phone_number").
 *
 * @param content - Raw CSV content as a string
 * @returns Array of objects where keys are normalized column names
 *
 * @example
 * ```ts
 * const csv = 'phone_number,name\n+1234567890,John Doe'
 * const rows = parseCSV(csv)
 * // => [{ phone_number: '+1234567890', name: 'John Doe' }]
 * ```
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
 *
 * @remarks
 * Supports:
 * - Quoted values containing commas: `"Doe, John",+1234567890`
 * - Escaped quotes within quoted values: `"John ""The Boss"" Doe"`
 *
 * @param line - A single line from a CSV file
 * @returns Array of parsed string values
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
 *
 * @remarks
 * Strips all non-digit characters (except +), removes leading + or 00,
 * and formats the number for WhatsApp messaging.
 *
 * The JID (Jabber ID) format is required by WhatsApp's internal protocol.
 *
 * @param phone - Phone number in any format
 * @returns Object containing the JID and cleaned phone number
 *
 * @example
 * ```ts
 * normalizePhoneNumber('+1 (234) 567-8900')
 * // => { jid: '12345678900@s.whatsapp.net', phoneNumber: '12345678900' }
 * ```
 */
export function normalizePhoneNumber(phone: string): {
  /** WhatsApp JID format for messaging */
  jid: string;
  /** Cleaned phone number (digits only) */
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
 *
 * @remarks
 * Handles flexible column naming conventions. Searches for phone number,
 * name, notes, and tags across various common column names.
 *
 * Supported phone number columns: phone_number, phone, phonenumber, mobile, cell, whatsapp, number
 * Supported name columns: custom_name, name, full_name, fullname, display_name, displayname, contact_name
 * Supported notes columns: notes, note, shared_notes, description
 * Supported tag columns: tags, tag, labels, label
 *
 * @param row - A parsed CSV row object
 * @returns ContactImportRow or null if no phone number is found
 *
 * @example
 * ```ts
 * mapToContactRow({ phone: '+1234567890', Name: 'John Doe', Tags: 'VIP,Lead' })
 * // => { phone_number: '+1234567890', custom_name: 'John Doe', tags: 'VIP,Lead' }
 * ```
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
 *
 * @remarks
 * **Transaction Behavior:**
 * All database operations are performed within a single transaction for atomicity.
 * - On success: All changes (contacts + tags) are committed together
 * - On critical error: All changes are rolled back, leaving the database unchanged
 * - On validation error: The error is logged but processing continues (transaction commits)
 *
 * **Error Handling Strategy:**
 * Errors are categorized into two types:
 *
 * 1. **Validation Errors** ({@link ImportValidationError}): Non-fatal errors that don't abort the import
 *    - Invalid phone numbers (too short, missing digits)
 *    - Duplicate contacts when `updateExisting=false`
 *    - These errors increment the `errors` count but allow other rows to be processed
 *
 * 2. **Critical Errors** ({@link ImportCriticalError}): Fatal errors that trigger rollback
 *    - Database connection failures
 *    - Constraint violations
 *    - Unexpected runtime errors
 *    - These cause the entire transaction to roll back
 *
 * **Tag Pre-fetching:**
 * Existing tags are fetched once at the start of the transaction and cached in a Map.
 * This avoids N+1 queries and ensures all tag operations use the same transaction.
 *
 * **Performance Note:**
 * Large imports (10,000+ rows) in a single transaction may cause performance concerns.
 * A future enhancement could implement chunked transactions for better performance.
 *
 * @param tenantDb - Database connection (will be wrapped in a transaction)
 * @param rows - Contact rows to import
 * @param userId - ID of the user performing the import
 * @param options - Import options
 * @param options.updateExisting - If true, update existing contacts; if false, skip them (default: true)
 * @param options.createTags - If true, create tags that don't exist; if false, only use existing tags (default: true)
 * @returns Summary of import results with counts and detailed results per row
 *
 * @throws {ImportCriticalError} When a critical database error occurs, triggering rollback
 *
 * @example
 * ```ts
 * const summary = await importContacts(db, rows, 'user-123', { updateExisting: true })
 * console.log(`Imported ${summary.created} new, ${summary.updated} updated, ${summary.errors} errors`)
 * ```
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

  // Initialize summary counters
  const summary: ImportSummary = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  // Execute all database operations within a transaction
  // - Transaction commits automatically if callback completes successfully
  // - Transaction rolls back automatically if callback throws an error
  // - Validation errors are caught inside the transaction, so they don't cause rollback
  return await tenantDb.transaction().execute(async (trx) => {
    // Pre-fetch existing tags within the transaction
    // This is done inside the transaction to ensure consistency
    // The tagMap is passed to handleContactTags to avoid duplicate lookups
    const existingTags = await trx
      .selectFrom("tags")
      .select(["id", "name"])
      .execute();

    const tagMap = new Map(
      existingTags.map((t) => [t.name.toLowerCase(), t.id]),
    );

    // Process each contact row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const result: ContactImportResult = {
        row: i + 1,
        phoneNumber: row.phone_number,
        status: "error",
      };

      try {
        const { jid, phoneNumber } = normalizePhoneNumber(row.phone_number);

        // Validation: Phone number must have at least 6 digits
        if (!phoneNumber || phoneNumber.length < 6) {
          throw new ImportValidationError("Invalid phone number");
        }

        // Check if contact already exists (by JID or phone number)
        const existingContact = await trx
          .selectFrom("contacts")
          .select(["id"])
          .where((eb) =>
            eb.or([eb("jid", "=", jid), eb("phone_number", "=", phoneNumber)]),
          )
          .executeTakeFirst();

        if (existingContact) {
          // Contact exists - handle based on updateExisting flag
          if (!updateExisting) {
            throw new ImportValidationError("Contact already exists");
          }

          // Update existing contact with new values
          const updateData: Record<string, unknown> = {
            updated_at: new Date(),
          };

          if (row.custom_name) {
            updateData.custom_name = row.custom_name;
          }
          if (row.notes) {
            updateData.notes_shared = row.notes;
          }

          await trx
            .updateTable("contacts")
            .set(updateData)
            .where("id", "=", existingContact.id)
            .execute();

          result.status = "updated";
          result.contactId = existingContact.id;
          summary.updated++;

          // Handle tags for existing contact (same transaction)
          if (row.tags && createTags) {
            await handleContactTags(
              trx,
              existingContact.id,
              row.tags,
              tagMap,
              userId,
            );
          }
        } else {
          // Contact doesn't exist - create new one
          const newContact = await trx
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

            // Handle tags for new contact (same transaction)
            if (row.tags && createTags) {
              await handleContactTags(
                trx,
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
        // --- Error Handling Strategy ---
        // Validation errors: log and continue processing other rows
        if (error instanceof ImportValidationError) {
          result.error = error.message;
          result.status = "error";
          summary.errors++;
          summary.results.push(result);
        } else {
          // Critical errors: wrap and propagate to trigger full transaction rollback
          throw new ImportCriticalError(
            `Failed to import contact at row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
            error,
          );
        }
      }
    }

    return summary;
  });
}

/**
 * Handle tags for a contact during import
 *
 * @remarks
 * Accepts either a Kysely instance or a Transaction for atomic operations.
 * When called from {@link importContacts}, it receives a transaction object,
 * ensuring that tag creation and assignment are part of the same atomic operation.
 *
 * **Tag Creation:**
 * - If a tag doesn't exist, it's created with a random color from a predefined palette
 * - The newly created tag's ID is added to the tagMap cache for subsequent rows
 *
 * **Tag Assignment:**
 * - Checks if the tag is already assigned to the contact to avoid duplicates
 * - Only assigns if the tag-contact relationship doesn't already exist
 *
 * **Transaction Safety:**
 * When passed a Transaction object, all tag operations (create, check, assign)
 * are part of the same transaction that includes contact creation/update.
 *
 * @param db - Database connection (Kysely instance or Transaction)
 * @param contactId - ID of the contact to assign tags to
 * @param tagsString - Comma-separated tag names (e.g., "VIP,Lead,Customer")
 * @param tagMap - Cache of existing tags (name -> ID mapping), updated in-place
 * @param userId - ID of the user performing the import (used for tag creation)
 */
async function handleContactTags(
  db: Kysely<TenantDatabase> | Transaction<TenantDatabase>,
  contactId: string,
  tagsString: string,
  tagMap: Map<string, string>,
  userId: string,
): Promise<void> {
  // Parse comma-separated tag names, trimming whitespace and filtering empty strings
  const tagNames = tagsString
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Process each tag
  for (const tagName of tagNames) {
    // Check cache first (case-insensitive lookup)
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

      const newTag = await db
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
        // Update cache for subsequent rows in the same import
        tagMap.set(tagName.toLowerCase(), tagId);
      }
    }

    if (tagId) {
      // Check if tag is already assigned to this contact
      const existing = await db
        .selectFrom("contact_tags")
        .select(["contact_id"])
        .where("contact_id", "=", contactId)
        .where("tag_id", "=", tagId)
        .executeTakeFirst();

      // Only assign if not already assigned
      if (!existing) {
        await db
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
 *
 * @remarks
 * Creates a downloadable CSV template that users can fill in with their contact data.
 * The template includes example rows showing the expected format.
 *
 * @returns CSV-formatted string with header and sample rows
 *
 * @example
 * ```ts
 * const csv = generateImportTemplate()
 * // => "phone_number,name,notes,tags\n+1234567890,John Doe,Important customer,VIP,Lead\n..."
 * ```
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
