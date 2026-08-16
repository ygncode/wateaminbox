/**
 * The single writer of WhatsApp-confirmed group state.
 *
 * Group administration routes never write `groups`, `group_participants` or
 * `group_join_requests`: they enqueue a command and return. The worker executes
 * it, re-reads the group from WhatsApp, and publishes what WhatsApp actually
 * reports. Everything in this module runs from that event.
 *
 * Keeping the write path here is what makes "no optimistic authoritative state"
 * enforceable rather than a convention - a route that wanted to pre-apply a
 * change would have to reach past this module to do it.
 *
 * Every function here writes on a transaction its CALLER owns, and none opens
 * one of its own. That is deliberate: a worker event may only write rows for a
 * live connection, which the caller establishes by holding the connection fence
 * (see handlers/connection-event-guard.ts) for the whole event. A transaction
 * started down here would sit outside that fence and could commit group rows
 * for a connection being permanently purged.
 *
 * Lock order, everywhere: the connection fence first, then the per-group
 * advisory lock taken by `resolveGroupTarget`. Nothing in this module takes the
 * fence itself, so keeping that order is the caller's job.
 */

import {
  extractPhoneFromJid,
  normalizeJid,
  toDbDate,
} from "@wateaminbox/shared";
import { sql, type Transaction } from "kysely";
import { createLogger } from "../lib/logger.js";
import type { GroupSnapshotPayload } from "../lib/nats/index.js";
import type { TenantDatabase } from "./tenant.service.js";

const logger = createLogger("GroupSync");

export interface GroupSyncTarget {
  contactId: string;
  groupId: string;
  jid: string;
}

/**
 * The identity key for a group member.
 *
 * WhatsApp addresses one person in several ways - with and without a device
 * suffix, and in either case - so "is this the same member" cannot be a string
 * comparison. There is no database constraint enforcing this; `group_participants`
 * carries only a plain index on `participant_jid`. Collapsing duplicates is
 * therefore this module's job, and `reconcileParticipants` is what removes rows
 * an earlier sync left behind.
 */
function participantIndexKey(jid: string): string {
  return jid
    .trim()
    .toLowerCase()
    .replace(/:[^@]+@/, "@");
}

/**
 * A group's participant list as WhatsApp reported it, de-duplicated the same
 * way the database de-duplicates it. WhatsApp can list one member under both a
 * device-suffixed and a bare JID.
 */
function normalizeParticipants(
  participants: GroupSnapshotPayload["participants"],
): Array<{ jid: string; isAdmin: boolean }> | null {
  if (!participants) return null;
  const byKey = new Map<string, { jid: string; isAdmin: boolean }>();
  for (const participant of participants) {
    const jid = normalizeJid(participant.jid);
    if (!jid) continue;
    const key = participantIndexKey(jid);
    const existing = byKey.get(key);
    // Admin wins on conflict: the same member listed twice is one member, and
    // treating them as a plain participant would hide their real permissions.
    byKey.set(key, {
      jid: existing?.jid ?? jid,
      isAdmin: (existing?.isAdmin ?? false) || participant.isAdmin,
    });
  }
  return [...byKey.values()];
}

/**
 * Reconcile stored membership against WhatsApp's list without rewriting rows
 * that did not change.
 *
 * A wholesale delete-and-reinsert would be simpler, but `joined_at` is real
 * data the group panel shows, and snapshots now arrive after every command and
 * every live group change - so rewriting every row would silently redefine
 * "joined at" as "last synced at".
 */
async function reconcileParticipants(
  trx: Transaction<TenantDatabase>,
  groupId: string,
  participants: Array<{ jid: string; isAdmin: boolean }>,
): Promise<void> {
  const existing = await trx
    .selectFrom("group_participants")
    .select(["id", "participant_jid", "is_admin"])
    .where("group_id", "=", groupId)
    .execute();

  const desired = new Map(
    participants.map((participant) => [
      participantIndexKey(participant.jid),
      participant,
    ]),
  );
  const seen = new Set<string>();
  const staleIds: string[] = [];

  for (const row of existing) {
    const key = participantIndexKey(row.participant_jid);
    const wanted = desired.get(key);
    if (!wanted || seen.has(key)) {
      // Gone from the group, or a duplicate row left by an older sync.
      staleIds.push(row.id);
      continue;
    }
    seen.add(key);
    if (row.is_admin !== wanted.isAdmin) {
      await trx
        .updateTable("group_participants")
        .set({ is_admin: wanted.isAdmin })
        .where("id", "=", row.id)
        .execute();
    }
  }

  if (staleIds.length > 0) {
    await trx
      .deleteFrom("group_participants")
      .where("id", "in", staleIds)
      .execute();
  }

  const added = [...desired.entries()].filter(([key]) => !seen.has(key));
  if (added.length > 0) {
    await trx
      .insertInto("group_participants")
      .values(
        added.map(([, participant]) => ({
          group_id: groupId,
          participant_jid: participant.jid,
          is_admin: participant.isAdmin,
        })),
      )
      .execute();
  }
}

