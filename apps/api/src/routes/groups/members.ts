/**
 * Group Member Routes
 *
 * Add, remove, promote and demote group participants.
 *
 * None of these routes write `group_participants`. They validate the request,
 * enqueue one durable command, and return "requested". The membership list only
 * changes when the worker reports what WhatsApp actually did (see
 * services/group-sync.service.ts), so a request WhatsApp rejects - because the
 * account lost admin rights a second ago, or a number refuses group invites -
 * never leaves the workspace showing a change that did not happen.
 */
import { zValidator } from "@hono/zod-validator";
import { GROUP_MAX_PARTICIPANTS } from "@wateaminbox/shared";
import { type Context, Hono } from "hono";
import { badRequest, conflict } from "../../lib/errors.js";
import type { NatsCommandPublisher } from "../../lib/nats/command-builder.js";
import { successWithMessage } from "../../lib/response.js";
import { groupParticipantsSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import { enqueueConnectionCommand } from "../../services/command-outbox.service.js";
import {
  type GroupContext,
  getGroupAdminJids,
  getGroupMemberJids,
  loadGroupContext,
} from "./helpers.js";

export const memberRoutes = new Hono();

type ParticipantOperation =
  | "add_participants"
  | "remove_participants"
  | "promote_admin"
  | "demote_admin";

interface ParticipantMutation {
  operation: ParticipantOperation;
  /** Verb used in the "only group admins can ..." message. */
  adminAction: string;
  /**
   * Reject a request WhatsApp is certain to refuse. This is a fast, friendly
   * pre-check, not the authority: WhatsApp still decides, and the worker still
   * reports the real outcome.
   */
  precheck: (input: {
    context: GroupContext;
    participantJids: string[];
    members: Set<string>;
    admins: Set<string>;
  }) => string | null;
  enqueue: (
    publisher: NatsCommandPublisher,
    context: GroupContext,
    participantJids: string[],
    userId: string,
  ) => Promise<void>;
}

async function mutateParticipants(
  c: Context,
  participantJids: string[],
  mutation: ParticipantMutation,
): Promise<Response> {
  const { tenantDb, companyId, user } = getRouteContext(c);

  const loaded = await loadGroupContext(c, c.req.param("id")!, {
    requireConnected: true,
    requireMembership: true,
    requireAdmin: true,
    adminAction: mutation.adminAction,
  });
  if (!loaded.ok) return loaded.response;
  const context = loaded.context;

  // Acting on the connected account here would make "leave the group" reachable
  // without its own confirmation, and WhatsApp does not let an account promote
  // or demote itself either.
  //
  // Matched on the account's phone-number JID, which is the same identity the
  // admin lookup above resolved membership by. An account listed in the group
  // under a LID instead would already have failed `requireAdmin`, because that
  // lookup uses this same JID - so a request that gets this far is one where
  // the account's JID is known. WhatsApp independently rejects self-removal, and
  // nothing local changes before it answers, so a miss costs a failed command
  // rather than a silent departure.
  if (
    context.connectionJid &&
    participantJids.includes(context.connectionJid)
  ) {
    return badRequest(
      c,
      "Use the leave-group action to change this account's own membership",
    );
  }

  const [members, admins] = await Promise.all([
    getGroupMemberJids(tenantDb, context.groupId, participantJids),
    getGroupAdminJids(tenantDb, context.groupId, participantJids),
  ]);

  const problem = mutation.precheck({
    context,
    participantJids,
    members,
    admins,
  });
  if (problem) return conflict(c, problem);

  await tenantDb.transaction().execute(async (trx) => {
    await enqueueConnectionCommand(
      trx,
      companyId,
      context.connectionId,
      (publisher) =>
        mutation.enqueue(publisher, context, participantJids, user.id),
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
      participantJids,
      operation: mutation.operation,
    },
    ipAddress: getClientIp(c),
  });

  return successWithMessage(
    c,
    "Requested from WhatsApp. Members update once WhatsApp confirms the change.",
    { participantJids, pending: true },
  );
}

/**
 * POST /:id/participants - Add members to the group
 */
memberRoutes.post(
  "/:id/participants",
  zValidator("json", groupParticipantsSchema),
  async (c) =>
    mutateParticipants(c, c.req.valid("json").participantJids, {
      operation: "add_participants",
      adminAction: "add members",
      precheck: ({ context, participantJids, members }) => {
        const alreadyIn = participantJids.filter((jid) => members.has(jid));
        if (alreadyIn.length > 0) {
          return `Already in the group: ${alreadyIn.join(", ")}`;
        }
        // WhatsApp enforces the real cap per participant; refusing an
        // impossible batch up front turns a partial silent failure into a
        // clear error the composer can show before anything is sent.
        if (
          context.participantCount + participantJids.length >
          GROUP_MAX_PARTICIPANTS
        ) {
          return `A WhatsApp group holds at most ${GROUP_MAX_PARTICIPANTS} members; this group has ${context.participantCount}`;
        }
        return null;
      },
      enqueue: (publisher, context, participantJids, userId) =>
        publisher.groupAddParticipants(
          context.groupJid,
          participantJids,
          userId,
        ),
    }),
);

const REMOVE_MUTATION: ParticipantMutation = {
  operation: "remove_participants",
  adminAction: "remove members",
  precheck: ({ participantJids, members }) => {
    const missing = participantJids.filter((jid) => !members.has(jid));
    return missing.length > 0
      ? `Not in the group: ${missing.join(", ")}`
      : null;
  },
  enqueue: (publisher, context, participantJids, userId) =>
    publisher.groupRemoveParticipants(
      context.groupJid,
      participantJids,
      userId,
    ),
};

const PROMOTE_MUTATION: ParticipantMutation = {
  operation: "promote_admin",
  adminAction: "promote members",
  precheck: ({ participantJids, members, admins }) => {
    const missing = participantJids.filter((jid) => !members.has(jid));
    if (missing.length > 0) {
      return `Not in the group: ${missing.join(", ")}`;
    }
    const alreadyAdmin = participantJids.filter((jid) => admins.has(jid));
    return alreadyAdmin.length > 0
      ? `Already an admin: ${alreadyAdmin.join(", ")}`
      : null;
  },
  enqueue: (publisher, context, participantJids, userId) =>
    publisher.groupPromoteAdmin(context.groupJid, participantJids, userId),
};

const DEMOTE_MUTATION: ParticipantMutation = {
  operation: "demote_admin",
  adminAction: "demote admins",
  precheck: ({ participantJids, members, admins }) => {
    const missing = participantJids.filter((jid) => !members.has(jid));
    if (missing.length > 0) {
      return `Not in the group: ${missing.join(", ")}`;
    }
    const notAdmin = participantJids.filter((jid) => !admins.has(jid));
    return notAdmin.length > 0 ? `Not an admin: ${notAdmin.join(", ")}` : null;
  },
  enqueue: (publisher, context, participantJids, userId) =>
    publisher.groupDemoteAdmin(context.groupJid, participantJids, userId),
};

/**
 * POST /:id/participants/remove - Remove members from the group
 *
 * A POST rather than a DELETE because the request names WHICH members to
 * remove, and a DELETE body is dropped by enough intermediaries that it is not
 * a safe place to put the only thing that makes the request meaningful.
 */
memberRoutes.post(
  "/:id/participants/remove",
  zValidator("json", groupParticipantsSchema),
  async (c) =>
    mutateParticipants(c, c.req.valid("json").participantJids, REMOVE_MUTATION),
);

/**
 * POST /:id/participants/promote - Promote members to admin
 */
memberRoutes.post(
  "/:id/participants/promote",
  zValidator("json", groupParticipantsSchema),
  async (c) =>
    mutateParticipants(
      c,
      c.req.valid("json").participantJids,
      PROMOTE_MUTATION,
    ),
);

/**
 * POST /:id/participants/demote - Demote admins to regular members
 */
memberRoutes.post(
  "/:id/participants/demote",
  zValidator("json", groupParticipantsSchema),
  async (c) =>
    mutateParticipants(c, c.req.valid("json").participantJids, DEMOTE_MUTATION),
);
