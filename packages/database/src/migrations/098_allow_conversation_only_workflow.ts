import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

const workflowTables = [
  "conversation_cases",
  "conversation_states",
  "contact_assignments",
] as const;

/**
 * Allow assignment, cases, unread state, and schedules to exist on a
 * conversation without a legacy contact row. Existing rows keep their
 * contact_id; the check fails closed if both identities are missing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`SET lock_timeout = '5s'`.execute(db);
    for (const tableName of workflowTables) {
      const table = sql.table(`${schema}.${tableName}`);
      await sql`ALTER TABLE ${table}
        ALTER COLUMN contact_id DROP NOT NULL`.execute(db);
      const constraint = `${tableName}_contact_or_conversation_check`;
      const exists = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_constraint AS constraint_record
          JOIN pg_class AS table_record
            ON table_record.oid = constraint_record.conrelid
          JOIN pg_namespace AS schema_record
            ON schema_record.oid = table_record.relnamespace
          WHERE schema_record.nspname = ${schema}
            AND table_record.relname = ${tableName}
            AND constraint_record.conname = ${constraint}
        ) AS exists
      `.execute(db);
      if (!exists.rows[0]?.exists) {
        await sql`ALTER TABLE ${table}
          ADD CONSTRAINT ${sql.ref(constraint)}
          CHECK (contact_id IS NOT NULL OR conversation_id IS NOT NULL) NOT VALID`.execute(
          db,
        );
      }
    }
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    for (const tableName of workflowTables) {
      const table = sql.table(`${schema}.${tableName}`);
      await sql`ALTER TABLE ${table}
        DROP CONSTRAINT IF EXISTS ${sql.ref(`${tableName}_contact_or_conversation_check`)}`.execute(
        db,
      );
      await sql`ALTER TABLE ${table}
        ALTER COLUMN contact_id SET NOT NULL`.execute(db);
    }
  });
}
