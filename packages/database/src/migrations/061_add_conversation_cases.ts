import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Conversation-lifecycle "cases" and separate response/resolution SLA
 * targets for direct and group chats.
 *
 * `sla_policies` (public, shipped by 060) is append-only/immutable and is
 * extended here - never rewritten - with three new columns alongside the
 * existing `target_minutes` (which keeps meaning "direct response target"):
 *   - direct_resolution_target_minutes
 *   - group_response_target_minutes
 *   - group_resolution_target_minutes
 * All four share the same calendar (timezone/weekly_schedule/exceptions) on
 * the row. Group conversations use the group targets workspace-wide; there
 * is no per-group override.
 *
 * `conversation_cases` (tenant-scoped) is the new immutable-per-cycle unit
 * that both SLA guarantees are measured against:
 *   - response SLA: each live inbound turn while a case is open/pending
 *   - resolution SLA: case opened_at -> resolved_at
 * A contact can have at most one active (open/pending) case at a time
 * (partial unique index). Every reopen - automatic (new live inbound after
 * resolution) or manual - creates a NEW case row; existing cases are never
 * reused or mutated back to open. Each case snapshots the SLA policy that
 * was active at `opened_at` (`policy_id` + the resolved target minutes for
 * its kind), so later policy edits never change how an already-open or
 * historical case is measured.
 *
 * `open_source`/`opened_by` are an immutable audit trail of how a case
 * came to exist: 'live_inbound' cases (`opened_by` null - no human actor)
 * come from openOrReopenCaseForInboundMessage; 'manual' cases (`opened_by`
 * the acting user) come from a Resolve-dialog-adjacent Open/Reopen action.
 * `reopened_from_case_id` is set for BOTH kinds of reopen (automatic and
 * manual) - it is not exclusive to manual reopens.
 *
 * `messages.case_id` is the durable, explicit link from a message to the
 * case it belongs to, assigned once at insert/case-resolution time in every
 * insert path (live inbound, live outbound send/forward/retry, scheduled
 * send, and the worker-relayed event handler). Case membership is NEVER
 * inferred from a timestamp window - `messages.timestamp` is
 * client/WhatsApp-supplied and can arrive delayed, out of order, or
 * (for imported history) dated arbitrarily far in the past or future, so
 * comparing it against `conversation_cases.opened_at`/`resolved_at` cannot
 * safely decide case membership. `case_id` is set exactly once, from
 * whichever case was actually active in the tenant database at the moment
 * the message was durably ingested, and never revisited.
 *
 * `messages.seq` is a strictly monotonic per-tenant sequence (a plain
 * nullable BIGINT column with a `nextval()` default attached AFTER the
 * column is added - never `GENERATED ALWAYS AS IDENTITY`, which would
 * force Postgres to backfill/rewrite the entire existing table) used as
 * the authoritative turn-ordering key for episode start/response detection
 * and "latest turn" checks - `created_at`/`id` alone cannot safely break
 * ties between rows inserted in the same millisecond. `seq` is NULL for
 * every pre-061 row and non-null for every row inserted from here on;
 * since `case_id` is null on exactly the same historical rows, this never
 * matters to any `seq`-ordered, case-scoped query. `messages_case_fk` is
 * ON DELETE SET NULL so a contact/case deletion is never blocked by
 * retained message rows.
 *
 * `conversation_states` (the current per-contact projection) gets
 * `active_case_id`, pointing at the contact's current open/pending case (or
 * null when resolved/never opened).
 *
 * Baseline: every existing conversation is closed as a non-SLA baseline -
 * `conversation_states.status` forced to 'resolved' with no active case, and
 * no `conversation_cases` row is fabricated for historical data. This also
 * backfills a resolved `conversation_states` row for any contact that never
 * had one, so "all currently existing conversations" really does mean all
 * contacts, not just ones that already had a projection row.
 */

