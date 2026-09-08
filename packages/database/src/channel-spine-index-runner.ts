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
  predicate: string;
  unique?: boolean;
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
    const indexName = `${schemaName}_${definition.suffix}`;
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

    const columns = definition.columns.map(quoteIdentifier).join(", ");
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

function verifyDefinition(
  actual: string,
  expected: ConcurrentIndexDefinition,
  schemaName: string,
): void {
  const normalized = actual
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const fragments = [
    expected.unique === false ? "create index" : "create unique index",
    `on ${schemaName}.${expected.table}`.toLowerCase(),
    ...expected.columns.map((column) => column.toLowerCase()),
    ...expected.predicate
      .toLowerCase()
      .split(/\s+(?:and|is|not|null)\s+/)
      .filter(Boolean),
  ];
  if (fragments.some((fragment) => !normalized.includes(fragment))) {
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
