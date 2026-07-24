import type { Kysely } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)} ADD COLUMN IF NOT EXISTS qr_code TEXT`.execute(db);
    await sql`ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)} ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ`.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)} DROP COLUMN IF EXISTS qr_code, DROP COLUMN IF EXISTS qr_expires_at`.execute(db);
  });
}
