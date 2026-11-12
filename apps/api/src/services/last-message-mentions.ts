import {
  extractPhoneFromJid,
  getLidDisplayName,
  normalizeJid,
} from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import {
  getNumericMentionIds,
  type MentionPreviewParticipant,
} from "./contact-mention-preview.js";
import { getSchemaName, type TenantDatabase } from "./tenant.service.js";
import { fetchStoredWhatsAppNames } from "./whatsapp-stored-names.js";

export interface LastMessageMentionTarget {
  /** The group contact whose inbox row shows this message. */
  contactId: string;
  connectionId: string;
  content: string | null;
}

/**
 * Name the people a group's last message mentions, for the inbox preview.
 *
 * WhatsApp writes a mention into the text as `@<token>`, where the token is a
 * phone number or an opaque LID. The open conversation resolves it from the
 * full group-member list; the inbox row only needs the handful of tokens its
 * last message actually uses, so this resolves exactly those, for the whole
 * page at once, with the same name precedence as the group panel
 * (`getEnrichedGroupParticipants`).
 *
 * LID aliasing follows the panel's rule: a mapping observed by this group's
 * own connection is authoritative; another connection's observation is used
 * only when it is globally unambiguous and names a current member of this
 * exact group. Unresolvable tokens are simply omitted, so the client keeps the
 * raw text rather than showing a guessed name.
 */
