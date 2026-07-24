import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Migration 021: Fix phone numbers with device suffix
 *
 * WhatsApp's multi-device protocol uses JIDs in the format:
 * - `44578136657990:3@s.whatsapp.net` (with device suffix `:3`)
 * - `44578136657990@s.whatsapp.net` (without device suffix)
 *
 * Previous code incorrectly stored the device suffix in both the JID and phone_number fields.
 * This migration:
 * 1. Removes the device suffix (`:N`) from phone_number column
 * 2. Normalizes JID column to remove device suffix
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Fix phone_number field - remove device suffix (:N)
    // Also fix jid field - normalize to remove device suffix
    // Only update rows that have the device suffix pattern
    const result = await sql`
      UPDATE ${sql.raw(`"${schemaName}".contacts`)}
      SET
        phone_number = CASE
          WHEN phone_number LIKE '%:%' THEN split_part(phone_number, ':', 1)
          ELSE phone_number
        END,
        jid = CASE
          WHEN jid LIKE '%:%@%' THEN
            split_part(split_part(jid, '@', 1), ':', 1) || '@' || split_part(jid, '@', 2)
          ELSE jid
        END,
        updated_at = now()
      WHERE phone_number LIKE '%:%'
         OR jid LIKE '%:%@%'
    `.execute(db);

    const rowsAffected = result.numAffectedRows || 0n;
    if (rowsAffected > 0) {
      console.log(
        `Fixed ${rowsAffected} contacts with device suffix in ${schemaName}`,
      );
    }
  });

  console.log("Migration 021: Fixed phone numbers with device suffix");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Cannot restore original malformed data - this is a one-way data fix
  console.log("Migration 021 is a one-way data fix and cannot be rolled back");
}