/**
 * Find the contact and group rows for a group JID on one connection, creating
 * them when WhatsApp reports a group the workspace has not seen yet (a group
 * this account just created, or was added to while the worker was offline).
 */
export async function resolveGroupTarget(
  trx: Transaction<TenantDatabase>,
  connectionId: string,
  rawJid: string,
  options: { create: boolean } = { create: true },
): Promise<GroupSyncTarget | null> {
  const jid = normalizeJid(rawJid);
  if (!jid) return null;

  // Serialize concurrent syncs of the SAME group before the find-or-create
  // below. Two events for one group routinely arrive together - creating a
  // group emits both a command result and WhatsApp's own JoinedGroup event -
  // and without this both transactions would see "no rows" and both insert.
  // `contacts (connection, jid)` and `groups (contact_id)` are unique, so the
  // loser would abort and be redelivered; the lock turns that retry storm into
  // an ordinary second pass that simply finds the rows. Mirrors the advisory
  // lock `claimConnectedSession` takes for the same class of race.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${connectionId}:${jid}`}, 2))`.execute(
    trx,
  );

  let contact = await trx
    .selectFrom("contacts")
    .select(["id"])
    .where("jid", "=", jid)
    .where("whatsapp_connection_id", "=", connectionId)
    .executeTakeFirst();

  if (!contact) {
    if (!options.create) return null;
    const contactId = crypto.randomUUID();
    await trx
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid,
        phone_number: extractPhoneFromJid(jid),
        is_group: true,
        created_at: toDbDate(),
        updated_at: toDbDate(),
      })
      .execute();
    contact = { id: contactId };
  }

  let group = await trx
    .selectFrom("groups")
    .select(["id"])
    .where("contact_id", "=", contact.id)
    .executeTakeFirst();

  if (!group) {
    if (!options.create) return null;
    group = await trx
      .insertInto("groups")
      .values({ contact_id: contact.id, jid })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  return { contactId: contact.id, groupId: group.id, jid };
}

/**
 * Apply a group snapshot on the caller's transaction.
 *
 * Fields WhatsApp did not report are left untouched. That distinction matters:
 * a partial change notification names only what changed, and writing defaults
 * for the rest would silently reset permissions the server never mentioned.
 *
 * `companyId` is carried for logging only - `trx` already targets that tenant -
 * so a warning here names the workspace the same way its event did.
 */
export async function syncGroupSnapshotWithin(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  connectionId: string,
  snapshot: GroupSnapshotPayload,
): Promise<GroupSyncTarget | null> {
  const participants = normalizeParticipants(snapshot.participants);

  const target = await resolveGroupTarget(trx, connectionId, snapshot.jid);
  if (!target) {
    logger.warn(
      { companyId, connectionId, jid: snapshot.jid },
      "Ignoring group snapshot with an unusable JID",
    );
    return null;
  }

  const participantCount =
    snapshot.participantCount !== undefined
      ? Math.max(0, snapshot.participantCount)
      : participants?.length;

  await trx
    .updateTable("groups")
    .set({
      jid: target.jid,
      ...(snapshot.name !== undefined ? { name: snapshot.name || null } : {}),
      ...(snapshot.description !== undefined
        ? { description: snapshot.description || null }
        : {}),
      ...(snapshot.ownerJid !== undefined
        ? { owner_jid: normalizeJid(snapshot.ownerJid) }
        : {}),
      ...(participantCount !== undefined
        ? { participant_count: participantCount }
        : {}),
      ...(snapshot.isAnnounce !== undefined
        ? { is_announce: snapshot.isAnnounce }
        : {}),
      ...(snapshot.isLocked !== undefined
        ? { is_locked: snapshot.isLocked }
        : {}),
      ...(snapshot.isEphemeral !== undefined
        ? { is_ephemeral: snapshot.isEphemeral }
        : {}),
      ...(snapshot.disappearingTimer !== undefined
        ? { disappearing_timer: Math.max(0, snapshot.disappearingTimer) }
        : {}),
      ...(snapshot.isJoinApprovalRequired !== undefined
        ? { is_join_approval_required: snapshot.isJoinApprovalRequired }
        : {}),
      ...(snapshot.memberAddMode !== undefined
        ? { member_add_mode: snapshot.memberAddMode || null }
        : {}),
      ...(snapshot.isMember !== undefined
        ? { is_member: snapshot.isMember }
        : {}),
      metadata_synced_at: toDbDate(),
    })
    .where("id", "=", target.groupId)
    .execute();

  // The group's WhatsApp title also backs the chat sidebar, which reads
  // contacts.push_name for every conversation type.
  if (snapshot.name) {
    await trx
      .updateTable("contacts")
      .set({
        push_name: snapshot.name,
        is_group: true,
        updated_at: toDbDate(),
      })
      .where("id", "=", target.contactId)
      .execute();
  }

  if (participants) {
    await reconcileParticipants(trx, target.groupId, participants);
  }

  return target;
}