export async function resolveLastMessageMentions(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  targets: readonly LastMessageMentionTarget[],
): Promise<Map<string, MentionPreviewParticipant[]>> {
  const result = new Map<string, MentionPreviewParticipant[]>();
  const rows = targets
    .map((target) => ({
      ...target,
      tokens: getNumericMentionIds(target.content),
    }))
    .filter((row) => row.tokens.length > 0);
  if (rows.length === 0) return result;

  const allTokens = [...new Set(rows.flatMap((row) => row.tokens))];
  const mappings = await sql<{
    connection_id: string;
    token: string;
    jid: string;
  }>`
    SELECT DISTINCT
      mapping.connection_id,
      split_part(split_part(mapping.lid, '@', 1), ':', 1) AS token,
      split_part(split_part(mapping.jid, '@', 1), ':', 1)
        || '@' || split_part(mapping.jid, '@', 2) AS jid
    FROM whatsapp_sessions.whatsmeow_lid_mappings AS mapping
    WHERE split_part(split_part(mapping.lid, '@', 1), ':', 1)
      IN (${sql.join(allTokens.map((token) => sql`${token}`))})
  `.execute(tenantDb);

  // token -> connection -> jids, and token -> every jid across connections.
  const localJids = new Map<string, Map<string, Set<string>>>();
  const globalJids = new Map<string, Set<string>>();
  for (const mapping of mappings.rows) {
    const jid = normalizeJid(mapping.jid);
    if (!jid) continue;
    const byConnection =
      localJids.get(mapping.token) ?? new Map<string, Set<string>>();
    const local = byConnection.get(mapping.connection_id) ?? new Set<string>();
    local.add(jid);
    byConnection.set(mapping.connection_id, local);
    localJids.set(mapping.token, byConnection);
    const global = globalJids.get(mapping.token) ?? new Set<string>();
    global.add(jid);
    globalJids.set(mapping.token, global);
  }

  const onlyOne = (jids: Set<string> | undefined) =>
    jids?.size === 1 ? [...jids][0] : null;

  // Per row: token -> the identity it names, plus the cross-connection guesses
  // that still need a membership check.
  const planned = rows.map((row) => {
    const tokenJid = new Map<string, string>();
    const needsMembership = new Map<string, string>();
    for (const token of row.tokens) {
      // A member may also be stored directly under the LID form of the token.
      tokenJid.set(`${token}#lid`, `${token}@lid`);
      const byConnection = localJids.get(token);
      const local = byConnection?.get(row.connectionId);
      if (local) {
        // Any local observation, even an ambiguous one, suppresses fallback.
        const jid = onlyOne(local);
        if (jid) tokenJid.set(token, jid);
        continue;
      }
      const global = onlyOne(globalJids.get(token));
      if (global) {
        needsMembership.set(token, global);
        continue;
      }
      // No alias known: the token is itself a phone number or a LID that a
      // member may be stored under directly.
      tokenJid.set(token, `${token}@s.whatsapp.net`);
    }
    return { ...row, tokenJid, needsMembership };
  });

  const membershipCandidates = [
    ...new Set(planned.flatMap((row) => [...row.needsMembership.values()])),
  ];
  const members = membershipCandidates.length
    ? await tenantDb
        .selectFrom("group_participants")
        .innerJoin("groups", "groups.id", "group_participants.group_id")
        .select(["groups.contact_id", "group_participants.participant_jid"])
        .where(
          "groups.contact_id",
          "in",
          planned
            .filter((row) => row.needsMembership.size > 0)
            .map((row) => row.contactId),
        )
        .where("group_participants.participant_jid", "in", membershipCandidates)
        .execute()
    : [];
  const memberKeys = new Set(
    members.map(
      (member) =>
        `${member.contact_id}|${normalizeJid(member.participant_jid) ?? ""}`,
    ),
  );
  for (const row of planned) {
    for (const [token, jid] of row.needsMembership) {
      if (memberKeys.has(`${row.contactId}|${jid}`))
        row.tokenJid.set(token, jid);
    }
  }

  // Resolve names once per connection, for every identity on the page.
  const byConnection = new Map<string, typeof planned>();
  for (const row of planned) {
    const list = byConnection.get(row.connectionId) ?? [];
    list.push(row);
    byConnection.set(row.connectionId, list);
  }

  for (const [connectionId, connectionRows] of byConnection) {
    const jids = [
      ...new Set(connectionRows.flatMap((row) => [...row.tokenJid.values()])),
    ];
    if (jids.length === 0) continue;
    // Raw SQL is not schema-qualified by withSchema(); do it explicitly.
    const messages = sql.table(`${getSchemaName(companyId)}.messages`);

    const [contacts, storedNames, senders] = await Promise.all([
      tenantDb
        .selectFrom("contacts")
        .select(["jid", "custom_name", "push_name"])
        .where("whatsapp_connection_id", "=", connectionId)
        .where("jid", "in", jids)
        .execute(),
      fetchStoredWhatsAppNames(tenantDb, connectionId, jids),
      // One LIMIT-1 probe per identity on (whatsapp_connection_id,
      // sender_jid), so a chatty member never turns into a history scan.
      sql<{ sender_jid: string; sender_name: string | null }>`
        SELECT wanted.jid AS sender_jid, latest.sender_name
        FROM unnest(${sql.val(jids)}::text[]) AS wanted(jid)
        CROSS JOIN LATERAL (
          SELECT m.sender_name
          FROM ${messages} m
          WHERE m.whatsapp_connection_id = ${connectionId}
            AND m.sender_jid = wanted.jid
            AND m.sender_name IS NOT NULL
            AND btrim(m.sender_name) <> ''
          ORDER BY m.timestamp DESC
          LIMIT 1
        ) latest
      `
        .execute(tenantDb)
        .then((rows) => rows.rows),
    ]);

    const contactByJid = new Map(
      contacts.map((contact) => [contact.jid, contact]),
    );
    const senderNameByJid = new Map<string, string>();
    for (const sender of senders) {
      const jid = normalizeJid(sender.sender_jid);
      if (jid && sender.sender_name && !senderNameByJid.has(jid)) {
        senderNameByJid.set(jid, sender.sender_name);
      }
    }
    const nameFor = (jid: string): string | null => {
      const contact = contactByJid.get(jid);
      return (
        contact?.custom_name?.trim() ||
        contact?.push_name?.trim() ||
        storedNames.get(jid) ||
        senderNameByJid.get(jid)?.trim() ||
        null
      );
    };

    for (const row of connectionRows) {
      const participants: MentionPreviewParticipant[] = [];
      for (const token of row.tokens) {
        const mapped = row.tokenJid.get(token);
        const directLid = row.tokenJid.get(`${token}#lid`);
        const candidates = [mapped, directLid].filter((jid): jid is string =>
          Boolean(jid),
        );
        const named = candidates
          .map((jid) => ({ jid, name: nameFor(jid) }))
          .find((candidate) => candidate.name);
        let displayName = named?.name ?? null;
        if (!displayName && mapped && mapped !== `${token}@s.whatsapp.net`) {
          // A LID we could map to a phone identity but not to a name.
          const phone = extractPhoneFromJid(mapped);
          displayName = phone ? `+${phone}` : getLidDisplayName(mapped);
        }
        if (!displayName) continue;
        participants.push({ displayName, mentionIds: [token] });
      }
      if (participants.length > 0) result.set(row.contactId, participants);
    }
  }

  return result;
}
