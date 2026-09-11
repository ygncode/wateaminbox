import type { Kysely } from "kysely";
import { sql } from "kysely";

export interface ChannelSpineIndexResult {
  indexName: string;
  status: "created" | "valid" | "blocked";
  duplicateGroups: number;
}

interface ConcurrentIndexDefinition {
  suffix: string;
  table: string;
  columns: readonly string[];
  /**
   * Already-quoted column list, for an index whose order matters. `columns`
   * quotes each name and cannot express a direction, and for a lookup that
   * ends in LIMIT 1 the direction is the whole point - it is what lets the
   * planner stop at the first row instead of sorting the match.
   */
  columnsSql?: string;
  predicate: string;
  unique?: boolean;
  /**
   * A column this index needs that the spine does not own. `timestamp` belongs
   * to the legacy messages table, and a schema that has not got it yet - a
   * tenant part-way through provisioning, or a fixture that stubs the table -
   * must be skipped rather than failing every other index in the run.
   */
  requiresColumn?: { table: string; column: string };
  duplicateGroupSql?: (schemaName: string) => string;
}

const definitions: readonly ConcurrentIndexDefinition[] = [
  {
    suffix: "msg_external_uidx",
    table: "messages",
    columns: [
      "channel_account_id",
      "external_identity_scope",
      "external_message_id",
    ],
    predicate:
      "channel_account_id IS NOT NULL AND external_identity_scope IS NOT NULL AND external_message_id IS NOT NULL",
    duplicateGroupSql: (schemaName) => `
      SELECT count(*)::integer AS count FROM (
        SELECT 1
        FROM ${qualified(schemaName, "messages")}
        WHERE channel_account_id IS NOT NULL
          AND external_identity_scope IS NOT NULL
          AND external_message_id IS NOT NULL
        GROUP BY channel_account_id, external_identity_scope, external_message_id
        HAVING count(*) > 1
      ) AS duplicates`,
  },
  {
    suffix: "msg_idempotency_uidx",
    table: "messages",
    columns: ["channel_account_id", "client_idempotency_key"],
    predicate:
      "channel_account_id IS NOT NULL AND client_idempotency_key IS NOT NULL",
    duplicateGroupSql: (schemaName) => `
      SELECT count(*)::integer AS count FROM (
        SELECT 1
        FROM ${qualified(schemaName, "messages")}
        WHERE channel_account_id IS NOT NULL
          AND client_idempotency_key IS NOT NULL
        GROUP BY channel_account_id, client_idempotency_key
        HAVING count(*) > 1
      ) AS duplicates`,
  },
  {
    suffix: "ma_fetch_due_idx",
    table: "message_attachments",
    columns: ["next_fetch_at", "created_at"],
    predicate: "status = 'pending' AND provider_attachment_id IS NOT NULL",
    unique: false,
  },
  {
    suffix: "mr_external_uidx",
    table: "message_reactions",
    columns: [
      "channel_account_id",
      "external_event_scope",
      "external_reaction_id",
    ],
    predicate:
      "channel_account_id IS NOT NULL AND external_event_scope IS NOT NULL AND external_reaction_id IS NOT NULL",
    duplicateGroupSql: (schemaName) => `
      SELECT count(*)::integer AS count FROM (
        SELECT 1
        FROM ${qualified(schemaName, "message_reactions")}
        WHERE channel_account_id IS NOT NULL
          AND external_event_scope IS NOT NULL
          AND external_reaction_id IS NOT NULL
        GROUP BY channel_account_id, external_event_scope, external_reaction_id
        HAVING count(*) > 1
      ) AS duplicates`,
  },
  {
    suffix: "ca_conversation_uidx",
    table: "contact_assignments",
    columns: ["conversation_id"],
    predicate: "conversation_id IS NOT NULL AND unassigned_at IS NULL",
    duplicateGroupSql: (schemaName) => `
      SELECT count(*)::integer AS count FROM (
        SELECT 1
        FROM ${qualified(schemaName, "contact_assignments")}
        WHERE conversation_id IS NOT NULL AND unassigned_at IS NULL
        GROUP BY conversation_id
        HAVING count(*) > 1
      ) AS duplicates`,
  },
  {
    suffix: "cc_conversation_uidx",
    table: "conversation_cases",
    columns: ["conversation_id"],
    predicate: "conversation_id IS NOT NULL AND status IN ('open', 'pending')",
    duplicateGroupSql: (schemaName) => `
      SELECT count(*)::integer AS count FROM (
        SELECT 1
        FROM ${qualified(schemaName, "conversation_cases")}
        WHERE conversation_id IS NOT NULL AND status IN ('open', 'pending')
        GROUP BY conversation_id
        HAVING count(*) > 1
      ) AS duplicates`,
  },
  {
    // The inbox's newest-message-per-thread lookup, by conversation.
    //
    // `messages` already carries this shape three times over on `contact_id`,
    // which is why the contact-anchored chat list is fast. The same lookup by
    // conversation had no index at all: measured against the largest
    // workspace the lateral went from forty milliseconds to over five
    // minutes, and a COALESCE across both keys was no better because it can
    // use neither index.
    suffix: "msg_conv_recent_idx",
    table: "messages",
    columns: ["conversation_id"],
    columnsSql: '"conversation_id", "timestamp" DESC, "id" DESC',
    predicate: "conversation_id IS NOT NULL",
    unique: false,
    requiresColumn: { table: "messages", column: "timestamp" },
  },
  {
    // Sender-anchored history for one connection: "what name has this person
    // used in this workspace", which the group panel and the group-member
    // sync both ask (group.service.ts, group-sync.service.ts), and which the
    // avatar fan-out writes back through (contact-handlers.ts).
    //
    // Neither column was indexed, so the lookup sequentially scanned the whole
    // table on every group-detail load - the one read here that grows with
    // message volume rather than with group size.
    //
    // Every call site filters on `whatsapp_connection_id` as well as
    // `sender_jid`, so one composite serves all of them. The predicate is
    // deliberately only the two NOT NULLs: a narrower `sender_name IS NOT
    // NULL` would match the group-sync read and silently exclude the avatar
    // update, which has no such filter.
    suffix: "msg_conn_sender_idx",
    table: "messages",
    columns: ["whatsapp_connection_id", "sender_jid"],
    predicate: "whatsapp_connection_id IS NOT NULL AND sender_jid IS NOT NULL",
    unique: false,
    // Both columns belong to the legacy messages table and arrive together, so
    // one guard covers the pair. A schema without them - a fixture, or a
    // tenant part-way through provisioning - has to be skipped rather than
    // aborting the run for every tenant after it.
    requiresColumn: { table: "messages", column: "sender_jid" },
  },
  {
    suffix: "cs_conversation_uidx",
    table: "conversation_states",
    columns: ["conversation_id"],
    predicate: "conversation_id IS NOT NULL",
    duplicateGroupSql: (schemaName) => `
      SELECT count(*)::integer AS count FROM (
        SELECT 1
        FROM ${qualified(schemaName, "conversation_states")}
        WHERE conversation_id IS NOT NULL
        GROUP BY conversation_id
        HAVING count(*) > 1
      ) AS duplicates`,
  },
];

