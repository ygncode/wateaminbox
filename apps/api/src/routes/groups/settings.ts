/**
 * Group Settings Routes
 *
 * Group profile and permissions, leaving, invite links and join requests.
 *
 * As with the member routes, nothing here writes group state. Each route
 * enqueues a durable command and returns; `groups` is updated only when the
 * worker reports back what WhatsApp did.
 *
 * On leaving: WhatsApp has no "delete group" or "disband group" operation, and
 * the vendored whatsmeow client exposes none. `POST /:id/leave` ends this
 * account's membership; the group and its history continue to exist for the
 * remaining members, and the conversation stays in the inbox as a record.
 */
import { zValidator } from "@hono/zod-validator";
import { GROUP_LEAVE_SEMANTICS } from "@wateaminbox/shared";
import { Hono } from "hono";
import { conflict } from "../../lib/errors.js";
import { successData, successWithMessage } from "../../lib/response.js";
import {
  groupInviteLinkSchema,
  groupJoinRequestDecisionSchema,
  updateGroupSettingsSchema,
} from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import { loadGroupContext } from "./helpers.js";

export const settingsRoutes = new Hono();

/**
 * PATCH /:id/settings - Update the group's profile and permissions
 *
 * Accepts name, description, and the permission switches WhatsApp supports:
 * announce (only admins can send), locked (only admins can edit group info),
 * join approval, and who may add members.
 */
settingsRoutes.patch(
  "/:id/settings",
  zValidator("json", updateGroupSettingsSchema),
  async (c) => {
    const { tenantDb, companyId, user } = getRouteContext(c);
    const settings = c.req.valid("json");

    const loaded = await loadGroupContext(c, c.req.param("id"), {
      requireConnected: true,
      requireMembership: true,
      requireAdmin: true,
      adminAction: "update group settings",
    });
    if (!loaded.ok) return loaded.response;
    const context = loaded.context;

    await tenantDb.transaction().execute(async (trx) => {
      await enqueueConnectionCommand(
        trx,
        companyId,
        context.connectionId,
        (publisher) =>
          publisher.groupUpdateSettings(context.groupJid, user.id, settings),
      );
    });

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.updated",
      entityType: "group",
      entityId: context.contactId,
      details: {
        groupJid: context.groupJid,
        groupName: context.groupName,
        requested: settings,
        operation: "update_settings",
      },
      ipAddress: getClientIp(c),
    });

    return successWithMessage(
      c,
      "Requested from WhatsApp. Settings update once WhatsApp confirms the change.",
      { pending: true },
    );
  },
);

/**
 * POST /:id/leave - Leave the group
 *
 * Ends this WhatsApp account's membership. It does not, and cannot, delete the
 * group: WhatsApp provides no such operation.
 */
settingsRoutes.post("/:id/leave", async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c);

  // Leaving does not require admin rights - any member may leave.
  const loaded = await loadGroupContext(c, c.req.param("id"), {
    requireConnected: true,
    requireMembership: true,
  });
  if (!loaded.ok) return loaded.response;
  const context = loaded.context;

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(
      trx,
      companyId,
      context.connectionId,
      (publisher) => publisher.groupLeave(context.groupJid, user.id),
    );
  });

  await createAuditLog({
    companyId,
    userId: user.id,
    action: "contact.updated",
    entityType: "group",
    entityId: context.contactId,
    details: {
      groupJid: context.groupJid,
      groupName: context.groupName,
      operation: "leave_group",
    },
    ipAddress: getClientIp(c),
  });

  return successWithMessage(
    c,
    "Requested from WhatsApp. Membership ends once WhatsApp confirms it.",
    { pending: true, semantics: GROUP_LEAVE_SEMANTICS },
  );
});

/**
 * POST /:id/invite-link - Fetch or rotate the group's invite link
 *
 * WhatsApp only hands the link to admins, and only on request, so this asks the
 * worker for it. `reset: true` revokes the previous link first, which
 * invalidates anything already shared.
 */
settingsRoutes.post(
  "/:id/invite-link",
  zValidator("json", groupInviteLinkSchema),
  async (c) => {
    const { tenantDb, companyId, user } = getRouteContext(c);
    const { reset } = c.req.valid("json");

    const loaded = await loadGroupContext(c, c.req.param("id"), {
      requireConnected: true,
      requireMembership: true,
      requireAdmin: true,
      adminAction: "manage the invite link",
    });
    if (!loaded.ok) return loaded.response;
    const context = loaded.context;

    await tenantDb.transaction().execute(async (trx) => {
      await enqueueConnectionCommand(
        trx,
        companyId,
        context.connectionId,
        (publisher) =>
          publisher.groupInviteLink(context.groupJid, reset, user.id),
      );
    });

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.updated",
      entityType: "group",
      entityId: context.contactId,
      details: {
        groupJid: context.groupJid,
        groupName: context.groupName,
        operation: reset ? "reset_invite_link" : "fetch_invite_link",
      },
      ipAddress: getClientIp(c),
    });

    return successWithMessage(
      c,
      reset
        ? "Requested a new invite link from WhatsApp. The previous link stops working once WhatsApp confirms."
        : "Requested the invite link from WhatsApp.",
      { pending: true, reset },
    );
  },
);

