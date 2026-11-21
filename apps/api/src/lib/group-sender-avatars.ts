import type { Kysely } from "kysely";
import type { TenantDatabase } from "../services/tenant.service.js";

/**
 * Group participants' avatars are cached on each message row
 * (`messages.sender_avatar_url`) because a participant often has no contact
 * conversation of their own. That cache is written by the profile-picture
 * event, which updates only the rows that exist when it lands, and the fetch
 * that produces it is throttled per sender. Every message a participant sends
 * after that update would otherwise be stored without an avatar, so one bubble
 * shows the picture and the next shows an initial.
 *
 * These helpers reuse the avatar already known for the sender instead: the
 * participant's own contact row on the same connection first, then the most
 * recent message by the same sender in the same group. The message lookup is
 * bounded to the group's latest messages so a sender with no known picture
 * cannot turn every insert or page read into a full history scan.
 */

const RECENT_MESSAGE_WINDOW = 500;

interface AvatarCandidateRow {
  contact_id: string | null;
  whatsapp_connection_id: string | null;
  from_me: boolean;
  sender_jid: string | null;
  sender_avatar_url: string | null;
}

interface AvatarLookup {
  groupId: string;
  connectionId: string;
  senderJid: string;
}

/** The lookup for a group-participant row that lacks an avatar, else null. */
function avatarLookup(row: AvatarCandidateRow): AvatarLookup | null {
  if (row.from_me || row.sender_avatar_url) return null;
  if (!row.sender_jid || row.sender_jid.endsWith("@g.us")) return null;
  if (!row.whatsapp_connection_id || !row.contact_id) return null;
  return {
    groupId: row.contact_id,
    connectionId: row.whatsapp_connection_id,
    senderJid: row.sender_jid,
  };
}

const pairKey = (scope: string, senderJid: string) =>
  `${scope}\u0000${senderJid}`;

/**
 * Fill missing participant avatars on a page of message rows. Rows that are
 * not group-participant messages, or already carry an avatar, are returned
 * unchanged. Never overwrites a stored avatar.
 */
export async function hydrateGroupSenderAvatars<T extends AvatarCandidateRow>(
  tenantDb: Kysely<TenantDatabase>,
  rows: T[],
): Promise<T[]> {
  const missing = rows
    .map(avatarLookup)
    .filter((lookup): lookup is AvatarLookup => lookup !== null);
  if (missing.length === 0) return rows;

  const connectionIds = [...new Set(missing.map((row) => row.connectionId))];
  const senderJids = [...new Set(missing.map((row) => row.senderJid))];

  const byConnection = new Map<string, string>();
  const contacts = await tenantDb
    .selectFrom("contacts")
    .select(["whatsapp_connection_id", "jid", "profile_picture_url"])
    .where("whatsapp_connection_id", "in", connectionIds)
    .where("jid", "in", senderJids)
    .where("profile_picture_url", "is not", null)
    .execute();
  for (const contact of contacts) {
    if (
      contact.whatsapp_connection_id &&
      contact.jid &&
      contact.profile_picture_url
    ) {
      byConnection.set(
        pairKey(contact.whatsapp_connection_id, contact.jid),
        contact.profile_picture_url,
      );
    }
  }

  // Senders without a contact picture (for example an unmapped LID identity)
  // may still have one cached on an earlier message in the same group.
  const unresolved = missing.filter(
    (row) => !byConnection.has(pairKey(row.connectionId, row.senderJid)),
  );
  const byGroup = new Map<string, string>();
  const groupIds = [...new Set(unresolved.map((row) => row.groupId))];
  for (const groupId of groupIds) {
    const groupSenders = [
      ...new Set(
        unresolved
          .filter((row) => row.groupId === groupId)
          .map((row) => row.senderJid),
      ),
    ];
    const known = await tenantDb
      .selectFrom((eb) =>
        eb
          .selectFrom("messages")
          .select([
            "whatsapp_connection_id",
            "sender_jid",
            "sender_avatar_url",
            "timestamp",
          ])
          .where("contact_id", "=", groupId)
          .orderBy("timestamp", "desc")
          .orderBy("id", "desc")
          .limit(RECENT_MESSAGE_WINDOW)
          .as("recent"),
      )
      .select([
        "recent.whatsapp_connection_id",
        "recent.sender_jid",
        "recent.sender_avatar_url",
      ])
      .where("recent.sender_avatar_url", "is not", null)
      .where("recent.sender_jid", "in", groupSenders)
      .orderBy("recent.timestamp", "desc")
      .execute();
    for (const row of known) {
      if (!row.whatsapp_connection_id || !row.sender_jid) continue;
      if (!row.sender_avatar_url) continue;
      const key = pairKey(
        `${groupId}\u0000${row.whatsapp_connection_id}`,
        row.sender_jid,
      );
      // Newest first: keep the most recent picture for each sender.
      if (!byGroup.has(key)) byGroup.set(key, row.sender_avatar_url);
    }
  }

  return rows.map((row) => {
    const lookup = avatarLookup(row);
    if (!lookup) return row;
    const avatar =
      byConnection.get(pairKey(lookup.connectionId, lookup.senderJid)) ??
      byGroup.get(
        pairKey(
          `${lookup.groupId}\u0000${lookup.connectionId}`,
          lookup.senderJid,
        ),
      );
    return avatar ? { ...row, sender_avatar_url: avatar } : row;
  });
}

/** The avatar already known for one group participant, for a new message. */
export async function findKnownGroupSenderAvatar(
  tenantDb: Kysely<TenantDatabase>,
  input: { connectionId: string; groupContactId: string; senderJid: string },
): Promise<string | null> {
  const [row] = await hydrateGroupSenderAvatars(tenantDb, [
    {
      contact_id: input.groupContactId,
      whatsapp_connection_id: input.connectionId,
      from_me: false,
      sender_jid: input.senderJid,
      sender_avatar_url: null,
    },
  ]);
  return row?.sender_avatar_url ?? null;
}
