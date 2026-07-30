import type { TenantDatabase } from "@wateaminbox/database";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../../lib/errors.js";
import { ImportCriticalError, ImportValidationError } from "./errors.js";
import type {
  ContactImportResult,
  ContactImportRow,
  ImportSummary,
} from "./types.js";
import { normalizePhoneNumber } from "./validation.js";

/** The WhatsApp connection imported contacts will be linked to. */
export interface ImportConnection {
  id: string;
  name: string | null;
  phone_number: string | null;
}

/**
 * Resolve which WhatsApp connection an import targets.
 *
 * Imported contacts must carry a `whatsapp_connection_id` — every send path
 * routes through the contact's own connection, so an unlinked contact can
 * never be messaged. When the tenant has exactly one connected account it is
 * chosen automatically; with several, the caller must pick one explicitly
 * (mirrors POST /contacts).
 *
 * @throws {NotFoundError} When the explicit connectionId doesn't exist or is archived
 * @throws {ValidationError} When the explicit connection isn't connected, or
 *   no connectionId was given while multiple accounts are connected
 * @throws {ServiceUnavailableError} When no connected account exists
 */
export async function resolveImportConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId?: string,
): Promise<ImportConnection> {
  if (connectionId) {
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "name", "phone_number", "status"])
      .where("id", "=", connectionId)
      .where("archived_at", "is", null)
      .executeTakeFirst();

    if (!connection) {
      throw new NotFoundError("WhatsApp connection");
    }
    if (connection.status !== "connected") {
      throw new ValidationError(
        "The selected WhatsApp connection is not connected",
      );
    }
    return {
      id: connection.id,
      name: connection.name,
      phone_number: connection.phone_number,
    };
  }

  const connections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "name", "phone_number"])
    .where("status", "=", "connected")
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .limit(2)
    .execute();

  if (connections.length === 0) {
    throw new ServiceUnavailableError(
      "No connected WhatsApp account is available. Connect one before importing contacts.",
    );
  }
  if (connections.length > 1) {
    throw new ValidationError(
      "connectionId is required when multiple WhatsApp accounts are connected",
    );
  }
  return connections[0];
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
    /** Connection new contacts are linked to; resolve via {@link resolveImportConnection} */
    connectionId: string;
    updateExisting?: boolean;
    createTags?: boolean;
  },
): Promise<ImportSummary> {
  const { connectionId, updateExisting = true, createTags = true } = options;

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

        // Check if the contact already exists (by JID or phone number) on the
        // target connection. The same number reachable through a different
        // connection is a different contact row by design, so it must not
        // block or be overwritten by this import. Rows with a NULL connection
        // are unlinked legacy imports; matching them lets this import adopt
        // them instead of creating an unmessageable duplicate.
        const existingContact = await trx
          .selectFrom("contacts")
          .select(["id", "whatsapp_connection_id"])
          .where((eb) =>
            eb.or([eb("jid", "=", jid), eb("phone_number", "=", phoneNumber)]),
          )
          .where((eb) =>
            eb.or([
              eb("whatsapp_connection_id", "=", connectionId),
              eb("whatsapp_connection_id", "is", null),
            ]),
          )
          // Prefer the row already linked to this connection over an
          // unlinked legacy row when both exist.
          .orderBy(sql`whatsapp_connection_id IS NULL`)
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
          // Adopt unlinked legacy rows: link them to the target connection so
          // they become messageable instead of spawning a duplicate later.
          if (existingContact.whatsapp_connection_id === null) {
            updateData.whatsapp_connection_id = connectionId;
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
              whatsapp_connection_id: connectionId,
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