/**
 * GET /:id/join-requests - Cached pending requests to join
 *
 * WhatsApp exposes these only on demand, so this returns the last fetched set
 * along with when it was read. Clients refresh with POST .../refresh.
 */
settingsRoutes.get("/:id/join-requests", async (c) => {
  const { tenantDb } = getRouteContext(c);

  const loaded = await loadGroupContext(c, c.req.param("id"), {
    requireAdmin: true,
    adminAction: "view join requests",
  });
  if (!loaded.ok) return loaded.response;
  const context = loaded.context;

  const [requests, group] = await Promise.all([
    tenantDb
      .selectFrom("group_join_requests")
      .select(["requester_jid", "requested_at"])
      .where("group_id", "=", context.groupId)
      .orderBy("requested_at", "asc")
      .execute(),
    tenantDb
      .selectFrom("groups")
      .select("join_requests_synced_at")
      .where("id", "=", context.groupId)
      .executeTakeFirst(),
  ]);

  return successData(c, {
    requests: requests.map((request) => ({
      jid: request.requester_jid,
      requestedAt: request.requested_at,
    })),
    // Read from the group rather than the rows: a fetch that found nobody
    // waiting leaves no rows behind, and that is not the same fact as never
    // having asked.
    syncedAt: group?.join_requests_synced_at ?? null,
  });
});

/**
 * POST /:id/join-requests/refresh - Re-read pending join requests from WhatsApp
 */
settingsRoutes.post("/:id/join-requests/refresh", async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c);

  const loaded = await loadGroupContext(c, c.req.param("id"), {
    requireConnected: true,
    requireMembership: true,
    requireAdmin: true,
    adminAction: "view join requests",
  });
  if (!loaded.ok) return loaded.response;
  const context = loaded.context;

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(
      trx,
      companyId,
      context.connectionId,
      (publisher) =>
        publisher.groupFetchJoinRequests(context.groupJid, user.id),
    );
  });

  return successWithMessage(c, "Refreshing join requests from WhatsApp.", {
    pending: true,
  });
});

/**
 * POST /:id/join-requests/decision - Approve or reject pending join requests
 */
settingsRoutes.post(
  "/:id/join-requests/decision",
  zValidator("json", groupJoinRequestDecisionSchema),
  async (c) => {
    const { tenantDb, companyId, user } = getRouteContext(c);
    const { requesterJids, decision } = c.req.valid("json");

    const loaded = await loadGroupContext(c, c.req.param("id"), {
      requireConnected: true,
      requireMembership: true,
      requireAdmin: true,
      adminAction: "decide on join requests",
    });
    if (!loaded.ok) return loaded.response;
    const context = loaded.context;

    // A request that is not in the cached set is either already handled or was
    // withdrawn. Sending it anyway would produce a command failure toast with
    // no explanation, so it is refused here with one.
    const pending = await tenantDb
      .selectFrom("group_join_requests")
      .select(["requester_jid"])
      .where("group_id", "=", context.groupId)
      .where("requester_jid", "in", requesterJids)
      .execute();
    const known = new Set(pending.map((row) => row.requester_jid));
    const unknown = requesterJids.filter((jid) => !known.has(jid));
    if (unknown.length > 0) {
      return conflict(
        c,
        `No pending join request for: ${unknown.join(", ")}. Refresh and try again.`,
      );
    }

    await tenantDb.transaction().execute(async (trx) => {
      await enqueueConnectionCommand(
        trx,
        companyId,
        context.connectionId,
        (publisher) =>
          publisher.groupUpdateJoinRequests(
            context.groupJid,
            requesterJids,
            decision,
            user.id,
          ),
      );
    });

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "contact.updated",
      entityType: "group",
      entityId: context.contactId,
      details: {
        groupJid: context.groupJid,
        groupName: context.groupName,
        requesterJids,
        operation: `join_request_${decision}`,
      },
      ipAddress: getClientIp(c),
    });

    return successWithMessage(
      c,
      `Requested from WhatsApp. Requests are ${decision === "approve" ? "approved" : "rejected"} once WhatsApp confirms.`,
      { pending: true, decision },
    );
  },
);

/**
 * POST /:id/sync - Re-read the group from WhatsApp
 *
 * Repairs a workspace whose group metadata drifted (a change made on the phone
 * while the worker was offline) without changing anything on WhatsApp.
 */
settingsRoutes.post("/:id/sync", async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c);

  const loaded = await loadGroupContext(c, c.req.param("id"), {
    requireConnected: true,
  });
  if (!loaded.ok) return loaded.response;
  const context = loaded.context;

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(
      trx,
      companyId,
      context.connectionId,
      (publisher) => publisher.groupSync(context.groupJid, user.id),
    );
  });

  return successWithMessage(c, "Refreshing this group from WhatsApp.", {
    pending: true,
  });
});

/**
 * GET /:id/admin-status - Whether the group's own account is a group admin
 */
settingsRoutes.get("/:id/admin-status", async (c) => {
  const loaded = await loadGroupContext(c, c.req.param("id"));
  if (!loaded.ok) return loaded.response;
  const context = loaded.context;

  return successData(c, {
    isAdmin: context.isAdmin,
    isMember: context.isMember,
    connectionId: context.connectionId,
    connectionJid: context.connectionJid,
    ...(context.connectionJid
      ? {}
      : {
          reason:
            "The WhatsApp account for this group has not reported its own identity yet",
        }),
  });
});
