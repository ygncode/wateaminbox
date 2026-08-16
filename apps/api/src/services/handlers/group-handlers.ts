/**
 * Group administration event handlers.
 *
 * These run when the worker reports what WhatsApp did, which is the only point
 * at which group state is written. A route that asked for a change has already
 * returned by then, so the realtime broadcast below is how the change becomes
 * visible - and an action WhatsApp rejected simply never produces one.
 */

import { normalizeJid } from "@wateaminbox/shared";
import { formatError } from "../../lib/logger.js";
import type { GroupEvent } from "../../lib/nats/index.js";
import {
  assignContactToUser,
  getCurrentAssignment,
} from "../contact.service.js";
import {
  type GroupSyncTarget,
  markGroupLeft,
  replaceGroupJoinRequests,
  saveGroupInviteLink,
  syncGroupSnapshot,
} from "../group-sync.service.js";
import { broadcastToContactViewers } from "../message-broadcast.service.js";
import { getTenantConnection } from "../tenant.service.js";
import { resolveWhatsAppSession } from "../whatsapp/session.js";
import { handlerLogger as logger } from "./types.js";

/** What changed, so a client can invalidate only what it needs. */
type GroupUpdateReason =
  | "snapshot"
  | "created"
  | "left"
  | "invite_link"
  | "join_requests";

async function announce(
  event: GroupEvent,
  target: GroupSyncTarget | null,
  reason: GroupUpdateReason,
): Promise<void> {
  if (!target) return;
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
 */
async function assignCreatedGroupToItsCreator(
  event: GroupEvent,
  target: GroupSyncTarget | null,
): Promise<void> {
  const commandId = event.payload.commandId;
  if (!target || !commandId) return;

  const tenantDb = getTenantConnection(event.companyId);
  try {
    // The requesting user is recorded on the command that created the group.
    // The row is verified to actually BE that command before its user_id is
    // trusted: an id alone would let any `created` event carrying an arbitrary
    // outbox id hand the new group to whoever owns that unrelated row.
    const outbox = await tenantDb
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
    const session = await resolveWhatsAppSession(tenantDb, commandSessionId);
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

    if (await getCurrentAssignment(tenantDb, target.contactId)) return;
    await assignContactToUser(tenantDb, target.contactId, userId, userId);
    logger.debug(
      { companyId: event.companyId, contactId: target.contactId, userId },
      "Assigned a newly created group to its creator",
    );
  } catch (error) {
    // Assignment is a convenience: the group itself is already correct, so a
    // failure here must not send the whole event back for redelivery.
    logger.warn(
      { ...formatError(error), companyId: event.companyId, jid: target.jid },
      "Could not assign a newly created group to its creator",
    );
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

  // Fail closed on an event naming a connection this workspace does not own.
  // Group snapshots CREATE conversations, so an unverified connection id would
  // be enough to plant a group in someone else's inbox.
  const connection = await getTenantConnection(companyId)
    .selectFrom("whatsapp_connections")
    .select("id")
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!connection) {
    logger.error(
      { companyId, connectionId, jid },
      "Quarantining group event for unknown connection",
    );
    return;
  }

  try {
    switch (payload.action) {
      case "snapshot":
      case "created": {
        if (!payload.snapshot) {
          logger.warn(
            { companyId, connectionId, jid },
            "Dropping group snapshot event without a snapshot",
          );
          return;
        }
        const target = await syncGroupSnapshot(companyId, connectionId, {
          ...payload.snapshot,
          jid,
        });
        if (payload.action === "created") {
          await assignCreatedGroupToItsCreator(event, target);
        }
        await announce(event, target, payload.action);
        return;
      }

      case "left": {
        // The account left; the group itself still exists for its members.
        const target = await markGroupLeft(companyId, connectionId, jid);
        await announce(event, target, "left");
        return;
      }

      case "invite_link": {
        const target = await saveGroupInviteLink(
          companyId,
          connectionId,
          jid,
          payload.inviteLink ?? "",
        );
        await announce(event, target, "invite_link");
        return;
      }

      case "join_requests": {
        const target = await replaceGroupJoinRequests(
          companyId,
          connectionId,
          jid,
          payload.joinRequests ?? [],
        );
        await announce(event, target, "join_requests");
        return;
      }

      default:
        logger.warn(
          { companyId, connectionId, jid, action: payload.action },
          "Unknown group event action",
        );
    }
  } catch (error) {
    logger.error(
      { ...formatError(error), companyId, connectionId, jid },
      "Failed to handle group event",
    );
    throw error;
  }
}
