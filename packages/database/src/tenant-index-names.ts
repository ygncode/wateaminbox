import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Canonical, length-safe names for per-tenant indexes and constraints.
 *
 * PostgreSQL truncates identifiers at 63 bytes SILENTLY. A tenant schema name
 * is exactly 43 characters (`tenant_` plus a UUID with dashes replaced), so a
 * `${schemaName}_${suffix}` identifier has only 20 characters of room. Several
 * historical suffixes were far longer, which had two consequences:
 *
 *  1. The identifier stored in the catalog was a truncation of the intended
 *     name, so the source and the database disagreed about what exists.
 *  2. Where two intended names shared their first 20 characters, they
 *     truncated to the SAME identifier - and `CREATE INDEX IF NOT EXISTS`
 *     then made every one after the first a silent no-op. Those indexes were
 *     simply absent, including UNIQUE ones whose absence removes a data
 *     integrity guarantee the application assumes.
 *
 * Every suffix below is <= 20 characters, so the full identifier always fits
 * and is deterministic for any tenant. `LEGACY_SUFFIX` records the historical
 * intended name so an existing tenant's truncated index can be renamed in
 * place instead of rebuilt.
 */

/** PostgreSQL's NAMEDATALEN - 1. Identifiers longer than this are truncated. */
export const PG_IDENTIFIER_MAX_BYTES = 63;

/** Longest tenant schema name: `tenant_` + a UUID with dashes replaced. */
export const TENANT_SCHEMA_NAME_LENGTH = 43;

/** Room left for a per-tenant identifier suffix, including its underscore. */
export const TENANT_SUFFIX_BUDGET =
  PG_IDENTIFIER_MAX_BYTES - TENANT_SCHEMA_NAME_LENGTH;

export interface TenantIndexTarget {
  /** Length-safe suffix appended to the schema name. Max 20 characters. */
  suffix: string;
  /** Historical, over-length suffix this replaces. */
  legacySuffix: string;
  table: string;
  /** Indexed columns, in order. Compared against the catalog to match. */
  columns: readonly string[];
  unique: boolean;
  /** Partial-index predicate, exactly as it should be emitted. */
  predicate?: string;
  /**
   * Column ordering/expression suffixes that belong in the CREATE statement
   * but not in the catalog column comparison (e.g. `DESC`).
   */
  createColumns?: readonly string[];
  /** True when this is a table CONSTRAINT rather than a bare index. */
  constraint?: boolean;
  /** Why it exists - surfaced in the duplicate report for UNIQUE targets. */
  purpose: string;
}

/**
 * Every per-tenant index whose intended name exceeded the identifier limit.
 *
 * `_whatsapp_labels_label_uidx` is deliberately absent: current code only ever
 * DROPs it, so it is legacy cleanup rather than a target to maintain.
 */
