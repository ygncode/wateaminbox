import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Persist WhatsApp's own view of a group so administration can be enforced.
 *
 * Group administration (permissions, invite links, join requests, leaving) has
 * to answer questions the previous `groups` shape could not: may this account
 * still act on the group at all, who owns it, which permissions are currently
 * set, and what invite link WhatsApp last handed out. Storing that here lets
 * the API refuse an action locally when WhatsApp would reject it anyway, and -
 * more importantly - lets every one of these values be written ONLY after
 * WhatsApp confirms it, instead of being guessed at request time.
 *
 * `is_member` is what makes leaving expressible. WhatsApp has no "delete
 * group" primitive: leaving keeps the group alive for its other members and
 * only ends this account's membership, so the row is retained (its history
 * still belongs in the inbox) and flagged instead of removed.
 */
export const GROUP_JOIN_REQUEST_UNIQUE_INDEX = (schemaName: string): string =>
  `${schemaName}_gjr_group_jid_uidx`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);

    await sql`
      ALTER TABLE ${table("groups")}
      ADD COLUMN IF NOT EXISTS owner_jid VARCHAR(255),
      ADD COLUMN IF NOT EXISTS is_announce BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_ephemeral BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS disappearing_timer INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_join_approval_required BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS member_add_mode VARCHAR(32),
      ADD COLUMN IF NOT EXISTS is_member BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS invite_link TEXT,
      ADD COLUMN IF NOT EXISTS invite_link_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS metadata_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS join_requests_synced_at TIMESTAMPTZ
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${table("group_join_requests")} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL
          REFERENCES ${table("groups")}(id) ON DELETE CASCADE,
        requester_jid VARCHAR(255) NOT NULL,
        requested_at TIMESTAMPTZ,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        GROUP_JOIN_REQUEST_UNIQUE_INDEX(schemaName),
      )}
      ON ${table("group_join_requests")} (group_id, requester_jid)
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);

    await sql`DROP TABLE IF EXISTS ${table("group_join_requests")}`.execute(db);
    await sql`
      ALTER TABLE ${table("groups")}
      DROP COLUMN IF EXISTS owner_jid,
      DROP COLUMN IF EXISTS is_announce,
      DROP COLUMN IF EXISTS is_locked,
      DROP COLUMN IF EXISTS is_ephemeral,
      DROP COLUMN IF EXISTS disappearing_timer,
      DROP COLUMN IF EXISTS is_join_approval_required,
      DROP COLUMN IF EXISTS member_add_mode,
      DROP COLUMN IF EXISTS is_member,
      DROP COLUMN IF EXISTS invite_link,
      DROP COLUMN IF EXISTS invite_link_updated_at,
      DROP COLUMN IF EXISTS metadata_synced_at,
      DROP COLUMN IF EXISTS join_requests_synced_at
    `.execute(db);
  });
}
