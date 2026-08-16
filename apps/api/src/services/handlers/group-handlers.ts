/**
 * Group administration event handlers.
 *
 * These run when the worker reports what WhatsApp did, which is the only point
 * at which group state is written. A route that asked for a change has already
 * returned by then, so the realtime broadcast below is how the change becomes
 * visible - and an action WhatsApp rejected simply never produces one.
 */

import { normalizeJid } from "@wateaminbox/shared";
import type { Transaction } from "kysely";
import { formatError } from "../../lib/logger.js";
import type { GroupEvent } from "../../lib/nats/index.js";
import {
  assignContactToUser,
  getCurrentAssignment,
} from "../contact.service.js";
import {
  type GroupSyncTarget,
  markGroupLeftWithin,
  replaceGroupJoinRequestsWithin,
  saveGroupInviteLinkWithin,
  syncGroupSnapshotWithin,
} from "../group-sync.service.js";
import { broadcastToContactViewers } from "../message-broadcast.service.js";
import { getTenantConnection, type TenantDatabase } from "../tenant.service.js";
import { resolveWhatsAppSession } from "../whatsapp/session.js";
import { lockActiveConnectionForEvent } from "./connection-event-guard.js";
import { handlerLogger as logger } from "./types.js";

/** What changed, so a client can invalidate only what it needs. */
type GroupUpdateReason =
  | "snapshot"
  | "created"
  | "left"
  | "invite_link"
  | "join_requests";

/** What a committed group event has to tell clients about. */
interface GroupEventOutcome {
  target: GroupSyncTarget;
  reason: GroupUpdateReason;
}

async function announce(
  event: GroupEvent,
  { target, reason }: GroupEventOutcome,
): Promise<void> {
  await broadcastToContactViewers(
    event.companyId,
    target.contactId,
    "group:updated",
    {
      contactId: target.contactId,
      jid: target.jid,
      reason,
      // The outbox id of the request that caused this, when there was one.
      // A change made from the phone has none, which is how a client can tell
      // "my action landed" from "somebody else changed the group".
      commandId: event.payload.commandId ?? null,
    },
    { connectionId: event.connectionId },
  );
}

/**
 * Give a newly created group to the person who asked for it.
 *
 * An agent without `can_view_all_chats` only sees conversations assigned to
 * them, so without this they could create a group and then be unable to find
 * it - and the realtime fan-out, which resolves recipients from assignment,
 * would not reach them either.
 *
 * Deliberately runs only after WhatsApp confirms the group exists, and only for
 * a group nobody has been assigned yet, so it can never take a conversation
 * away from an existing assignee.
 *
 * Runs on the event's own transaction: the assignment belongs to a contact this
 * connection owns, so it has to be written under the same connection fence as
 * the group itself. A failure therefore rolls the whole event back rather than
 * being swallowed - redelivery re-applies the snapshot, which is idempotent,
 * and re-runs this against an assignment that either exists (skip) or does not.
 */
async function assignCreatedGroupToItsCreator(
  trx: Transaction<TenantDatabase>,
  event: GroupEvent,
  target: GroupSyncTarget,
): Promise<void> {
  const commandId = event.payload.commandId;
  if (!commandId) return;

  // The requesting user is recorded on the command that created the group.
  // The row is verified to actually BE that command before its user_id is
  // trusted: an id alone would let any `created` event carrying an arbitrary
  // outbox id hand the new group to whoever owns that unrelated row.
  const outbox = await trx
    .selectFrom("nats_outbox")
    .select("payload")
    .where("id", "=", commandId)
    .executeTakeFirst();
  if (!outbox) return;

  const payload = outbox.payload as Record<string, unknown>;
  if (payload.type !== "group_create") {
    logger.warn(
      { companyId: event.companyId, commandId, commandType: payload.type },
      "Ignoring group creation attributed to an unrelated command",
    );
    return;
  }

  // A command addresses a SESSION, while a resolved event carries the
  // connection that session belongs to (see message-handler.ts). Comparing
  // the two directly would never match, so the session is resolved first.
  const commandSessionId = payload.connection_id;
  if (typeof commandSessionId !== "string") return;
  const session = await resolveWhatsAppSession(trx, commandSessionId);
  if (!session || session.connectionId !== event.connectionId) {
    logger.warn(
      {
        companyId: event.companyId,
        commandId,
        connectionId: event.connectionId,
      },
      "Ignoring group creation attributed to another connection's command",
    );
    return;
  }

  const userId = payload.user_id;
  if (typeof userId !== "string" || !userId) return;

  if (await getCurrentAssignment(trx, target.contactId)) return;
  await assignContactToUser(trx, target.contactId, userId, userId);
  logger.debug(
    { companyId: event.companyId, contactId: target.contactId, userId },
    "Assigned a newly created group to its creator",
  );
}