const DIRECT_RESOLUTION_DEFAULT_MINUTES = 480; // 8 business hours
const GROUP_RESPONSE_DEFAULT_MINUTES = 120; // 2 business hours
const GROUP_RESOLUTION_DEFAULT_MINUTES = 960; // 16 business hours

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE public.sla_policies
    ADD COLUMN IF NOT EXISTS direct_resolution_target_minutes INTEGER
      NOT NULL DEFAULT ${sql.raw(String(DIRECT_RESOLUTION_DEFAULT_MINUTES))},
    ADD COLUMN IF NOT EXISTS group_response_target_minutes INTEGER
      NOT NULL DEFAULT ${sql.raw(String(GROUP_RESPONSE_DEFAULT_MINUTES))},
    ADD COLUMN IF NOT EXISTS group_resolution_target_minutes INTEGER
      NOT NULL DEFAULT ${sql.raw(String(GROUP_RESOLUTION_DEFAULT_MINUTES))}
  `.execute(db);

  await sql`
    ALTER TABLE public.sla_policies
    DROP CONSTRAINT IF EXISTS sla_policies_direct_resolution_target_minutes_check,
    ADD CONSTRAINT sla_policies_direct_resolution_target_minutes_check
    CHECK (direct_resolution_target_minutes BETWEEN 1 AND 20160),
    DROP CONSTRAINT IF EXISTS sla_policies_group_response_target_minutes_check,
    ADD CONSTRAINT sla_policies_group_response_target_minutes_check
    CHECK (group_response_target_minutes BETWEEN 1 AND 1440),
    DROP CONSTRAINT IF EXISTS sla_policies_group_resolution_target_minutes_check,
    ADD CONSTRAINT sla_policies_group_resolution_target_minutes_check
    CHECK (group_resolution_target_minutes BETWEEN 1 AND 20160)
  `.execute(db);

  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);

    await sql`
      CREATE TABLE IF NOT EXISTS ${table("conversation_cases")} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES ${table("contacts")}(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
        opened_at TIMESTAMPTZ NOT NULL,
        opening_message_id UUID,
        open_source TEXT NOT NULL CHECK (open_source IN ('live_inbound', 'manual')),
        opened_by UUID,
        policy_id UUID NOT NULL,
        response_target_minutes INTEGER NOT NULL CHECK (response_target_minutes BETWEEN 1 AND 1440),
        resolution_target_minutes INTEGER NOT NULL CHECK (resolution_target_minutes BETWEEN 1 AND 20160),
        reopened_from_case_id UUID,
        reopen_reason TEXT,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID,
        resolution_outcome TEXT CHECK (
          resolution_outcome IN ('handled', 'no_reply_needed', 'spam', 'duplicate', 'other')
        ),
        resolution_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT conversation_cases_resolution_fields_check CHECK (
          (status = 'resolved') = (
            resolved_at IS NOT NULL
            AND resolved_by IS NOT NULL
            AND resolution_outcome IS NOT NULL
          )
        ),
        CONSTRAINT conversation_cases_other_requires_notes_check CHECK (
          resolution_outcome IS DISTINCT FROM 'other'
          OR (resolution_notes IS NOT NULL AND length(trim(resolution_notes)) > 0)
        ),
        CONSTRAINT conversation_cases_resolved_after_opened_check CHECK (
          resolved_at IS NULL OR resolved_at >= opened_at
        ),
        -- 'manual' cases (Open/Reopen from the UI) always have a human actor;
        -- 'live_inbound' cases never do (no one clicked anything).
        CONSTRAINT conversation_cases_open_source_actor_check CHECK (
          (open_source = 'manual') = (opened_by IS NOT NULL)
        )
      )
    `.execute(db);

    await sql`
      ALTER TABLE ${table("conversation_cases")}
      DROP CONSTRAINT IF EXISTS conversation_cases_reopened_from_fk,
      ADD CONSTRAINT conversation_cases_reopened_from_fk
      FOREIGN KEY (reopened_from_case_id) REFERENCES ${table("conversation_cases")}(id)
    `.execute(db);
    await sql`
      ALTER TABLE ${table("conversation_cases")}
      DROP CONSTRAINT IF EXISTS conversation_cases_opening_message_fk,
      ADD CONSTRAINT conversation_cases_opening_message_fk
      FOREIGN KEY (opening_message_id) REFERENCES ${table("messages")}(id)
    `.execute(db);
    await sql`
      ALTER TABLE ${table("conversation_cases")}
      DROP CONSTRAINT IF EXISTS conversation_cases_policy_fk,
      ADD CONSTRAINT conversation_cases_policy_fk
      FOREIGN KEY (policy_id) REFERENCES public.sla_policies(id)
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_cc_active_uidx`,
      )}
      ON ${table("conversation_cases")} (contact_id)
      WHERE status IN ('open', 'pending')
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_cc_contact_idx`,
      )}
      ON ${table("conversation_cases")} (contact_id, created_at DESC)
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_cc_status_idx`,
      )}
      ON ${table("conversation_cases")} (status)
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_cc_resolved_idx`,
      )}
      ON ${table("conversation_cases")} (resolved_at)
      WHERE resolved_at IS NOT NULL
    `.execute(db);

    // Durable, explicit case membership for every message - see module doc
    // comment on why this can never be inferred from `messages.timestamp`.
    // ON DELETE SET NULL: a contact/case deletion (e.g. GDPR erasure, admin
    // cleanup) must never be blocked by retained message rows - orphaning a
    // message's case link is fine, losing the message itself is not.
    await sql`
      ALTER TABLE ${table("messages")}
      ADD COLUMN IF NOT EXISTS case_id UUID
    `.execute(db);
    await sql`
      ALTER TABLE ${table("messages")}
      DROP CONSTRAINT IF EXISTS messages_case_fk,
      ADD CONSTRAINT messages_case_fk
      FOREIGN KEY (case_id) REFERENCES ${table("conversation_cases")}(id)
      ON DELETE SET NULL
    `.execute(db);

    // A strictly monotonic per-tenant ingestion sequence, independent of
    // `created_at`'s millisecond resolution (two rows inserted in the same
    // millisecond, e.g. an inbound message and the outbound reply it
    // triggered, would otherwise tie under `created_at, id` ordering - `id`
    // is a random UUID and carries no temporal meaning). Episode start/
    // response ordering (episode-resolution.ts) and "latest turn" checks
    // (hasUnansweredLatestTurn) use this, never `created_at`/`id`, as the
    // authoritative turn order.
    //
    // Deliberately NOT `GENERATED ALWAYS AS IDENTITY` added via ALTER
    // TABLE: on an existing (potentially very large) `messages` table,
    // Postgres must populate an IDENTITY value for every existing row,
    // which rewrites the whole table under an ACCESS EXCLUSIVE lock - an
    // outage-sized cost for a column only ever consumed going forward
    // (`case_id` - and therefore `seq` - is never assigned on historical
    // rows either, see the `case_id` comment above). Instead: add a plain
    // nullable BIGINT column (fast, metadata-only, no rewrite), then
    // attach a sequence default AFTER the column exists (`ALTER COLUMN
    // ... SET DEFAULT` only affects rows inserted from here on - also
    // metadata-only). Every row inserted from this migration forward gets
    // a non-null, strictly increasing `seq`; every historical row keeps
    // `seq IS NULL` forever, which is fine since it also has `case_id IS
    // NULL` and is therefore already excluded from every `seq`-ordered
    // query.
    await sql`
      CREATE SEQUENCE IF NOT EXISTS ${table("messages_seq_seq")}
    `.execute(db);
    await sql`
      ALTER TABLE ${table("messages")}
      ADD COLUMN IF NOT EXISTS seq BIGINT
    `.execute(db);
    await sql`
      ALTER SEQUENCE ${table("messages_seq_seq")}
      OWNED BY ${table("messages")}.seq
    `.execute(db);
    await sql`
      ALTER TABLE ${table("messages")}
      ALTER COLUMN seq SET DEFAULT nextval(${sql.lit(`${schemaName}.messages_seq_seq`)})
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_messages_case_idx`)}
      ON ${table("messages")} (case_id, seq)
      WHERE case_id IS NOT NULL
    `.execute(db);

    // Two concurrent first-sends into the same unassigned contact must
    // never both succeed in claiming it - without a DB-level constraint,
    // `requireSendAccess`'s auto-claim (see send-access.service.ts) could
    // still race into two simultaneously-active assignments. Any existing
    // duplicates (there is currently no constraint preventing them) are
    // deterministically resolved first: for each contact, the most
    // recently assigned active row wins and every other active row for
    // that contact is closed out, so the unique index below can actually
    // be created.
    await sql`
      UPDATE ${table("contact_assignments")} ca
      SET unassigned_at = now()
      WHERE ca.unassigned_at IS NULL
        AND ca.id NOT IN (
          SELECT DISTINCT ON (contact_id) id
          FROM ${table("contact_assignments")}
          WHERE unassigned_at IS NULL
          ORDER BY contact_id, assigned_at DESC, id DESC
        )
    `.execute(db);
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_ca_active_uidx`,
      )}
      ON ${table("contact_assignments")} (contact_id)
      WHERE unassigned_at IS NULL
    `.execute(db);

    await sql`
      ALTER TABLE ${table("conversation_states")}
      ADD COLUMN IF NOT EXISTS active_case_id UUID
    `.execute(db);
    await sql`
      ALTER TABLE ${table("conversation_states")}
      DROP CONSTRAINT IF EXISTS conversation_states_active_case_fk,
      ADD CONSTRAINT conversation_states_active_case_fk
      FOREIGN KEY (active_case_id) REFERENCES ${table("conversation_cases")}(id)
      ON DELETE SET NULL
    `.execute(db);
    // The post-061 steady state is "resolved/case-free until a live inbound
    // opens a case" - a bare row-insert (e.g. read-before-inbound, a
    // manually created contact) must land there too, not in the pre-061
    // 'open' default (migration 047), which would fabricate a phantom
    // SLA-bearing state with no case behind it.
    await sql`
      ALTER TABLE ${table("conversation_states")}
      ALTER COLUMN status SET DEFAULT 'resolved'
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_cs_active_idx`,
      )}
      ON ${table("conversation_states")} (active_case_id)
      WHERE active_case_id IS NOT NULL
    `.execute(db);

    // Baseline: back-fill a resolved projection row for every contact that
    // never got a conversation_states row, then force every existing row
    // resolved/case-free. No conversation_cases rows are fabricated - the
    // baseline is deliberately not SLA-bearing.
    await sql`
      INSERT INTO ${table("conversation_states")} (contact_id, status, unread_count)
      SELECT c.id, 'resolved', 0
      FROM ${table("contacts")} c
      LEFT JOIN ${table("conversation_states")} cs ON cs.contact_id = c.id
      WHERE cs.id IS NULL
    `.execute(db);
    await sql`
      UPDATE ${table("conversation_states")}
      SET status = 'resolved', active_case_id = NULL, updated_at = now()
      WHERE status <> 'resolved' OR active_case_id IS NOT NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);
    // Restore the pre-061 default BEFORE dropping the structures it was
    // introduced alongside, so the table is never left in a state that
    // doesn't correspond to any migration version.
    await sql`
      ALTER TABLE ${table("conversation_states")}
      ALTER COLUMN status SET DEFAULT 'open'
    `.execute(db);
    await sql`ALTER TABLE ${table("conversation_states")} DROP COLUMN IF EXISTS active_case_id`.execute(
      db,
    );
    await sql`ALTER TABLE ${table("messages")} DROP COLUMN IF EXISTS case_id`.execute(
      db,
    );
    await sql`ALTER TABLE ${table("messages")} DROP COLUMN IF EXISTS seq`.execute(
      db,
    );
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}_ca_active_uidx`,
      )}
    `.execute(db);
    await sql`DROP TABLE IF EXISTS ${table("conversation_cases")}`.execute(db);
  });

  await sql`
    ALTER TABLE public.sla_policies
    DROP COLUMN IF EXISTS direct_resolution_target_minutes,
    DROP COLUMN IF EXISTS group_response_target_minutes,
    DROP COLUMN IF EXISTS group_resolution_target_minutes
  `.execute(db);
}
