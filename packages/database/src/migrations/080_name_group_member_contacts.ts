import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Give unnamed group member contacts the name WhatsApp already knows.
 *
 * Migration 079 creates a contact for every stored group member, but creates it
 * bare. The group panel resolves a member's name from WhatsApp's address book
 * and from the names carried on their messages; the contact profile can only
 * read `contacts`. So a member's row said "Alice" while the profile it opened
 * said "+6591111111" - the same person under two identities.
 *
 * This names those rows in place, from the same two sources and in the same
 * order the panel displays, so the profile agrees with what was clicked. It is
 * separate from 077 rather than folded into it so that a workspace which
 * already ran 077 is repaired too.
 *
 * Only ever fills a blank:
 *  - `custom_name` is never read or written. It is the agent's own choice and
 *    outranks `push_name` in every display path.
 *  - A member already carrying a `push_name` is skipped, so a stale address
 *    book entry cannot walk back over a fresher name.
 *  - A candidate that merely repeats the member's own number is rejected; the
 *    display chain falls through to the phone column anyway, and storing it
 *    would look like a real name that later WhatsApp data must not overwrite.
 *
 * Connection scoped throughout: a member is named only from the address book
 * and messages of the connection whose group they belong to, so one workspace
 * account can never name a contact using another account's data.
 */

const NAMING_BATCH_SIZE = 500;
const MAX_BATCHES_PER_TENANT = 400;