/**
 * Apply one group event's writes, or decide there are none.
 *
 * The caller has already taken the connection fence on `trx`, so everything
 * here is guaranteed to be writing for a connection that is still live.
 */
async function applyGroupEvent(
  trx: Transaction<TenantDatabase>,
  event: GroupEvent,
  jid: string,
): Promise<GroupEventOutcome | null> {
  const { companyId, connectionId, payload } = event;

  switch (payload.action) {
    case "snapshot":
    case "created": {
      if (!payload.snapshot) {
        logger.warn(
          { companyId, connectionId, jid },
          "Dropping group snapshot event without a snapshot",
        );
        return null;
      }
      const target = await syncGroupSnapshotWithin(
        trx,
        companyId,
        connectionId,
        { ...payload.snapshot, jid },
      );
      if (!target) return null;
      if (payload.action === "created") {
        await assignCreatedGroupToItsCreator(trx, event, target);
      }
      return { target, reason: payload.action };
    }

    case "left": {
      // The account left; the group itself still exists for its members.
      const target = await markGroupLeftWithin(trx, connectionId, jid);
      return target ? { target, reason: "left" } : null;
    }

    case "invite_link": {
      const target = await saveGroupInviteLinkWithin(
        trx,
        connectionId,
        jid,
        payload.inviteLink ?? "",
      );
      return target ? { target, reason: "invite_link" } : null;
    }

    case "join_requests": {
      const target = await replaceGroupJoinRequestsWithin(
        trx,
        connectionId,
        jid,
        payload.joinRequests ?? [],
      );
      return target ? { target, reason: "join_requests" } : null;
    }

    default:
      logger.warn(
        { companyId, connectionId, jid, action: payload.action },
        "Unknown group event action",
      );
      return null;
  }
}

export async function handleGroupEvent(event: GroupEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;
  const jid = normalizeJid(payload.jid);

  logger.debug(
    { companyId, connectionId, jid, action: payload.action },
    "Group event received",
  );

  if (!jid) {
    logger.warn(
      { companyId, connectionId, action: payload.action },
      "Dropping group event without a usable JID",
    );
    return;
  }

  try {
    const tenantDb = getTenantConnection(companyId);

    // Every write this event performs runs inside ONE transaction that holds
    // the connection fence for its whole duration. Two things depend on that:
    //
    //  - Fail closed on an event naming a connection this workspace does not
    //    own, or one that has been archived. Group snapshots CREATE
    //    conversations and their contacts, so an event allowed through after
    //    archive would plant rows a purge has already accounted for - or, for
    //    an unverified connection id, plant a group in someone else's inbox.
    //  - The fence and the permanent purge take conflicting locks on the same
    //    connection row, so a purge racing this event either waits for it to
    //    commit and then removes what it wrote, or wins and makes the check
    //    below fail. Neither order can leave orphaned group rows behind.
    //
    // Lock order matches every other group writer: connection fence first,
    // then the per-group advisory lock inside group-sync. Taking them the
    // other way round in any path would risk a deadlock between two events
    // for the same group on one connection.
    const outcome = await tenantDb.transaction().execute(async (trx) => {
      if (!(await lockActiveConnectionForEvent(trx, connectionId))) {
        const known = await trx
          .selectFrom("whatsapp_connections")
          .select("id")
          .where("id", "=", connectionId)
          .executeTakeFirst();
        logger.error(
          { companyId, connectionId, jid, action: payload.action },
          known
            ? "Dropping group event for an archived connection"
            : "Quarantining group event for unknown connection",
        );
        return null;
      }
      return applyGroupEvent(trx, event, jid);
    });

    // Broadcast only after the writes commit, so a client that reacts by
    // refetching cannot read the group as it was before the event.
    if (outcome) await announce(event, outcome);
  } catch (error) {
    logger.error(
      { ...formatError(error), companyId, connectionId, jid },
      "Failed to handle group event",
    );
    throw error;
  }
}
