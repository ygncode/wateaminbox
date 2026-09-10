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

      // A second reconciliation must not take ACCESS EXCLUSIVE on a table that
      // live traffic is writing to. `DROP NOT NULL` is a no-op once the column
      // is nullable, but issuing it anyway locks out every writer until the 5s
      // DDL lock_timeout cancels the run. A row lock on the busiest table is
      // enough to catch that: a guarded run finishes, an unguarded one waits.
      const writer = new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: url.toString(), max: 1 }),
        }),
      });
      try {
        const messageId = crypto.randomUUID();
        const contactId = crypto.randomUUID();
        await sql
          .raw(
            `INSERT INTO "${schemaName}"."contacts" (id) VALUES ('${contactId}')`,
          )
          .execute(database);
        await sql
          .raw(
            `INSERT INTO "${schemaName}"."messages" (id, contact_id) VALUES ('${messageId}', '${contactId}')`,
          )
          .execute(database);
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        const held = writer.transaction().execute(async (trx) => {
          await sql
            .raw(
              `SELECT id FROM "${schemaName}"."messages" WHERE id = '${messageId}' FOR UPDATE`,
            )
            .execute(trx);
          await released;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await ensureChannelSpineTenantSchema(database, schemaName);
        release();
        await held;
      } finally {
        await writer.destroy();
      }

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
        "conversation_notes",
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
          "contact_id",
        ],
        message_reactions: ["reactor_endpoint_id", "channel_account_id"],
        conversation_states: ["contact_id", "conversation_id"],
        conversation_cases: ["contact_id", "conversation_id", "company_id"],
        contact_assignments: ["contact_id", "conversation_id"],
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

integration(
  "indexes messages by conversation when the legacy timestamp column is there",
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
    const schemaName = `tenant_ix_${crypto.randomUUID().replaceAll("-", "")}`;
    const schema = sql.id(schemaName);

    try {
      await sql`CREATE SCHEMA ${schema}`.execute(database);
      await sql`CREATE TABLE ${schema}.whatsapp_connections (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`CREATE TABLE ${schema}.contacts (id UUID PRIMARY KEY)`.execute(
        database,
      );
      // The real messages table carries the legacy ordering column; the stub
      // in the test above does not. The guard has to tell those apart, or the
      // index it exists to create is silently never built in production.
      await sql`CREATE TABLE ${schema}.messages (
        id UUID PRIMARY KEY,
        "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.execute(database);
      await sql`CREATE TABLE ${schema}.message_reactions (
        id UUID PRIMARY KEY,
        message_id UUID
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
      await reconcileChannelSpineConcurrentIndexes(database, schemaName);

      const built = await sql<{ indexdef: string }>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = ${schemaName}
          AND indexname = ${`${schemaName}_msg_conv_recent_idx`}
      `.execute(database);
      expect(built.rows).toHaveLength(1);
      // Column order is the whole point: equality on the conversation, then
      // the ordering the inbox asks for, so the planner can stop at the first
      // row instead of sorting a thread.
      expect(built.rows[0]!.indexdef).toContain("conversation_id");
      expect(built.rows[0]!.indexdef).toContain('"timestamp" DESC');

      // Reconciling again must not try to build it a second time.
      await reconcileChannelSpineConcurrentIndexes(database, schemaName);
    } finally {
      await sql`DROP SCHEMA IF EXISTS ${schema} CASCADE`.execute(database);
      await database.destroy();
    }
  },
  60_000,
);
