import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    const table = sql.table(`${schema}.message_attachments`);
    await sql`ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS fetch_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS next_fetch_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS fetch_lease_token UUID,
      ADD COLUMN IF NOT EXISTS fetch_lease_expires_at TIMESTAMPTZ`.execute(db);
    await sql`ALTER TABLE ${table}
      ALTER COLUMN next_fetch_at SET DEFAULT now()`.execute(db);
    await sql`ALTER TABLE ${table}
      ADD CONSTRAINT message_attachments_fetch_attempts_check
        CHECK (fetch_attempts >= 0) NOT VALID,
      ADD CONSTRAINT message_attachments_fetch_lease_check
        CHECK ((fetch_lease_token IS NULL) = (fetch_lease_expires_at IS NULL)) NOT VALID`.execute(
      db,
    );
    await sql`ALTER TABLE ${table}
      VALIDATE CONSTRAINT message_attachments_fetch_attempts_check,
      VALIDATE CONSTRAINT message_attachments_fetch_lease_check`.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    const table = sql.table(`${schema}.message_attachments`);
    await sql`DROP INDEX IF EXISTS ${sql.ref(`${schema}_ma_fetch_due_idx`)}`.execute(
      db,
    );
    await sql`ALTER TABLE ${table}
      DROP CONSTRAINT IF EXISTS message_attachments_fetch_lease_check,
      DROP CONSTRAINT IF EXISTS message_attachments_fetch_attempts_check,
      DROP COLUMN IF EXISTS fetch_lease_expires_at,
      DROP COLUMN IF EXISTS fetch_lease_token,
      DROP COLUMN IF EXISTS next_fetch_at,
      DROP COLUMN IF EXISTS fetch_attempts`.execute(db);
  });
}
