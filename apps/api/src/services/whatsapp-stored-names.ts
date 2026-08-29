import { type Kysely, sql } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

/**
 * WhatsApp's own address book, as the product displays it.
 *
 * This is the single definition of "the name WhatsApp knows for this member".
 * Both the group panel (`getEnrichedGroupParticipants`) and the member-contact
 * backfill read it through here, because a member whose row says "Alice" must
 * open a profile that also says "Alice" - and the two agreeing is only
 * guaranteed if they resolve the name the same way.
 *
 * The LID join is the part that is easy to lose. WhatsApp may store an address
 * book entry under a member's opaque `@lid` identity rather than their phone
 * JID, so matching `their_jid` directly misses the name entirely; the mapping
 * table is what turns that entry back into the phone JID the member is stored
 * under. A copy of this query without the join silently disagrees with the
 * panel for exactly those members.
 *
 * Connection scoped: both the address book and the mapping are filtered to one
 * connection, so a member is never named from another account's data.
 */
export async function fetchStoredWhatsAppNames(
  db: Kysely<TenantDatabase>,
  connectionId: string,
  memberJids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (memberJids.length === 0) return names;

  const stored = await sql<{ jid: string; name: string | null }>`
    SELECT DISTINCT ON (normalized_jid)
      normalized_jid AS jid,
      coalesce(
        nullif(btrim(stored.full_name), ''),
        nullif(btrim(stored.push_name), ''),
        nullif(btrim(stored.first_name), ''),
        nullif(btrim(stored.business_name), '')
      ) AS name
    FROM (
      SELECT
        contacts.*,
        regexp_replace(
          coalesce(mapping.jid, contacts.their_jid),
          ':[0-9]+@',
          '@'
        ) AS normalized_jid
      FROM whatsapp_sessions.whatsmeow_contacts AS contacts
      LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS mapping
        ON mapping.connection_id::text = contacts.connection_id::text
        AND regexp_replace(mapping.lid, ':[0-9]+@', '@') =
            regexp_replace(contacts.their_jid, ':[0-9]+@', '@')
      WHERE contacts.connection_id::text = ${connectionId}
    ) AS stored
    WHERE normalized_jid IN (${sql.join(memberJids.map((jid) => sql`${jid}`))})
    ORDER BY
      normalized_jid,
      -- Multiple cache rows can normalize to one phone JID (a direct entry and
      -- one or more mapped LIDs). Never let an unnamed row hide a named one;
      -- then prefer the richest WhatsApp field, the direct phone-JID entry,
      -- and finally stable protocol keys so every caller resolves identically.
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
      (regexp_replace(stored.their_jid, ':[0-9]+@', '@') = normalized_jid) DESC,
      stored.their_jid,
      stored.our_jid
  `.execute(db);

  for (const row of stored.rows) {
    if (row.name) names.set(row.jid, row.name);
  }
  return names;
}
