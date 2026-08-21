import { type Kysely, sql } from "kysely";

/**
 * Persist immutable worker identity, per-generation Linux credentials, and
 * rolling WhatsApp worker upgrades independently of the orchestrator process.
 * The additions retain defaults so pre-071 INSERT statements remain valid.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE SEQUENCE worker_os_identity_seq
      AS INTEGER MINVALUE 100000 MAXVALUE 2147483646 START 100000 NO CYCLE
  `.execute(db);

  // nextval is evaluated once per existing/new row. worker_gid is generated
  // from worker_uid, so UID/GID can never diverge and older writers need not
  // know either column.
  await sql`
    ALTER TABLE worker_registry
      ADD COLUMN artifact_version VARCHAR(128) NOT NULL DEFAULT 'embedded',
      ADD COLUMN artifact_sha256 VARCHAR(64) NOT NULL DEFAULT '',
      ADD COLUMN worker_uid INTEGER NOT NULL
        DEFAULT nextval('worker_os_identity_seq'),
      ADD COLUMN worker_gid INTEGER GENERATED ALWAYS AS (worker_uid) STORED
  `.execute(db);

  await sql`
    ALTER TABLE worker_registry
      ADD CONSTRAINT worker_registry_artifact_version_check
        CHECK (artifact_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
      ADD CONSTRAINT worker_registry_artifact_sha256_check
        CHECK (artifact_sha256 = '' OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
      ADD CONSTRAINT worker_registry_os_identity_check
        CHECK (worker_uid BETWEEN 100000 AND 2147483646 AND worker_gid = worker_uid)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX worker_registry_worker_uid_key
      ON worker_registry (worker_uid)
  `.execute(db);

  await sql`
    CREATE TABLE worker_upgrade_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      target_artifact_version VARCHAR(128) NOT NULL,
      target_artifact_sha256 VARCHAR(64) NOT NULL,
      phase VARCHAR(20) NOT NULL DEFAULT 'stop',
      result VARCHAR(20),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT worker_upgrade_batches_artifact_check
        CHECK (target_artifact_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
          AND target_artifact_sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT worker_upgrade_batches_phase_check
        CHECK (phase IN ('stop', 'launch', 'verify', 'rollback', 'recovery', 'halted', 'abandoned')),
      CONSTRAINT worker_upgrade_batches_result_check
        CHECK (result IS NULL OR result IN ('completed', 'rolled_back', 'abandoned')),
      CONSTRAINT worker_upgrade_batches_completion_check
        CHECK ((completed_at IS NULL AND result IS NULL) OR
               (completed_at IS NOT NULL AND result IS NOT NULL))
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX worker_upgrade_batches_one_active_idx
      ON worker_upgrade_batches ((true))
      WHERE completed_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE worker_upgrade_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID NOT NULL REFERENCES worker_upgrade_batches(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      company_id UUID NOT NULL,
      tenant_schema VARCHAR(100) NOT NULL,
      connection_id UUID NOT NULL,
      source_generation UUID NOT NULL,
      source_artifact_version VARCHAR(128) NOT NULL,
      source_artifact_sha256 VARCHAR(64) NOT NULL,
      target_generation UUID,
      recovery_generation UUID,
      rollback_generation UUID,
      phase VARCHAR(20) NOT NULL DEFAULT 'stop',
      result VARCHAR(32),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      CONSTRAINT worker_upgrade_items_source_artifact_check
        CHECK (source_artifact_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
          AND source_artifact_sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT worker_upgrade_items_phase_check
        CHECK (phase IN ('stop', 'launch', 'verify', 'recovery', 'rollback', 'canceled', 'halted', 'abandoned')),
      CONSTRAINT worker_upgrade_items_result_check
        CHECK (result IS NULL OR result IN
          ('target_complete', 'rollback_complete', 'canceled_untouched',
           'abandoned_external')),
      CONSTRAINT worker_upgrade_items_completion_check
        CHECK ((completed_at IS NULL AND result IS NULL) OR
               (completed_at IS NOT NULL AND result IS NOT NULL)),
      CONSTRAINT worker_upgrade_items_batch_position_key UNIQUE (batch_id, position),
      CONSTRAINT worker_upgrade_items_batch_connection_key UNIQUE (batch_id, connection_id),
      CONSTRAINT worker_upgrade_items_snapshot_key
        UNIQUE (batch_id, company_id, connection_id, source_generation)
    )
  `.execute(db);

  await sql`
    CREATE INDEX worker_upgrade_items_batch_order_idx
      ON worker_upgrade_items (batch_id, position)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS worker_upgrade_items`.execute(db);
  await sql`DROP TABLE IF EXISTS worker_upgrade_batches`.execute(db);
  await sql`DROP INDEX IF EXISTS worker_registry_worker_uid_key`.execute(db);
  await sql`
    ALTER TABLE worker_registry
      DROP CONSTRAINT IF EXISTS worker_registry_artifact_sha256_check,
      DROP CONSTRAINT IF EXISTS worker_registry_artifact_version_check,
      DROP CONSTRAINT IF EXISTS worker_registry_os_identity_check,
      DROP COLUMN IF EXISTS worker_gid,
      DROP COLUMN IF EXISTS worker_uid,
      DROP COLUMN IF EXISTS artifact_sha256,
      DROP COLUMN IF EXISTS artifact_version
  `.execute(db);
  await sql`DROP SEQUENCE IF EXISTS worker_os_identity_seq`.execute(db);
}