export const TENANT_INDEX_TARGETS: readonly TenantIndexTarget[] = [
  {
    suffix: "_bj_idem_uidx",
    legacySuffix: "_bulk_jobs_idempotency_uidx",
    table: "bulk_jobs",
    columns: ["idempotency_key"],
    unique: true,
    predicate: "idempotency_key IS NOT NULL",
    purpose: "one bulk job per idempotency key",
  },
  {
    suffix: "_bj_status_idx",
    legacySuffix: "_bulk_jobs_status_idx",
    table: "bulk_jobs",
    columns: ["status", "scheduled_at"],
    unique: false,
    purpose: "bulk job dispatch scan",
  },
  {
    suffix: "_cp_ccp_uidx",
    legacySuffix: "_catalog_products_connection_catalog_product_uidx",
    table: "catalog_products",
    columns: ["whatsapp_connection_id", "catalog_id", "product_id"],
    unique: true,
    predicate: "whatsapp_connection_id IS NOT NULL",
    purpose: "one catalog product per connection/catalog/product",
  },
  {
    suffix: "_ct_conn_jid_uidx",
    legacySuffix: "_contacts_connection_jid_uidx",
    table: "contacts",
    columns: ["whatsapp_connection_id", "jid"],
    unique: true,
    predicate: "whatsapp_connection_id IS NOT NULL AND jid IS NOT NULL",
    purpose: "one contact per connection/JID",
  },
  {
    suffix: "_cs_resolved_idx",
    legacySuffix: "_conv_states_resolved_idx",
    table: "conversation_states",
    columns: ["resolved_at"],
    unique: false,
    purpose: "resolved conversation lookup",
  },
  {
    suffix: "_cs_status_idx",
    legacySuffix: "_conv_states_status_idx",
    table: "conversation_states",
    columns: ["status"],
    unique: false,
    purpose: "conversation status filter",
  },
  {
    suffix: "_msg_media_pend_idx",
    legacySuffix: "_idx_messages_media_pending",
    table: "messages",
    columns: ["media_download_status", "created_at"],
    unique: false,
    predicate:
      "media_download_status = 'pending' AND media_direct_path IS NOT NULL",
    purpose: "deferred media download scan",
  },
  {
    suffix: "_msg_wa_uniq",
    legacySuffix: "_messages_unique_wa_message",
    table: "messages",
    columns: ["whatsapp_connection_id", "message_id"],
    unique: true,
    constraint: true,
    purpose: "one stored message per connection/WhatsApp message ID",
  },
  {
    suffix: "_outbox_pending_idx",
    legacySuffix: "_nats_outbox_pending_idx",
    table: "nats_outbox",
    columns: ["status", "next_attempt_at", "created_at"],
    unique: false,
    purpose: "command outbox dispatch claim",
  },
  {
    suffix: "_push_subs_user_idx",
    legacySuffix: "_push_subscriptions_user_idx",
    table: "push_subscriptions",
    columns: ["user_id"],
    unique: false,
    purpose: "web push subscription lookup",
  },
  {
    suffix: "_sm_bulk_job_idx",
    legacySuffix: "_scheduled_messages_bulk_job_idx",
    table: "scheduled_messages",
    columns: ["bulk_job_id", "status"],
    unique: false,
    predicate: "bulk_job_id IS NOT NULL",
    purpose: "bulk job leaf progress",
  },
  {
    suffix: "_sm_contact_idx",
    legacySuffix: "_scheduled_messages_contact_idx",
    table: "scheduled_messages",
    columns: ["contact_id", "scheduled_at"],
    unique: false,
    purpose: "per-conversation schedule list",
  },
  {
    suffix: "_sm_due_idx",
    legacySuffix: "_scheduled_messages_due_idx",
    table: "scheduled_messages",
    columns: ["next_attempt_at"],
    unique: false,
    predicate: "status IN ('scheduled', 'processing')",
    purpose: "due scheduled message claim",
  },
  {
    suffix: "_was_account_idx",
    legacySuffix: "_wa_sessions_account_idx",
    table: "whatsapp_connection_sessions",
    columns: ["whatsapp_connection_id", "created_at"],
    createColumns: ["whatsapp_connection_id", "created_at DESC"],
    unique: false,
    purpose: "session history per connection",
  },
  {
    suffix: "_was_active_uidx",
    legacySuffix: "_wa_sessions_active_uidx",
    table: "whatsapp_connection_sessions",
    columns: ["whatsapp_connection_id"],
    unique: true,
    predicate: "ended_at IS NULL",
    purpose: "at most one active session per connection",
  },
  {
    suffix: "_wc_conn_cat_uidx",
    legacySuffix: "_whatsapp_catalogs_connection_catalog_uidx",
    table: "whatsapp_catalogs",
    columns: ["whatsapp_connection_id", "catalog_id"],
    unique: true,
    predicate: "whatsapp_connection_id IS NOT NULL",
    purpose: "one catalog per connection/catalog ID",
  },
  {
    suffix: "_wconn_phone_uidx",
    legacySuffix: "_whatsapp_connections_phone_uidx",
    table: "whatsapp_connections",
    columns: ["phone_number"],
    unique: true,
    predicate: "phone_number IS NOT NULL",
    purpose: "one WhatsApp connection per phone number",
  },
  {
    suffix: "_wconn_status_idx",
    legacySuffix: "_whatsapp_connections_status_idx",
    table: "whatsapp_connections",
    columns: ["status"],
    unique: false,
    purpose: "connection status filter",
  },
  {
    suffix: "_wl_conn_label_uidx",
    legacySuffix: "_whatsapp_labels_connection_label_uidx",
    table: "whatsapp_labels",
    columns: ["whatsapp_connection_id", "label_id"],
    unique: true,
    predicate: "whatsapp_connection_id IS NOT NULL",
    purpose: "one label per connection/label ID",
  },
  {
    suffix: "_wl_conn_tag_uidx",
    legacySuffix: "_whatsapp_labels_connection_tag_uidx",
    table: "whatsapp_labels",
    columns: ["whatsapp_connection_id", "synced_tag_id"],
    unique: true,
    predicate:
      "whatsapp_connection_id IS NOT NULL AND synced_tag_id IS NOT NULL",
    purpose: "one label per connection/synced tag",
  },
] as const;

