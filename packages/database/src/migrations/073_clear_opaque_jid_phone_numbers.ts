import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Clear phone numbers that were derived from opaque WhatsApp identifiers.
 *
 * LID/hosted-LID and group JID local parts are identifiers, not telephone
 * numbers. Older ingestion code stripped the JID server and stored any digits
 * it found in contacts.phone_number. Restrict the repair to values that exactly
 * repeat the opaque local part; unlike a real phone JID, those digits are not
 * authoritative phone data.
 */
export async function clearOpaqueJidPhoneNumbers(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<bigint> {
  const contacts = sql.table(`${schemaName}.contacts`);
  const result = await sql`
      UPDATE ${contacts}
      SET phone_number = NULL, updated_at = now()
      WHERE phone_number IS NOT NULL
        AND (
          split_part(jid, '@', 2) IN ('lid', 'hosted.lid')
          OR (is_group AND split_part(jid, '@', 2) = 'g.us')
        )
        AND regexp_replace(phone_number, '[^0-9]', '', 'g') =
            regexp_replace(
              split_part(split_part(jid, '@', 1), ':', 1),
              '[^0-9]',
              '',
              'g'
            )
        AND regexp_replace(
              split_part(split_part(jid, '@', 1), ':', 1),
              '[^0-9]',
              '',
              'g'
            ) <> ''
  `.execute(db);
  return result.numAffectedRows;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // Fail rather than waiting behind an unexpected production lock or scanning
  // beyond the deployment deadline. Kysely runs each migration transactionally.
  await sql.raw("SET LOCAL lock_timeout = '5s'").execute(db);
  await sql.raw("SET LOCAL statement_timeout = '30s'").execute(db);

  await executeOnAllTenants(db, async (schemaName) => {
    const rowsAffected = await clearOpaqueJidPhoneNumbers(db, schemaName);
    if (rowsAffected > 0n) {
      console.log(
        `Cleared ${rowsAffected} opaque JID phone numbers in ${schemaName}`,
      );
    }
  });
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // One-way data correction: the cleared values were never phone numbers.
}
