import { expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { reconcileChannelSpineConcurrentIndexes } from "./channel-spine-index-runner.js";
import { ensureChannelSpineTenantSchema } from "./channel-spine-schema.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "creates and idempotently reconciles the additive channel spine",
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error("Local test database required");
    }
    const database = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    const schemaName = `tenant_sp_${crypto.randomUUID().replaceAll("-", "")}`;
    const schema = sql.id(schemaName);

    try {
      await sql`CREATE SCHEMA ${schema}`.execute(database);
      await sql`CREATE TABLE ${schema}.whatsapp_connections (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`CREATE TABLE ${schema}.contacts (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`CREATE TABLE ${schema}.messages (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`CREATE TABLE ${schema}.message_reactions (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL,
        reactor_jid TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.execute(database);
      await sql`CREATE TABLE ${schema}.scheduled_messages (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`CREATE TABLE ${schema}.tags (id UUID PRIMARY KEY)`.execute(
        database,
      );
      for (const tableName of [
        "conversation_states",
        "contact_assignments",
        "contact_notes_private",
        "contact_notes_shared",
      ]) {
        await sql
          .raw(
            `CREATE TABLE "${schemaName}"."${tableName}" (id UUID PRIMARY KEY)`,
          )
          .execute(database);
      }
      await sql`CREATE TABLE ${schema}.conversation_cases (
        id UUID PRIMARY KEY,
        policy_id UUID
      )`.execute(database);

      await ensureChannelSpineTenantSchema(database, schemaName);
      await ensureChannelSpineTenantSchema(database, schemaName);
      const createdIndexes = await reconcileChannelSpineConcurrentIndexes(
        database,
        schemaName,
      );
      expect(
        createdIndexes.every((result) => result.status === "created"),
      ).toBe(true);
      const currentIndexes = await reconcileChannelSpineConcurrentIndexes(
        database,
        schemaName,
      );
      expect(currentIndexes.every((result) => result.status === "valid")).toBe(
        true,
      );

      const tableRows = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${schemaName}
      `.execute(database);
      const tables = new Set(tableRows.rows.map((row) => row.table_name));
      for (const tableName of [
        "channel_accounts",
        "channel_account_credentials",
        "contact_endpoints",
        "conversations",
        "conversation_participants",
        "message_attachments",
        "channel_event_inbox",
        "outbound_message_intents",
        "channel_account_capabilities",
        "channel_spine_reconciliation_journal",
      ]) {
        expect(tables.has(tableName)).toBe(true);
      }

      const additiveColumns = {
        contacts: ["display_name", "record_kind", "merged_into_contact_id"],
        messages: [
          "channel_account_id",
          "conversation_id",
          "external_message_id",
          "direction",
          "normalized_type",
        ],
        message_reactions: ["reactor_endpoint_id", "channel_account_id"],
        conversation_states: ["conversation_id"],
        conversation_cases: ["conversation_id", "company_id"],
        contact_assignments: ["conversation_id"],
        contact_notes_private: ["conversation_id"],
        contact_notes_shared: ["conversation_id"],
        scheduled_messages: ["conversation_id"],
      } as const;
      for (const [tableName, expectedColumns] of Object.entries(
        additiveColumns,
      )) {
        const columns = await sql<{ column_name: string }>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = ${schemaName} AND table_name = ${tableName}
        `.execute(database);
        const actual = new Set(columns.rows.map((row) => row.column_name));
        for (const expected of expectedColumns) {
          expect(actual.has(expected)).toBe(true);
        }
      }

      const wrongTenantReferences = await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM pg_constraint AS constraint_record
        JOIN pg_class AS source_table ON source_table.oid = constraint_record.conrelid
        JOIN pg_namespace AS source_schema ON source_schema.oid = source_table.relnamespace
        JOIN pg_class AS target_table ON target_table.oid = constraint_record.confrelid
        JOIN pg_namespace AS target_schema ON target_schema.oid = target_table.relnamespace
        WHERE constraint_record.contype = 'f'
          AND source_schema.nspname = ${schemaName}
          AND target_schema.nspname NOT IN (${schemaName}, 'public')
      `.execute(database);
      expect(wrongTenantReferences.rows[0]?.count).toBe("0");

      const counts = await sql<{ count: string }>`
        SELECT (
          (SELECT count(*) FROM ${schema}.channel_accounts) +
          (SELECT count(*) FROM ${schema}.conversations) +
          (SELECT count(*) FROM ${schema}.channel_event_inbox)
        )::text AS count
      `.execute(database);
      expect(counts.rows[0]?.count).toBe("0");
    } finally {
      await sql`DROP SCHEMA IF EXISTS ${schema} CASCADE`.execute(database);
      await database.destroy();
    }
  },
  120_000,
);
