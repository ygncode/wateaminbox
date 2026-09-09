import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/** Store linked-device media cryptographic material losslessly as bytes. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = sql.table(`${schemaName}.whatsapp_attachment_fetch_state`);
    const populated = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM ${table}
      WHERE media_key IS NOT NULL OR file_sha256 IS NOT NULL OR file_enc_sha256 IS NOT NULL
    `.execute(db);
    if (populated.rows[0]?.count !== "0") {
      throw new Error(
        `${schemaName}.whatsapp_attachment_fetch_state contains text cryptographic material; explicit repair is required`,
      );
    }
    await sql`ALTER TABLE ${table}
      ALTER COLUMN media_key TYPE BYTEA USING NULL,
      ALTER COLUMN file_sha256 TYPE BYTEA USING NULL,
      ALTER COLUMN file_enc_sha256 TYPE BYTEA USING NULL`.execute(db);
  });
}

export async function down(): Promise<void> {
  throw new Error("migration 093 is forward-only");
}