/** The identifier a tenant should have for this target. */
export function targetIdentifier(
  schemaName: string,
  target: TenantIndexTarget,
): string {
  return `${schemaName}${target.suffix}`;
}

/**
 * The identifier PostgreSQL actually produced for the historical name.
 *
 * Truncation is deterministic, so this is exactly what an existing tenant has
 * - which is what makes an in-place rename possible instead of a rebuild.
 */
export function legacyIdentifier(
  schemaName: string,
  target: TenantIndexTarget,
): string {
  return `${schemaName}${target.legacySuffix}`.slice(
    0,
    PG_IDENTIFIER_MAX_BYTES,
  );
}

/** A UNIQUE target that cannot be created because the data already violates it. */
export interface DuplicateBlocker {
  schemaName: string;
  table: string;
  indexName: string;
  columns: readonly string[];
  purpose: string;
  /** A bounded sample of the conflicting key values, for the operator. */
  samples: Array<Record<string, unknown>>;
  totalConflicts: number;
}

interface ExistingIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

async function loadExistingIndexes<DB>(
  db: Kysely<DB>,
  schemaName: string,
  table: string,
): Promise<ExistingIndex[]> {
  const result = await sql<{
    index_name: string;
    is_unique: boolean;
    columns: string[];
  }>`
    SELECT
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${schemaName} AND t.relname = ${table}
    GROUP BY i.relname, ix.indisunique
  `.execute(db);
  return result.rows.map((row) => ({
    name: row.index_name,
    unique: row.is_unique,
    columns: row.columns,
  }));
}

/**
 * Whether a relation name is backed by a table CONSTRAINT.
 *
 * A constraint's index cannot be dropped with DROP INDEX; it has to go through
 * ALTER TABLE ... DROP CONSTRAINT.
 */
async function isConstraint<DB>(
  db: Kysely<DB>,
  schemaName: string,
  table: string,
  name: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schemaName} AND t.relname = ${table}
        AND c.conname = ${name}
    ) AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

function matchesTarget(
  existing: ExistingIndex,
  target: TenantIndexTarget,
): boolean {
  return (
    existing.unique === target.unique &&
    existing.columns.length === target.columns.length &&
    existing.columns.every((column, i) => column === target.columns[i])
  );
}

/**
 * Columns present on a tenant table, or null when the table itself is absent.
 *
 * A tenant schema can legitimately lag the current model: the historical
 * `setup_tenant_schema` function builds a pre-054 shape, and the columns some
 * targets index are added later. Checking first means an out-of-order or
 * partially migrated schema is skipped rather than aborting the run.
 */
