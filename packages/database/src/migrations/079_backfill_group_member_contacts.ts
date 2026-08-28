import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Give already-stored group members a contact row.
 *
 * Inbound group messages only ever created a contact for the GROUP, keeping the
 * author on the message row instead, so a member was reachable as a contact
 * only when they also held a direct conversation. Group member identities were
 * therefore not openable, and in a typical group exactly one member - whoever
 * also DMs this account - appeared clickable.
 *
 * The snapshot sync now backfills members as it reconciles them, but that only
 * helps once WhatsApp sends a fresh participant-bearing snapshot. This repairs
 * the membership already persisted, so existing workspaces do not have to
 * reconnect or re-sync every group by hand.
 *
 * Deliberately narrow, on the same rules the sync applies:
 *  - Connection scoped. The owning connection comes from the GROUP's own
 *    contact row, so a member is only ever created against the account that
 *    actually shares the group with them.
 *  - Phone JIDs only. WhatsApp also addresses members as opaque `@lid`
 *    identities; a contact keyed on a LID would duplicate that person the
 *    moment their phone JID appears, which is the collision migration 038 had
 *    to clean up.
 *  - Never the connected account itself, so no self-conversation is invented.
 *  - No `conversation_states` row, so these contacts read as "resolved" and
 *    stay out of the default inbox until the member actually messages in.
 */

/** Bounded so one oversized tenant cannot hold a lock for the whole batch. */
const BACKFILL_BATCH_SIZE = 500;

/**
 * Guards against an unbounded loop if a future schema change ever broke the
 * "inserted rows stop matching" invariant this converges on.
 */
const MAX_BATCHES_PER_TENANT = 400;

export async function backfillGroupMemberContacts(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<bigint> {
  // A schema provisioned before group administration shipped has no membership
  // to repair; skip it rather than failing the whole migration.
  const tablesReady = await sql<{ ready: boolean }>`
    SELECT (
      to_regclass(${`${schemaName}.group_participants`}) IS NOT NULL
      AND to_regclass(${`${schemaName}.groups`}) IS NOT NULL
      AND to_regclass(${`${schemaName}.contacts`}) IS NOT NULL
      AND to_regclass(${`${schemaName}.whatsapp_connections`}) IS NOT NULL
    ) AS ready
  `.execute(db);
  if (!tablesReady.rows[0]?.ready) return 0n;

  const contacts = sql.table(`${schemaName}.contacts`);
  const participants = sql.table(`${schemaName}.group_participants`);
  const groups = sql.table(`${schemaName}.groups`);
  const connections = sql.table(`${schemaName}.whatsapp_connections`);

  let inserted = 0n;
  // One final probe beyond the write cap distinguishes exact exhaustion from
  // a tenant that exceeds the bounded migration budget.
  for (let batch = 0; batch <= MAX_BATCHES_PER_TENANT; batch += 1) {
    const result = await sql<{
      selected: string | number | bigint;
      affected: string | number | bigint;
    }>`
      WITH candidate AS MATERIALIZED (
        SELECT member.connection_id, member.jid
        FROM (
          SELECT DISTINCT
            group_contact.whatsapp_connection_id AS connection_id,
            regexp_replace(participant.participant_jid, ':[0-9]+@', '@') AS jid
          FROM ${participants} AS participant
          INNER JOIN ${groups} AS grp
            ON grp.id = participant.group_id
          INNER JOIN ${contacts} AS group_contact
            ON group_contact.id = grp.contact_id
          LEFT JOIN ${connections} AS connection
            ON connection.id = group_contact.whatsapp_connection_id
          WHERE group_contact.whatsapp_connection_id IS NOT NULL
            -- Phone namespace only; LID/hosted-LID/group locals are opaque.
            AND split_part(participant.participant_jid, '@', 2) = 's.whatsapp.net'
            -- Never the account that owns the connection. Older connected
            -- rows can lack jid, so fall back to their persisted phone number
            -- rather than creating a direct contact for the account itself.
            AND (
              coalesce(
                nullif(regexp_replace(connection.jid, ':[0-9]+@', '@'), ''),
                nullif(regexp_replace(connection.phone_number, '\\D', '', 'g'), '')
                  || '@s.whatsapp.net'
              ) IS NULL
              OR coalesce(
                nullif(regexp_replace(connection.jid, ':[0-9]+@', '@'), ''),
                nullif(regexp_replace(connection.phone_number, '\\D', '', 'g'), '')
                  || '@s.whatsapp.net'
              ) <> regexp_replace(participant.participant_jid, ':[0-9]+@', '@')
            )
        ) AS member
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${contacts} AS existing
          WHERE existing.whatsapp_connection_id = member.connection_id
            AND existing.jid = member.jid
        )
        LIMIT ${sql.lit(BACKFILL_BATCH_SIZE)}
      ),
      inserted AS (
        INSERT INTO ${contacts} (
          id,
          whatsapp_connection_id,
          jid,
          phone_number,
          is_group,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          candidate.connection_id,
          candidate.jid,
          nullif(
            regexp_replace(split_part(candidate.jid, '@', 1), '\\D', '', 'g'),
            ''
          ),
          false,
          now(),
          now()
        FROM candidate
        -- Absorbs a member the running application created concurrently rather
        -- than aborting the migration for the whole tenant.
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM candidate) AS selected,
        (SELECT count(*) FROM inserted) AS affected
    `.execute(db);

    const selected = BigInt(result.rows[0]?.selected ?? 0);
    const affected = BigInt(result.rows[0]?.affected ?? 0);
    inserted += affected;
    // Terminate on source exhaustion, not the number inserted. A concurrent
    // application insert can turn a selected row into an ON CONFLICT no-op;
    // that must not hide later candidates from the next batch.
    if (batch === MAX_BATCHES_PER_TENANT && selected > 0n) {
      throw new Error(
        `Group member contact backfill exceeded ${MAX_BATCHES_PER_TENANT * BACKFILL_BATCH_SIZE} rows in ${schemaName}`,
      );
    }
    if (selected < BigInt(BACKFILL_BATCH_SIZE)) break;
  }

  return inserted;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // Fail rather than waiting behind an unexpected production lock. The write is
  // an append of new rows keyed by a unique index, so it contends with ordinary
  // contact inserts only, but the deployment should still not stall on one.
  await sql.raw("SET LOCAL lock_timeout = '5s'").execute(db);
  await sql.raw("SET LOCAL statement_timeout = '60s'").execute(db);

  await executeOnAllTenants(db, async (schemaName) => {
    const rowsInserted = await backfillGroupMemberContacts(db, schemaName);
    if (rowsInserted > 0n) {
      console.log(
        `Backfilled ${rowsInserted} group member contacts in ${schemaName}`,
      );
    }
  });
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Not reversed. These rows are indistinguishable from a contact the running
  // application would have created for the same member, and by the time a
  // rollback ran some could already carry names, tags, notes or assignments.
}