/**
 * Build hot-table unique indexes outside a transaction. Callers must not wrap
 * this function in a Kysely transaction: PostgreSQL rejects CONCURRENTLY there.
 */
export async function reconcileChannelSpineConcurrentIndexes<Database>(
  db: Kysely<Database>,
  schemaName: string,
): Promise<ChannelSpineIndexResult[]> {
  const results: ChannelSpineIndexResult[] = [];
  for (const definition of definitions) {
    // Indexes live in the tenant schema, so the suffix is unique without a
    // schema prefix. Prefixing tenant_<uuid>_ overflows PostgreSQL's 63-char
    // identifier limit for several of these names.
    const indexName = definition.suffix;
    if (
      definition.requiresColumn &&
      !(await hasColumn(db, schemaName, definition.requiresColumn))
    ) {
      continue;
    }
    const current = await readIndex(db, schemaName, indexName);
    if (current?.valid) {
      verifyDefinition(current.definition, definition, schemaName);
      await checkpoint(db, schemaName, indexName, "complete", null);
      results.push({ indexName, status: "valid", duplicateGroups: 0 });
      continue;
    }
    if (current) {
      await sql
        .raw(
          `DROP INDEX CONCURRENTLY IF EXISTS ${qualified(schemaName, indexName)}`,
        )
        .execute(db);
    }

    const duplicateResult = definition.duplicateGroupSql
      ? await sql
          .raw<{ count: number }>(definition.duplicateGroupSql(schemaName))
          .execute(db)
      : { rows: [{ count: 0 }] };
    const duplicateGroups = Number(duplicateResult.rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(duplicateGroups) || duplicateGroups < 0) {
      throw new Error(`invalid duplicate preflight result for ${indexName}`);
    }
    if (duplicateGroups > 0) {
      await checkpoint(db, schemaName, indexName, "blocked", "duplicate_keys");
      results.push({ indexName, status: "blocked", duplicateGroups });
      continue;
    }

    const columns =
      definition.columnsSql ??
      definition.columns.map(quoteIdentifier).join(", ");
    await sql
      .raw(
        `CREATE ${definition.unique === false ? "" : "UNIQUE "}INDEX CONCURRENTLY ${quoteIdentifier(indexName)} ON ${qualified(
          schemaName,
          definition.table,
        )} (${columns}) WHERE ${definition.predicate}`,
      )
      .execute(db);
    const created = await readIndex(db, schemaName, indexName);
    if (!created?.valid) {
      throw new Error(
        `concurrent index ${indexName} was not valid after creation`,
      );
    }
    verifyDefinition(created.definition, definition, schemaName);
    await checkpoint(db, schemaName, indexName, "complete", null);
    results.push({ indexName, status: "created", duplicateGroups: 0 });
  }
  return results;
}