async function tableColumns<DB>(
  db: Kysely<DB>,
  schemaName: string,
  table: string,
): Promise<Set<string> | null> {
  const result = await sql<{ column_name: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = ${schemaName} AND table_name = ${table}
  `.execute(db);
  if (result.rows.length === 0) return null;
  return new Set(result.rows.map((row) => row.column_name));
}

/**
 * Find rows that would violate a UNIQUE target.
 *
 * Never mutates anything. Returning conflicts is how the caller fails closed:
 * customer data is the operator's to reconcile, not this migration's.
 */
async function findDuplicates<DB>(
  db: Kysely<DB>,
  schemaName: string,
  target: TenantIndexTarget,
): Promise<{ samples: Array<Record<string, unknown>>; total: number }> {
  const columnList = sql.raw(
    target.columns.map((column) => `"${column}"`).join(", "),
  );
  const where = target.predicate
    ? sql.raw(`WHERE ${target.predicate}`)
    : sql.raw("");
  const relation = sql.raw(`"${schemaName}"."${target.table}"`);

  const result = await sql<Record<string, unknown>>`
    SELECT ${columnList}, count(*)::int AS conflict_count
    FROM ${relation}
    ${where}
    GROUP BY ${columnList}
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 5
  `.execute(db);

  if (result.rows.length === 0) return { samples: [], total: 0 };

  const totalResult = await sql<{ total: number }>`
    SELECT count(*)::int AS total FROM (
      SELECT 1 FROM ${relation}
      ${where}
      GROUP BY ${columnList}
      HAVING count(*) > 1
    ) AS conflicts
  `.execute(db);

  return {
    samples: result.rows,
    total: totalResult.rows[0]?.total ?? result.rows.length,
  };
}

/**
 * Rename one target's relation, choosing the right statement for what it is.
 *
 * Exported so migration 063's `down` reverses a rename through exactly the
 * same code that made it, rather than a second copy that could disagree about
 * constraint-versus-index.
 */
export async function renameTenantRelation<DB>(
  db: Kysely<DB>,
  schemaName: string,
  target: TenantIndexTarget,
  from: string,
  to: string,
): Promise<void> {
  // Which statement to use is a property of the RELATION BEING RENAMED, not of
  // the target: `planTenantIndexAction` may adopt a bare UNIQUE index that has
  // the target's shape but no backing constraint, and `ALTER TABLE ... RENAME
  // CONSTRAINT` errors outright on one of those - aborting the whole migration.
  if (
    target.constraint &&
    (await isConstraint(db, schemaName, target.table, from))
  ) {
    // Renaming the constraint renames its backing index too.
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"."${target.table}"`)}
      RENAME CONSTRAINT ${sql.raw(`"${from}"`)} TO ${sql.raw(`"${to}"`)}
    `.execute(db);
    return;
  }
  await sql`
    ALTER INDEX ${sql.raw(`"${schemaName}"."${from}"`)}
    RENAME TO ${sql.raw(`"${to}"`)}
  `.execute(db);
}

async function createRelation<DB>(
  db: Kysely<DB>,
  schemaName: string,
  target: TenantIndexTarget,
  name: string,
): Promise<void> {
  const relation = sql.raw(`"${schemaName}"."${target.table}"`);
  const columns = sql.raw(
    (target.createColumns ?? target.columns)
      .map((column) => {
        const [identifier, ...modifiers] = column.split(" ");
        return [`"${identifier}"`, ...modifiers].join(" ");
      })
      .join(", "),
  );

  if (target.constraint) {
    await sql`
      ALTER TABLE ${relation}
      ADD CONSTRAINT ${sql.raw(`"${name}"`)} UNIQUE (${columns})
    `.execute(db);
    return;
  }

  const predicate = target.predicate
    ? sql.raw(`WHERE ${target.predicate}`)
    : sql.raw("");
  const unique = sql.raw(target.unique ? "UNIQUE " : "");
  await sql`
    CREATE ${unique}INDEX IF NOT EXISTS ${sql.raw(`"${name}"`)}
    ON ${relation} (${columns})
    ${predicate}
  `.execute(db);
}

export interface TenantIndexReconcileResult {
  renamed: string[];
  created: string[];
  alreadyCorrect: string[];
  /** Targets skipped because their table or a column is not present yet. */
  skipped: string[];
  /** Redundant duplicates of a canonical index, removed. */
  droppedRedundant: string[];
  /** UNIQUE targets left uncreated because existing rows already conflict. */
  blocked: DuplicateBlocker[];
}

/**
 * Planner row estimate for a tenant table.
 *
 * `reltuples` rather than COUNT(*): this only has to convey the order of
 * magnitude of an index build, and must stay cheap on a large table.
 */
async function estimatedRowCount<DB>(
  db: Kysely<DB>,
  schemaName: string,
  table: string,
): Promise<number> {
  const result = await sql<{ rows: number }>`
    SELECT GREATEST(c.reltuples, 0)::bigint::int AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schemaName} AND c.relname = ${table}
  `.execute(db);
  return result.rows[0]?.rows ?? 0;
}

/** What reconciliation would do to one target on one schema. */
export type TenantIndexAction =
  | { kind: "skip"; reason: "missing-table-or-column" }
  | { kind: "already-correct"; redundant?: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "create"; name: string }
  | { kind: "blocked"; blocker: DuplicateBlocker };

/**
 * Decide, without changing anything, what a single target needs.
 *
 * Both `reconcileTenantIndexNames` (which applies the decision) and
 * `preflightTenantIndexNames` (which reports it) call this, so a preflight can
 * never disagree with what the migration then does. Keeping the decision in
 * one place is the whole point - two copies of this logic would drift.
 */
export async function planTenantIndexAction<DB>(
  db: Kysely<DB>,
  schemaName: string,
  target: TenantIndexTarget,
): Promise<TenantIndexAction> {
  // A schema that has not reached the migration which adds this table or
  // column yet is skipped, not failed: later migrations still bring it up to
  // date, and reconcileTenantSchema re-runs this afterwards.
  const columns = await tableColumns(db, schemaName, target.table);
  if (!columns || target.columns.some((column) => !columns.has(column))) {
    return { kind: "skip", reason: "missing-table-or-column" };
  }

  const desired = targetIdentifier(schemaName, target);
  const legacyName = legacyIdentifier(schemaName, target);
  const existing = await loadExistingIndexes(db, schemaName, target.table);

  if (existing.some((index) => index.name === desired)) {
    // Self-healing: the historical name still present alongside the canonical
    // one AND with exactly the same shape is a pure duplicate - same
    // guarantee, twice the write cost and disk. Only an exact shape match
    // under the computed legacy name qualifies, so a truncation sibling (a
    // DIFFERENT index that merely shares the name prefix) is never touched,
    // and the canonical relation always survives.
    const redundant = existing.find(
      (index) =>
        index.name === legacyName &&
        index.name !== desired &&
        matchesTarget(index, target),
    );
    return redundant
      ? { kind: "already-correct", redundant: redundant.name }
      : { kind: "already-correct" };
  }

  // Only rename a relation that actually has this target's shape. Under a
  // truncation collision the historical name belongs to a sibling.
  const renameable = existing.find(
    (index) => index.name === legacyName && matchesTarget(index, target),
  );
  if (renameable) {
    return { kind: "rename", from: legacyName, to: desired };
  }

  // An identically shaped index under some other name already provides the
  // guarantee; adopt it rather than building a duplicate.
  const adoptable = existing.find((index) => matchesTarget(index, target));
  if (adoptable) {
    return { kind: "rename", from: adoptable.name, to: desired };
  }

  if (target.unique) {
    const duplicates = await findDuplicates(db, schemaName, target);
    if (duplicates.total > 0) {
      return {
        kind: "blocked",
        blocker: {
          schemaName,
          table: target.table,
          indexName: desired,
          columns: target.columns,
          purpose: target.purpose,
          samples: duplicates.samples,
          totalConflicts: duplicates.total,
        },
      };
    }
  }

  return { kind: "create", name: desired };
}

/**
 * Bring one tenant schema's index names to the canonical, length-safe set.
 *
 * Idempotent and order-independent:
 *  - a correctly named index is left untouched;
 *  - an index matching the target's shape under the historical truncated name
 *    is renamed in place (metadata only - no rebuild, no data movement);
 *  - a genuinely absent index is created, EXCEPT that a UNIQUE one whose data
 *    already has conflicts is reported instead. Nothing is ever deleted or
 *    merged.
 *
 * Matching is by shape (columns + uniqueness) rather than by name, so a
 * truncation collision - where the historical name belongs to a sibling index
 * entirely - is resolved correctly rather than renaming the wrong relation.
 */
export async function reconcileTenantIndexNames<DB>(
  db: Kysely<DB>,
  schemaName: string,
): Promise<TenantIndexReconcileResult> {
  const result: TenantIndexReconcileResult = {
    renamed: [],
    created: [],
    alreadyCorrect: [],
    skipped: [],
    droppedRedundant: [],
    blocked: [],
  };

  for (const target of TENANT_INDEX_TARGETS) {
    const action = await planTenantIndexAction(db, schemaName, target);

    switch (action.kind) {
      case "skip":
        result.skipped.push(target.suffix);
        break;

      case "already-correct":
        if (action.redundant) {
          // Constraints need this too: ADD CONSTRAINT only rejects a duplicate
          // NAME, not a duplicate definition, so a second identical UNIQUE
          // constraint can coexist under the old truncated name.
          if (await isConstraint(db, schemaName, target.table, action.redundant)) {
            await sql`
              ALTER TABLE ${sql.raw(`"${schemaName}"."${target.table}"`)}
              DROP CONSTRAINT ${sql.raw(`"${action.redundant}"`)}
            `.execute(db);
          } else {
            await sql`
              DROP INDEX ${sql.raw(`"${schemaName}"."${action.redundant}"`)}
            `.execute(db);
          }
          result.droppedRedundant.push(target.suffix);
        }
        result.alreadyCorrect.push(target.suffix);
        break;

      case "rename":
        await renameTenantRelation(
          db,
          schemaName,
          target,
          action.from,
          action.to,
        );
        result.renamed.push(target.suffix);
        break;

      case "blocked":
        result.blocked.push(action.blocker);
        break;

      case "create":
        await createRelation(db, schemaName, target, action.name);
        result.created.push(target.suffix);
        break;
    }
  }

  return result;
}

/** Render blockers as an operator-facing message. Never includes row payloads. */
export function formatDuplicateBlockers(
  blockers: readonly DuplicateBlocker[],
): string {
  const lines = [
    `Cannot create ${blockers.length} UNIQUE index(es): existing rows already conflict.`,
    "No data was changed. Resolve the duplicates below, then re-run the migration.",
    "",
  ];
  for (const blocker of blockers) {
    lines.push(
      `  ${blocker.schemaName}.${blocker.table} -> ${blocker.indexName}`,
      `    guarantee: ${blocker.purpose}`,
      `    key: (${blocker.columns.join(", ")})`,
      `    conflicting key groups: ${blocker.totalConflicts}`,
    );
    for (const sample of blocker.samples) {
      const keys = blocker.columns
        .map((column) => `${column}=${String(sample[column])}`)
        .join(", ");
      lines.push(`    e.g. ${keys} (x${String(sample.conflict_count)})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * The pre-054 label uniqueness index, retired by the connection-scoped one.
 *
 * `whatsapp_labels(label_id)` UNIQUE predates labels being scoped per WhatsApp
 * connection. Once a workspace can connect two accounts, the same WhatsApp
 * label ID legitimately appears twice, so this index is not merely redundant -
 * it rejects valid rows.
 */
const LEGACY_LABEL_UNIQUE_SUFFIX = "_whatsapp_labels_label_uidx";

/**
 * Drop the obsolete label index, if and only if it is really that index.
 *
 * The original statement never worked: it named an unqualified identifier (the
 * migrator's search_path is `public`, so `IF EXISTS` matched nothing) and the
 * intended name is 70 characters, which PostgreSQL truncates at 63 - so the
 * name being asked for was never the name in the catalog.
 *
 * Both are corrected here, and the drop is guarded by shape: a unique index on
 * exactly `(label_id)`. Anything else under that identifier is left alone, so
 * a truncation collision can never turn this into a destructive surprise.
 */
export async function dropLegacyLabelUniqueIndex<DB>(
  db: Kysely<DB>,
  schemaName: string,
): Promise<boolean> {
  const indexName = `${schemaName}${LEGACY_LABEL_UNIQUE_SUFFIX}`.slice(
    0,
    PG_IDENTIFIER_MAX_BYTES,
  );

  const matches = await sql<{ columns: string[]; is_unique: boolean }>`
    SELECT
      ix.indisunique AS is_unique,
      array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${schemaName}
      AND t.relname = 'whatsapp_labels'
      AND i.relname = ${indexName}
    GROUP BY ix.indisunique
  `.execute(db);

  const found = matches.rows[0];
  if (
    !found ||
    !found.is_unique ||
    found.columns.length !== 1 ||
    found.columns[0] !== "label_id"
  ) {
    return false;
  }

  await sql`
    DROP INDEX ${sql.raw(`"${schemaName}"."${indexName}"`)}
  `.execute(db);
  return true;
}

export interface TenantIndexPreflightRow {
  schemaName: string;
  /** Targets that will be renamed - catalog-only, no rebuild, no lock risk. */
  willRename: string[];
  /** Targets that will be BUILT - these take a lock proportional to the table. */
  willCreate: Array<{ suffix: string; table: string; estimatedRows: number }>;
  /** Redundant duplicates that will be dropped. */
  willDrop: string[];
  /** UNIQUE targets whose data already conflicts. These ABORT the migration. */
  blocked: DuplicateBlocker[];
}

/**
 * Report what migration 063 would do, changing nothing.
 *
 * Two operational questions this answers before a deploy window:
 *
 *  1. WILL IT ABORT? A UNIQUE index cannot be built over conflicting rows, and
 *     the migration deliberately fails rather than deleting data. Finding that
 *     out here costs nothing; finding out during the deploy costs the window.
 *  2. HOW LONG WILL IT LOCK? Renames are catalog-only. Only a CREATE takes an
 *     ACCESS EXCLUSIVE lock for the duration of the build, so the row estimate
 *     for exactly those tables is the number that matters. Everything else is
 *     effectively instant.
 *
 * Row counts come from the planner's statistics (`pg_class.reltuples`), so
 * this stays cheap on large tables - it is an estimate, not a COUNT(*).
 */
export async function preflightTenantIndexNames<DB>(
  db: Kysely<DB>,
  schemaNames: readonly string[],
): Promise<TenantIndexPreflightRow[]> {
  const report: TenantIndexPreflightRow[] = [];

  for (const schemaName of schemaNames) {
    const row: TenantIndexPreflightRow = {
      schemaName,
      willRename: [],
      willCreate: [],
      willDrop: [],
      blocked: [],
    };

    for (const target of TENANT_INDEX_TARGETS) {
      // Exactly the decision reconciliation will make - same function, so the
      // report cannot diverge from the migration's behaviour.
      const action = await planTenantIndexAction(db, schemaName, target);

      switch (action.kind) {
        case "skip":
          break;
        case "already-correct":
          if (action.redundant) row.willDrop.push(target.suffix);
          break;
        case "rename":
          row.willRename.push(target.suffix);
          break;
        case "blocked":
          row.blocked.push(action.blocker);
          break;
        case "create":
          row.willCreate.push({
            suffix: target.suffix,
            table: target.table,
            estimatedRows: await estimatedRowCount(db, schemaName, target.table),
          });
          break;
      }
    }

    report.push(row);
  }

  return report;
}

/** Render a preflight report for an operator. */
export function formatPreflightReport(
  rows: readonly TenantIndexPreflightRow[],
): string {
  const renames = rows.reduce((n, row) => n + row.willRename.length, 0);
  const drops = rows.reduce((n, row) => n + row.willDrop.length, 0);
  const creates = rows.flatMap((row) =>
    row.willCreate.map((entry) => ({ ...entry, schemaName: row.schemaName })),
  );
  const blocked = rows.flatMap((row) => row.blocked);

  const lines = [
    `Migration 063 preflight across ${rows.length} tenant schema(s)`,
    "",
    `  renames (catalog-only, no lock risk): ${renames}`,
    `  redundant duplicates to drop:         ${drops}`,
    `  indexes to BUILD (take a lock):       ${creates.length}`,
    "",
  ];

  if (creates.length > 0) {
    const heaviest = [...creates]
      .sort((a, b) => b.estimatedRows - a.estimatedRows)
      .slice(0, 10);
    lines.push("  Largest builds (estimated rows - these hold ACCESS EXCLUSIVE):");
    for (const entry of heaviest) {
      lines.push(
        `    ${entry.schemaName}.${entry.table}${entry.suffix}: ~${entry.estimatedRows} rows`,
      );
    }
    lines.push("");
  }

  if (blocked.length > 0) {
    lines.push(
      "  BLOCKED - the migration will abort until these are resolved:",
      "",
      formatDuplicateBlockers(blocked),
    );
  } else {
    lines.push("  No duplicate conflicts found; the migration will not abort.");
  }

  return lines.join("\n");
}