export async function nameGroupMemberContacts(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<bigint> {
  const ready = await sql<{ ready: boolean }>`
    SELECT (
      to_regclass(${`${schemaName}.group_participants`}) IS NOT NULL
      AND to_regclass(${`${schemaName}.groups`}) IS NOT NULL
      AND to_regclass(${`${schemaName}.contacts`}) IS NOT NULL
      AND to_regclass(${`${schemaName}.messages`}) IS NOT NULL
      AND to_regclass('whatsapp_sessions.whatsmeow_contacts') IS NOT NULL
      AND to_regclass('whatsapp_sessions.whatsmeow_lid_mappings') IS NOT NULL
    ) AS ready
  `.execute(db);
  if (!ready.rows[0]?.ready) return 0n;

  const contacts = sql.table(`${schemaName}.contacts`);
  const participants = sql.table(`${schemaName}.group_participants`);
  const groups = sql.table(`${schemaName}.groups`);
  const messages = sql.table(`${schemaName}.messages`);

  // Some tenant schemas were provisioned after migration 034 was recorded but
  // before the tenant template carried the sender identity columns. Startup
  // migrations run before the API's runtime schema reconciler, so merely
  // assuming the globally-recorded migration repaired these later tenants
  // creates a bootstrap deadlock. Reconcile the two additive columns this
  // query reads before referencing them; existing columns and data are kept.
  await sql`
    ALTER TABLE ${messages}
      ADD COLUMN IF NOT EXISTS sender_jid TEXT,
      ADD COLUMN IF NOT EXISTS sender_name TEXT
  `.execute(db);

  let named = 0n;
  // One final probe beyond the write cap distinguishes exact exhaustion from
  // a tenant that exceeds the bounded migration budget.
  for (let batch = 0; batch <= MAX_BATCHES_PER_TENANT; batch += 1) {
    // The batch cap sits on rows that WILL be named, not on rows scanned. A cap
    // on the scan could fill a whole batch with unnameable members, name none,
    // and stop while nameable members were still waiting behind them.
    const result = await sql<{
      selected: string | number | bigint;
      affected: string | number | bigint;
    }>`
      WITH candidate AS (
        SELECT member.id, member.jid, member.whatsapp_connection_id
        FROM ${contacts} AS member
        WHERE member.is_group = false
          AND (member.push_name IS NULL OR btrim(member.push_name) = '')
          AND member.jid IS NOT NULL
          AND member.whatsapp_connection_id IS NOT NULL
          AND split_part(member.jid, '@', 2) = 's.whatsapp.net'
          -- Restricted to members of a group owned by this same connection, so
          -- the migration never touches an unrelated contact.
          AND EXISTS (
            SELECT 1
            FROM ${participants} AS participant
            INNER JOIN ${groups} AS grp
              ON grp.id = participant.group_id
            INNER JOIN ${contacts} AS group_contact
              ON group_contact.id = grp.contact_id
            WHERE group_contact.whatsapp_connection_id
                  = member.whatsapp_connection_id
              AND regexp_replace(participant.participant_jid, ':[0-9]+@', '@')
                  = member.jid
          )
      ),
      resolved AS (
        SELECT
          candidate.id,
          candidate.jid,
          trim(coalesce(
            -- WhatsApp's own address book for THIS connection.
            (
              SELECT coalesce(
                       nullif(btrim(stored.full_name), ''),
                       nullif(btrim(stored.push_name), ''),
                       nullif(btrim(stored.first_name), ''),
                       nullif(btrim(stored.business_name), '')
                     )
              FROM whatsapp_sessions.whatsmeow_contacts AS stored
              -- WhatsApp may hold the address book entry under the member's
              -- opaque LID rather than their phone JID. The mapping turns that
              -- entry back into the phone JID the member is stored under;
              -- without it the panel shows a name this migration cannot find.
              -- Mirrors fetchStoredWhatsAppNames, the API's single definition.
              LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS mapping
                ON mapping.connection_id::text = stored.connection_id::text
                AND regexp_replace(mapping.lid, ':[0-9]+@', '@')
                    = regexp_replace(stored.their_jid, ':[0-9]+@', '@')
              WHERE stored.connection_id::text
                    = candidate.whatsapp_connection_id::text
                AND regexp_replace(
                      coalesce(mapping.jid, stored.their_jid),
                      ':[0-9]+@',
                      '@'
                    ) = candidate.jid
              ORDER BY
                (
                  coalesce(
                    nullif(btrim(stored.full_name), ''),
                    nullif(btrim(stored.push_name), ''),
                    nullif(btrim(stored.first_name), ''),
                    nullif(btrim(stored.business_name), '')
                  ) IS NOT NULL
                ) DESC,
                CASE
                  WHEN nullif(btrim(stored.full_name), '') IS NOT NULL THEN 4
                  WHEN nullif(btrim(stored.push_name), '') IS NOT NULL THEN 3
                  WHEN nullif(btrim(stored.first_name), '') IS NOT NULL THEN 2
                  WHEN nullif(btrim(stored.business_name), '') IS NOT NULL THEN 1
                  ELSE 0
                END DESC,
                (
                  regexp_replace(stored.their_jid, ':[0-9]+@', '@')
                  = candidate.jid
                ) DESC,
                stored.their_jid,
                stored.our_jid
              LIMIT 1
            ),
            -- Otherwise the name WhatsApp put on their most recent message.
            (
              SELECT nullif(message.sender_name, '')
              FROM ${messages} AS message
              WHERE message.whatsapp_connection_id
                    = candidate.whatsapp_connection_id
                AND regexp_replace(message.sender_jid, ':[0-9]+@', '@')
                    = candidate.jid
                AND message.sender_name IS NOT NULL
              ORDER BY message.timestamp DESC
              LIMIT 1
            ),
            ''
          )) AS name
        FROM candidate
      ),
      nameable AS (
        SELECT resolved.id, resolved.name
        FROM resolved
        WHERE resolved.name <> ''
          -- Reject a "name" that is only the member's own number written out.
          -- Judged on what survives removing digits and phone punctuation, so
          -- "Alice 6591234567" is kept while "+65 9123 4567" is not. Mirrors
          -- resolveMemberPushName in the API's sync backfill.
          AND NOT (
            regexp_replace(resolved.name, '[0-9[:space:]+().-]', '', 'g') = ''
            AND regexp_replace(resolved.name, '\\D', '', 'g')
                = regexp_replace(
                    split_part(split_part(resolved.jid, '@', 1), ':', 1),
                    '\\D', '', 'g'
                  )
            AND regexp_replace(
                  split_part(split_part(resolved.jid, '@', 1), ':', 1),
                  '\\D', '', 'g'
                ) <> ''
          )
        LIMIT ${sql.lit(NAMING_BATCH_SIZE)}
      ),
      updated AS (
        UPDATE ${contacts} AS target
        SET push_name = nameable.name, updated_at = now()
        FROM nameable
        WHERE target.id = nameable.id
          -- Re-checked in the write so a name stored concurrently by the running
          -- application wins over the one this statement resolved.
          AND (target.push_name IS NULL OR btrim(target.push_name) = '')
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM nameable) AS selected,
        (SELECT count(*) FROM updated) AS affected
    `.execute(db);

    const selected = BigInt(result.rows[0]?.selected ?? 0);
    const affected = BigInt(result.rows[0]?.affected ?? 0);
    named += affected;
    // A concurrent application update may win the target.push_name re-check.
    // Continue based on the number selected so that such a no-op cannot hide
    // nameable contacts beyond this batch.
    if (batch === MAX_BATCHES_PER_TENANT && selected > 0n) {
      throw new Error(
        `Group member contact naming exceeded ${MAX_BATCHES_PER_TENANT * NAMING_BATCH_SIZE} rows in ${schemaName}`,
      );
    }
    if (selected < BigInt(NAMING_BATCH_SIZE)) break;
  }

  return named;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw("SET LOCAL lock_timeout = '5s'").execute(db);
  await sql.raw("SET LOCAL statement_timeout = '60s'").execute(db);

  await executeOnAllTenants(db, async (schemaName) => {
    const rowsNamed = await nameGroupMemberContacts(db, schemaName);
    if (rowsNamed > 0n) {
      console.log(`Named ${rowsNamed} group member contacts in ${schemaName}`);
    }
  });
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Not reversed. These names are indistinguishable from the push_name the
  // running application would have stored for the same member, and clearing
  // them would discard names WhatsApp has since confirmed.
}