async function readIndex<Database>(
  db: Kysely<Database>,
  schemaName: string,
  indexName: string,
): Promise<{ valid: boolean; definition: string } | undefined> {
  const result = await sql<{ valid: boolean; definition: string }>`
    SELECT index_record.indisvalid AS valid,
      pg_get_indexdef(index_record.indexrelid) AS definition
    FROM pg_index AS index_record
    JOIN pg_class AS relation ON relation.oid = index_record.indexrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = ${schemaName} AND relation.relname = ${indexName}
  `.execute(db);
  return result.rows[0];
}

async function hasColumn<Database>(
  db: Kysely<Database>,
  schemaName: string,
  target: { table: string; column: string },
): Promise<boolean> {
  const found = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = ${target.table}
        AND column_name = ${target.column}
    ) AS exists
  `.execute(db);
  return found.rows[0]?.exists === true;
}

function verifyDefinition(
  actual: string,
  expected: ConcurrentIndexDefinition,
  schemaName: string,
): void {
  const compact = (value: string) =>
    value
      .replace(/"/g, "")
      .replace(/::\w+/g, "")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  const normalized = compact(actual);
  const required = [
    expected.unique === false ? "create index" : "create unique index",
    `on ${schemaName}.${expected.table}`.toLowerCase(),
    ...expected.columns.map((column) => column.toLowerCase()),
    "where",
  ];
  if (required.some((fragment) => !normalized.includes(fragment))) {
    throw new Error(`existing index has unexpected definition: ${actual}`);
  }
}

async function checkpoint<Database>(
  db: Kysely<Database>,
  schemaName: string,
  indexName: string,
  status: "complete" | "blocked",
  errorCode: string | null,
): Promise<void> {
  const checkpointTable = sql.table(
    `${schemaName}.channel_spine_backfill_checkpoints`,
  );
  const completedAt = status === "complete" ? new Date() : null;
  await sql`
    INSERT INTO ${checkpointTable} (
      job_key, phase, status, last_error_code,
      started_at, completed_at, updated_at
    ) VALUES (
      ${`concurrent-index:${indexName}`},
      'additive-indexes',
      ${status},
      ${errorCode},
      now(),
      ${completedAt},
      now()
    )
    ON CONFLICT (job_key) DO UPDATE SET
      status = EXCLUDED.status,
      last_error_code = EXCLUDED.last_error_code,
      completed_at = EXCLUDED.completed_at,
      updated_at = now()
  `.execute(db);
}

function qualified(schemaName: string, relationName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(relationName)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