/**
 * Record that the connected account has left a group.
 *
 * This is not a deletion. WhatsApp has no delete/disband operation: the group
 * and its history remain for the other members, and the conversation stays in
 * the inbox as a read-only record. Pending join requests are dropped because a
 * non-member can no longer act on them.
 */
export async function markGroupLeftWithin(
  trx: Transaction<TenantDatabase>,
  connectionId: string,
  rawJid: string,
): Promise<GroupSyncTarget | null> {
  const target = await resolveGroupTarget(trx, connectionId, rawJid, {
    create: false,
  });
  if (!target) return null;

  await trx
    .updateTable("groups")
    .set({
      is_member: false,
      invite_link: null,
      invite_link_updated_at: null,
      join_requests_synced_at: null,
      metadata_synced_at: toDbDate(),
    })
    .where("id", "=", target.groupId)
    .execute();
  await trx
    .deleteFrom("group_join_requests")
    .where("group_id", "=", target.groupId)
    .execute();

  return target;
}

/** Store the invite link WhatsApp returned for a group. */
export async function saveGroupInviteLinkWithin(
  trx: Transaction<TenantDatabase>,
  connectionId: string,
  rawJid: string,
  inviteLink: string,
): Promise<GroupSyncTarget | null> {
  const target = await resolveGroupTarget(trx, connectionId, rawJid, {
    create: false,
  });
  if (!target) return null;

  await trx
    .updateTable("groups")
    .set({
      invite_link: inviteLink || null,
      invite_link_updated_at: toDbDate(),
    })
    .where("id", "=", target.groupId)
    .execute();

  return target;
}

/**
 * Replace the cached pending join requests for a group.
 *
 * WhatsApp exposes these only on demand, so the stored rows are a snapshot of
 * the last fetch rather than a live list - which is exactly why the whole set
 * is replaced instead of merged: a request that disappeared upstream (approved
 * from the phone, or withdrawn) must not linger as an actionable row here.
 */
export async function replaceGroupJoinRequestsWithin(
  trx: Transaction<TenantDatabase>,
  connectionId: string,
  rawJid: string,
  requests: Array<{ jid: string; requestedAt?: string }>,
): Promise<GroupSyncTarget | null> {
  const normalized = new Map<string, Date | null>();
  for (const request of requests) {
    const jid = normalizeJid(request.jid);
    if (!jid) continue;
    const requestedAt = request.requestedAt
      ? new Date(request.requestedAt)
      : null;
    normalized.set(
      jid,
      requestedAt && !Number.isNaN(requestedAt.getTime()) ? requestedAt : null,
    );
  }

  const target = await resolveGroupTarget(trx, connectionId, rawJid, {
    create: false,
  });
  if (!target) return null;

  // Recorded on the group, not derived from the rows: a fetch that returns
  // nothing deletes every row, and "we asked, nobody is waiting" must stay
  // distinguishable from "we never asked".
  await trx
    .updateTable("groups")
    .set({ join_requests_synced_at: toDbDate() })
    .where("id", "=", target.groupId)
    .execute();
  await trx
    .deleteFrom("group_join_requests")
    .where("group_id", "=", target.groupId)
    .execute();
  if (normalized.size > 0) {
    await trx
      .insertInto("group_join_requests")
      .values(
        [...normalized.entries()].map(([jid, requestedAt]) => ({
          group_id: target.groupId,
          requester_jid: jid,
          requested_at: requestedAt,
          synced_at: toDbDate(),
        })),
      )
      .execute();
  }

  return target;
}
