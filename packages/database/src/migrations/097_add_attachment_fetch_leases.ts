import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

async function constraintExists(
  db: Kysely<unknown>,
  schemaName: string,
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record
        ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = ${schemaName}
        AND table_record.relname = ${tableName}
        AND constraint_record.conname = ${constraintName}
    ) AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

/**
 * 092 creates message_attachments with the fetch-lease invariant as an inline
 * CHECK whose generated name is not stable. Detect any CHECK constraint that
 * spans both lease columns instead of matching a specific name.
 */
async function leaseCheckExists(
  db: Kysely<unknown>,
  schemaName: string,
  tableName: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record
        ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      JOIN pg_attribute AS token_column
        ON token_column.attrelid = table_record.oid
       AND token_column.attname = 'fetch_lease_token'
      JOIN pg_attribute AS expiry_column
        ON expiry_column.attrelid = table_record.oid
       AND expiry_column.attname = 'fetch_lease_expires_at'
      WHERE schema_record.nspname = ${schemaName}
        AND table_record.relname = ${tableName}
        AND constraint_record.contype = 'c'
        AND constraint_record.conkey @> ARRAY[token_column.attnum, expiry_column.attnum]
    ) AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

/** Ciphertext-free attachment fetch leasing columns and their guard checks. */
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

    const attemptsCheckExists = await constraintExists(
      db,
      schema,
      "message_attachments",
      "message_attachments_fetch_attempts_check",
    );
    if (!attemptsCheckExists) {
      await sql`ALTER TABLE ${table}
        ADD CONSTRAINT message_attachments_fetch_attempts_check
        CHECK (fetch_attempts >= 0) NOT VALID`.execute(db);
    }

    const leaseCheckPresent =
      (await constraintExists(
        db,
        schema,
        "message_attachments",
        "message_attachments_fetch_lease_check",
      )) || (await leaseCheckExists(db, schema, "message_attachments"));
    if (!leaseCheckPresent) {
      await sql`ALTER TABLE ${table}
        ADD CONSTRAINT message_attachments_fetch_lease_check
        CHECK ((fetch_lease_token IS NULL) = (fetch_lease_expires_at IS NULL)) NOT VALID`.execute(
        db,
      );
    }

    if (!attemptsCheckExists) {
      await sql`ALTER TABLE ${table}
        VALIDATE CONSTRAINT message_attachments_fetch_attempts_check`.execute(
        db,
      );
    }
    if (!leaseCheckPresent) {
      await sql`ALTER TABLE ${table}
        VALIDATE CONSTRAINT message_attachments_fetch_lease_check`.execute(db);
    }
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
