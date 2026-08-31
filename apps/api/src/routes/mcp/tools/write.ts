import { getContactDisplayName, toDbDate } from "@wateaminbox/shared";
import type { Context } from "hono";
import { z } from "zod";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../../../lib/nats/index.js";
import {
  rateLimitConfig,
  type RateLimitResult,
  rateLimitStore,
  RateLimitStoreUnavailableError,
} from "../../../lib/rate-limit-store.js";
import { broadcastToCompany } from "../../../lib/realtime.js";
import {
  SCHEDULE_MAX_HORIZON_MS,
  SCHEDULE_MIN_LEAD_MS,
} from "../../../lib/schemas/index.js";
import { getRouteContext } from "../../../middleware/context.js";
import {
  broadcastAutoAssignment,
  broadcastContactAssignmentEvent,
} from "../../../services/assignment-broadcast.service.js";
import { getAssignmentNotificationInputs } from "../../../services/assignment-notification.service.js";
import { decideContactAssignment } from "../../../services/assignment-policy.js";
import {
  createAuditLog,
  type CreateAuditLogInput,
  getClientIp,
} from "../../../services/audit.service.js";
import {
  createBulkJob,
  formatBulkJob,
  getBulkJobProgress,
  resolveBulkAudience,
} from "../../../services/bulk-job.service.js";
import { enqueueCommand } from "../../../services/command-outbox.service.js";
import {
  ensureActiveCaseWithin,
  reopenAsNewCase,
  resolveActiveCase,
  resumePendingCase,
  setActiveCasePending,
} from "../../../services/conversation-case.service.js";
import {
  type FindOrCreateContactByPhoneResult,
  findOrCreateContactByPhone,
  getCurrentAssignment,
  OutboundContactError,
} from "../../../services/contact.service.js";
import { reserveMediaReferences } from "../../../services/media-reference-lock.js";
import {
  broadcastNewMessageToViewers,
  broadcastToContactViewers,
} from "../../../services/message-broadcast.service.js";
import {
  getAuthorName,
  transformPrivateNoteResponse,
  transformSharedNoteResponse,
} from "../../../services/note.service.js";
import { createAndPublishNotifications } from "../../../services/notification-delivery.service.js";
import { getMemberWithPermissions } from "../../../services/permission.service.js";
import { requireSendAccess } from "../../../services/send-access.service.js";
import { getActiveSessionId } from "../../../services/whatsapp/session.js";
import { type McpToolDefinition, McpToolError } from "../tool-context.js";
import { requireVisibleContact } from "./read.js";

async function createMcpAuditLog(
  c: Context,
  input: CreateAuditLogInput,
): Promise<void> {
  await createAuditLog({
    ...input,
    details: {
      ...input.details,
      authSource: "mcp",
      apiTokenId: c.get("apiToken").id,
    },
  });
}

async function enforceBulkRateLimit(c: Context): Promise<void> {
  if (!rateLimitConfig.enabled) return;

  const { user } = getRouteContext(c);
  const tier = rateLimitConfig.tiers.messaging.bulk;
  let result: RateLimitResult;
  try {
    // Match the REST bulk limiter's key exactly so browser and MCP requests
    // consume one per-user budget rather than separate per-token budgets.
    result = await rateLimitStore.increment(
      `bulk-jobs:user:${user.id}`,
      tier.requests,
      tier.windowSeconds,
    );
  } catch (error) {
    if (error instanceof RateLimitStoreUnavailableError) {
      throw new McpToolError(
        "Broadcast rate limiting is temporarily unavailable; retry shortly",
      );
    }
    throw error;
  }

  if (!result.allowed) {
    throw new McpToolError(
      `Broadcast rate limit exceeded; retry in ${result.retryAfter} seconds`,
    );
  }
}

export function validateBroadcastSchedule(
  scheduledAt: Date,
  now: number = Date.now(),
): void {
  const scheduleLead = scheduledAt.getTime() - now;
  if (scheduleLead < SCHEDULE_MIN_LEAD_MS) {
    throw new McpToolError(
      "scheduledAt must be at least 30 seconds in the future",
    );
  }
  if (scheduleLead > SCHEDULE_MAX_HORIZON_MS) {
    throw new McpToolError("scheduledAt must be within one year");
  }
}

async function loadContactForCase(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  contactId: string,
) {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select([
      "id",
      "jid",
      "custom_name",
      "push_name",
      "username",
      "phone_number",
      "is_group",
    ])
    .where("id", "=", contactId)
    .executeTakeFirst();
  if (!contact) {
    throw new McpToolError("Contact not found");
  }
  return contact;
}

/**
 * Queue an outbound text message on an existing contact.
 *
 * Shared by send_message and start_conversation so both take the same path
 * through case assignment, the command outbox, and the realtime broadcast.
 */
async function queueTextMessage(
  c: Context,
  contactId: string,
  content: string,
  options: { openCaseIfMissing?: boolean } = {},
): Promise<{
  messageId: string;
  contactId: string;
  status: "queued";
  autoAssigned: boolean;
  note: string;
}> {
  const { tenantDb, user, companyId } = getRouteContext(c);

  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid", "is_group", "whatsapp_connection_id"])
    .where("id", "=", contactId)
    .executeTakeFirst();
  if (!contact || !contact.jid) {
    throw new McpToolError("Contact not found");
  }
  const connection = contact.whatsapp_connection_id
    ? await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "jid"])
        .where("id", "=", contact.whatsapp_connection_id)
        .where("status", "=", "connected")
        .executeTakeFirst()
    : null;
  if (!connection) {
    throw new McpToolError("The contact's WhatsApp connection is not active");
  }

  const messageId = crypto.randomUUID();
  const waMessageId = `pending_${messageId}`;
  const createdAt = toDbDate();
  const sessionId = await getActiveSessionId(tenantDb, connection.id);
  const sendCommand = await buildSendMessageCommand(
    companyId,
    sessionId,
    contact.jid,
    content,
    "text",
    user.id,
    waMessageId,
  );

  let autoAssigned = false;
  await tenantDb.transaction().execute(async (trx) => {
    await reserveMediaReferences(trx, companyId, [null]);
    if (options.openCaseIfMissing) {
      // requireSendAccess ends at requireActiveCaseForSend, which rejects a
      // contact with no open or pending case. A conversation this workspace
      // starts has none yet, so open it here - in this transaction, so the
      // contact, the case, the assignment, the message row, and the outbox
      // entry all land together or not at all.
      await ensureActiveCaseWithin(
        trx,
        { id: contactId, isGroup: contact.is_group },
        {
          companyId,
          openedBy: user.id,
          reason: "Outbound conversation started from the API",
        },
      );
    }
    const result = await requireSendAccess(trx, contactId, user.id);
    autoAssigned = result.autoAssigned;
    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        whatsapp_connection_id: connection.id,
        contact_id: contactId,
        message_id: waMessageId,
        from_me: true,
        sender_jid: connection.jid,
        message_type: "text",
        content,
        sent_by_user_id: user.id,
        status: "pending",
        timestamp: createdAt,
        created_at: createdAt,
        case_id: result.caseId,
      })
      .execute();
    await enqueueCommand(
      trx,
      buildCommandSubject(companyId, sessionId),
      sendCommand,
    );
  });
  if (autoAssigned) {
    await broadcastAutoAssignment(tenantDb, companyId, contactId, user.id);
  }
  await broadcastNewMessageToViewers(
    companyId,
    contactId,
    {
      message: {
        id: messageId,
        messageId: waMessageId,
        conversationId: contactId,
        contactId,
        senderId: user.id,
        senderType: "user" as const,
        sentByUserId: user.id,
        sentByUserName: user.name || user.email.split("@")[0],
        messageType: "text",
        content,
        status: "pending" as const,
        createdAt,
        updatedAt: createdAt,
      },
      conversationId: contactId,
    },
    connection.id,
  );

  return {
    messageId,
    contactId,
    status: "queued",
    autoAssigned,
    note: "The message is queued; delivery to WhatsApp is asynchronous.",
  };
}

export const writeTools: McpToolDefinition[] = [
  {
    name: "send_message",
    description:
      "Send a text WhatsApp message to a contact that already exists. The message is queued for delivery (status 'pending'); delivery happens asynchronously. Sending to an unassigned contact may auto-assign it to the token owner. To message a number that is not a contact yet, use start_conversation.",
    scope: "write",
    permission: "can_send_messages",
    inputSchema: {
      contactId: z.string().uuid(),
      content: z.string().min(1).max(65536),
    },
    handler: async (args: { contactId: string; content: string }, c) =>
      queueTextMessage(c, args.contactId, args.content),
  },
  {
    name: "start_conversation",
    description:
      "Start a WhatsApp conversation with a phone number that is not a contact yet: creates the contact, then queues the first message. HIGH IMPACT - this initiates outbound contact with someone who has not messaged this workspace, so confirm the number and the wording before calling. If the number is already a contact, the existing contact is reused and no duplicate is created. The number is NOT checked against WhatsApp's registry first, so a landline or a typo will create a contact whose message never delivers.",
    scope: "write",
    permission: "can_send_messages",
    inputSchema: {
      phoneNumber: z
        .string()
        .min(1)
        .describe(
          "Digits in international format, e.g. 6589001305. A leading + or 00 is accepted.",
        ),
      content: z.string().min(1).max(65536),
      connectionId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Required when the workspace has more than one connected account",
        ),
      customName: z
        .string()
        .max(255)
        .optional()
        .describe("Display name to save with the new contact"),
    },
    handler: async (
      args: {
        phoneNumber: string;
        content: string;
        connectionId?: string;
        customName?: string;
      },
      c,
    ) => {
      const { tenantDb } = getRouteContext(c);

      let resolved: FindOrCreateContactByPhoneResult;
      try {
        resolved = await findOrCreateContactByPhone(tenantDb, {
          phoneNumber: args.phoneNumber,
          connectionId: args.connectionId,
          customName: args.customName,
        });
      } catch (error) {
        if (error instanceof OutboundContactError) {
          throw new McpToolError(error.message);
        }
        throw error;
      }

      const sent = await queueTextMessage(
        c,
        resolved.contact.id,
        args.content,
        {
          openCaseIfMissing: true,
        },
      );
      return {
        ...sent,
        contactCreated: resolved.created,
        phoneNumber: resolved.contact.phone_number,
        displayName: getContactDisplayName(resolved.contact),
      };
    },
  },
  {
    name: "update_conversation_state",
    description:
      "Change a conversation's lifecycle state. Actions: 'resolve' (requires outcome; notes required when outcome is 'other'), 'open' (first-ever open), 'reopen' (after a resolve; optional reason), 'pending', 'resume'.",
    scope: "write",
    permission: "can_send_messages",
    inputSchema: {
      contactId: z.string().uuid(),
      action: z.enum(["resolve", "open", "reopen", "pending", "resume"]),
      outcome: z
        .enum(["handled", "no_reply_needed", "spam", "duplicate", "other"])
        .optional()
        .describe("Required for action 'resolve'"),
      notes: z.string().max(2000).optional(),
      reason: z.string().max(500).optional(),
    },
    handler: async (
      args: {
        contactId: string;
        action: "resolve" | "open" | "reopen" | "pending" | "resume";
        outcome?:
          | "handled"
          | "no_reply_needed"
          | "spam"
          | "duplicate"
          | "other";
        notes?: string;
        reason?: string;
      },
      c,
    ) => {
      const { tenantDb, user, companyId } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);
      const contact = await loadContactForCase(tenantDb, args.contactId);
      const contactName = getContactDisplayName(contact, "Unknown");

      if (args.action === "resolve") {
        if (!args.outcome) {
          throw new McpToolError("outcome is required when resolving");
        }
        if (args.outcome === "other" && !args.notes) {
          throw new McpToolError("notes are required for outcome 'other'");
        }
        const resolvedCase = await resolveActiveCase(tenantDb, args.contactId, {
          outcome: args.outcome,
          notes: args.notes,
          resolvedBy: user.id,
        });
        await createMcpAuditLog(c, {
          companyId,
          userId: user.id,
          action: "conversation.resolved",
          entityType: "conversation",
          entityId: args.contactId,
          details: {
            contactId: args.contactId,
            contactName,
            caseId: resolvedCase.id,
            outcome: args.outcome,
            notes: args.notes,
          },
          ipAddress: getClientIp(c),
        });
        await broadcastToContactViewers(
          companyId,
          args.contactId,
          "conversation:updated",
          {
            event: "resolved",
            contactId: args.contactId,
            caseId: resolvedCase.id,
            resolvedBy: user.id,
            resolvedAt: resolvedCase.resolvedAt?.toISOString(),
          },
        );
        return { status: "resolved", caseId: resolvedCase.id };
      }

      if (args.action === "open" || args.action === "reopen") {
        const newCase = await reopenAsNewCase(
          tenantDb,
          { id: args.contactId, isGroup: contact.is_group },
          {
            companyId,
            openedBy: user.id,
            reason: args.reason,
            expectedMode: args.action,
          },
        );
        const wasReopen = Boolean(newCase.reopenedFromCaseId);
        await createMcpAuditLog(c, {
          companyId,
          userId: user.id,
          action: wasReopen ? "conversation.reopened" : "conversation.opened",
          entityType: "conversation",
          entityId: args.contactId,
          details: {
            contactId: args.contactId,
            contactName,
            caseId: newCase.id,
            reopenedFromCaseId: newCase.reopenedFromCaseId,
            reason: args.reason,
          },
          ipAddress: getClientIp(c),
        });
        await broadcastToContactViewers(
          companyId,
          args.contactId,
          "conversation:updated",
          {
            event: wasReopen ? "reopened" : "opened",
            contactId: args.contactId,
            caseId: newCase.id,
            ...(wasReopen
              ? {
                  reopenedBy: user.id,
                  reopenedAt: newCase.openedAt.toISOString(),
                }
              : {
                  openedBy: user.id,
                  openedAt: newCase.openedAt.toISOString(),
                }),
          },
        );
        return {
          status: wasReopen ? "reopened" : "opened",
          caseId: newCase.id,
        };
      }

      if (args.action === "pending") {
        const pendingCase = await setActiveCasePending(
          tenantDb,
          args.contactId,
          user.id,
        );
        await createMcpAuditLog(c, {
          companyId,
          userId: user.id,
          action: "conversation.pending",
          entityType: "conversation",
          entityId: args.contactId,
          details: {
            contactId: args.contactId,
            contactName,
            caseId: pendingCase.id,
          },
          ipAddress: getClientIp(c),
        });
        await broadcastToContactViewers(
          companyId,
          args.contactId,
          "conversation:updated",
          {
            event: "pending",
            contactId: args.contactId,
            caseId: pendingCase.id,
          },
        );
        return { status: "pending", caseId: pendingCase.id };
      }

      const resumedCase = await resumePendingCase(
        tenantDb,
        args.contactId,
        user.id,
      );
      await createMcpAuditLog(c, {
        companyId,
        userId: user.id,
        action: "conversation.resumed",
        entityType: "conversation",
        entityId: args.contactId,
        details: {
          contactId: args.contactId,
          contactName,
          caseId: resumedCase.id,
        },
        ipAddress: getClientIp(c),
      });
      await broadcastToContactViewers(
        companyId,
        args.contactId,
        "conversation:updated",
        {
          event: "resumed",
          contactId: args.contactId,
          caseId: resumedCase.id,
        },
      );
      return { status: "open", caseId: resumedCase.id };
    },
  },
  {
    name: "assign_contact",
    description:
      "Assign a conversation's contact to a workspace member (defaults to the token owner). Reassigning a contact away from another member requires the can_assign_contacts permission.",
    scope: "write",
    inputSchema: {
      contactId: z.string().uuid(),
      targetUserId: z
        .string()
        .uuid()
        .optional()
        .describe("Member to assign to; defaults to the token owner"),
    },
    handler: async (args: { contactId: string; targetUserId?: string }, c) => {
      const { tenantDb, user, companyId, permissions } = getRouteContext(c);
      const targetUserId = args.targetUserId ?? user.id;

      const targetMember = await getMemberWithPermissions(
        companyId,
        targetUserId,
      );
      if (!targetMember) {
        throw new McpToolError("Target workspace member not found");
      }
      if (
        decideContactAssignment({
          actorUserId: user.id,
          targetUserId,
          targetIsCompanyMember: true,
          canAssignContacts: permissions.can_assign_contacts,
        }) === "permission_denied"
      ) {
        throw new McpToolError(
          "can_assign_contacts is required to assign contacts to other users",
        );
      }

      const result = await tenantDb.transaction().execute(async (trx) => {
        const contact = await trx
          .selectFrom("contacts")
          .select(["id", "custom_name", "push_name", "phone_number", "jid"])
          .where("id", "=", args.contactId)
          .forUpdate()
          .executeTakeFirst();
        if (!contact) return null;

        const previousAssignment = await getCurrentAssignment(
          trx,
          args.contactId,
        );
        const previousAssigneeId = previousAssignment?.assigned_to;
        const isTakeover = Boolean(
          previousAssigneeId && previousAssigneeId !== targetUserId,
        );
        if (
          decideContactAssignment({
            actorUserId: user.id,
            targetUserId,
            currentAssigneeId: previousAssigneeId,
            targetIsCompanyMember: true,
            canAssignContacts: permissions.can_assign_contacts,
          }) === "permission_denied"
        ) {
          return { forbiddenTakeover: true as const };
        }
        if (previousAssignment?.assigned_to === targetUserId) {
          return {
            contact,
            assignment: previousAssignment,
            previousAssigneeId,
            isTakeover: false,
            isNoop: true,
          };
        }
        await trx
          .updateTable("contact_assignments")
          .set({ unassigned_at: toDbDate() })
          .where("contact_id", "=", args.contactId)
          .where("unassigned_at", "is", null)
          .execute();
        const assignment = await trx
          .insertInto("contact_assignments")
          .values({
            contact_id: args.contactId,
            assigned_to: targetUserId,
            assigned_by: user.id,
          })
          .returning(["id", "assigned_to", "assigned_by", "assigned_at"])
          .executeTakeFirstOrThrow();
        return {
          contact,
          assignment,
          previousAssigneeId,
          isTakeover,
          isNoop: false,
        };
      });

      if (!result) {
        throw new McpToolError("Contact not found");
      }
      if ("forbiddenTakeover" in result) {
        throw new McpToolError(
          "can_assign_contacts is required to reassign an assigned contact",
        );
      }

      const { contact, previousAssigneeId, isTakeover, isNoop } = result;
      const contactDisplayName = getContactDisplayName(
        contact,
        "Unknown Contact",
      );
      const notificationInputs = getAssignmentNotificationInputs({
        actorUserId: user.id,
        targetUserId,
        previousAssigneeId,
        contactId: args.contactId,
        contactName: contactDisplayName,
        isNoop,
      });
      await createAndPublishNotifications(companyId, notificationInputs);
      if (!isNoop) {
        await broadcastContactAssignmentEvent(companyId, {
          event: isTakeover ? "reassigned" : "assigned",
          contactId: args.contactId,
          contactName: contactDisplayName,
          previousAssignee: previousAssigneeId ?? null,
          newAssignee: targetUserId,
          assignedBy: user.id,
        });
      }
      await createMcpAuditLog(c, {
        companyId,
        userId: user.id,
        action: "contact.assigned",
        entityType: "contact",
        entityId: args.contactId,
        details: isTakeover
          ? {
              previousAssignee: previousAssigneeId,
              newAssignee: targetUserId,
              isTakeover: true,
              contactName: contactDisplayName,
            }
          : {
              assignee: targetUserId,
              isTakeover: false,
              contactName: contactDisplayName,
            },
        ipAddress: getClientIp(c),
      });

      return {
        contactId: args.contactId,
        assignedTo: targetUserId,
        wasTakeover: isTakeover,
        previousAssignee: previousAssigneeId ?? null,
        wasNoop: isNoop,
      };
    },
  },
  {
    name: "unassign_contact",
    description: "Remove a contact's current assignment.",
    scope: "write",
    permission: "can_assign_contacts",
    inputSchema: {
      contactId: z.string().uuid(),
    },
    handler: async (args: { contactId: string }, c) => {
      const { tenantDb, user, companyId } = getRouteContext(c);
      const result = await tenantDb.transaction().execute(async (trx) => {
        const contact = await trx
          .selectFrom("contacts")
          .select(["id", "custom_name", "push_name", "phone_number"])
          .where("id", "=", args.contactId)
          .forUpdate()
          .executeTakeFirst();
        if (!contact) return null;
        const previousAssignment = await getCurrentAssignment(
          trx,
          args.contactId,
        );
        if (!previousAssignment) {
          return { contact, previousAssignment: null };
        }
        await trx
          .updateTable("contact_assignments")
          .set({ unassigned_at: toDbDate() })
          .where("contact_id", "=", args.contactId)
          .where("unassigned_at", "is", null)
          .execute();
        return { contact, previousAssignment };
      });
      if (!result) {
        throw new McpToolError("Contact not found");
      }
      if (result.previousAssignment) {
        const contactDisplayName = getContactDisplayName(
          result.contact,
          "Unknown Contact",
        );
        await broadcastContactAssignmentEvent(companyId, {
          event: "unassigned",
          contactId: args.contactId,
          contactName: contactDisplayName,
          previousAssignee: result.previousAssignment.assigned_to,
          newAssignee: null,
          assignedBy: user.id,
        });
        await createMcpAuditLog(c, {
          companyId,
          userId: user.id,
          action: "contact.unassigned",
          entityType: "contact",
          entityId: args.contactId,
          details: {
            previousAssignee: result.previousAssignment.assigned_to,
            contactName: contactDisplayName,
          },
          ipAddress: getClientIp(c),
        });
      }
      return { contactId: args.contactId, unassigned: true };
    },
  },
  {
    name: "update_contact",
    description:
      "Update a contact's saved display name or its shared profile note. Pass null to clear a field; omit a field to leave it unchanged. Blocking is deliberately not exposed here - it sends a command to WhatsApp and is a different class of action from an edit.",
    scope: "write",
    inputSchema: {
      contactId: z.string().uuid(),
      customName: z
        .string()
        .max(255)
        .nullish()
        .describe(
          "The name the team sees, overriding the name WhatsApp supplies. null clears it.",
        ),
      notesShared: z
        .string()
        .nullish()
        .describe("Team-visible profile note on the contact. null clears it."),
    },
    handler: async (
      args: {
        contactId: string;
        customName?: string | null;
        notesShared?: string | null;
      },
      c,
    ) => {
      const { tenantDb } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);

      if (args.customName === undefined && args.notesShared === undefined) {
        throw new McpToolError(
          "Pass customName or notesShared - nothing to update",
        );
      }

      const updated = await tenantDb
        .updateTable("contacts")
        .set({
          ...(args.customName !== undefined
            ? { custom_name: args.customName?.trim() || null }
            : {}),
          ...(args.notesShared !== undefined
            ? { notes_shared: args.notesShared?.trim() || null }
            : {}),
          updated_at: toDbDate(),
        })
        .where("id", "=", args.contactId)
        .returning([
          "id",
          "jid",
          "phone_number",
          "custom_name",
          "push_name",
          "notes_shared",
          "is_group",
        ])
        .executeTakeFirst();
      if (!updated) {
        throw new McpToolError("Contact not found");
      }

      // PATCH /contacts/:id only broadcasts on block/unblock, so a rename
      // stays consistent with it and leaves clients to refetch.
      return {
        contactId: updated.id,
        phoneNumber: updated.phone_number,
        customName: updated.custom_name,
        notesShared: updated.notes_shared,
        displayName: getContactDisplayName(updated),
      };
    },
  },
  {
    name: "add_contact_note",
    description:
      "Add a note to a contact. Shared notes are visible to the whole team; private notes only to the token owner.",
    scope: "write",
    inputSchema: {
      contactId: z.string().uuid(),
      content: z.string().min(1).max(10000),
      private: z.boolean().optional().describe("Default false (shared note)"),
    },
    handler: async (
      args: { contactId: string; content: string; private?: boolean },
      c,
    ) => {
      const { tenantDb, user, companyId } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);
      const content = args.content.trim();

      if (args.private) {
        const note = await tenantDb
          .insertInto("contact_notes_private")
          .values({
            contact_id: args.contactId,
            user_id: user.id,
            content,
          })
          .returning([
            "id",
            "contact_id",
            "user_id",
            "content",
            "created_at",
            "updated_at",
          ])
          .executeTakeFirstOrThrow();
        return transformPrivateNoteResponse({
          ...note,
          content: note.content ?? "",
        });
      }

      const authorName = await getAuthorName(user.id);
      const note = await tenantDb
        .insertInto("contact_notes_shared")
        .values({
          contact_id: args.contactId,
          user_id: user.id,
          author_name: authorName,
          content,
        })
        .returning([
          "id",
          "contact_id",
          "user_id",
          "author_name",
          "content",
          "created_at",
          "updated_at",
        ])
        .executeTakeFirstOrThrow();
      await createMcpAuditLog(c, {
        companyId,
        userId: user.id,
        action: "contact.note.created",
        entityType: "contact_note",
        entityId: note.id,
        details: {
          contactId: args.contactId,
          noteType: "shared",
          contentLength: content.length,
        },
        ipAddress: getClientIp(c),
      });
      return transformSharedNoteResponse(note);
    },
  },
  {
    name: "create_tag",
    description:
      "Create a workspace tag. Always check list_tags first and reuse an existing tag when one matches.",
    scope: "write",
    inputSchema: {
      name: z.string().min(1).max(50),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
    },
    handler: async (args: { name: string; color?: string }, c) => {
      const { tenantDb, user } = getRouteContext(c);
      const name = args.name.trim();
      const existing = await tenantDb
        .selectFrom("tags")
        .select(["id", "name", "color"])
        .where("name", "ilike", name)
        .executeTakeFirst();
      if (existing) {
        throw new McpToolError(
          `A tag named "${existing.name}" already exists (id ${existing.id}); use it instead`,
        );
      }
      const tag = await tenantDb
        .insertInto("tags")
        .values({ name, color: args.color || null, created_by: user.id })
        .returning(["id", "name", "color"])
        .executeTakeFirstOrThrow();
      return tag;
    },
  },
  {
    name: "tag_contact",
    description: "Add an existing tag to a contact.",
    scope: "write",
    inputSchema: {
      contactId: z.string().uuid(),
      tagId: z.string().uuid(),
    },
    handler: async (args: { contactId: string; tagId: string }, c) => {
      const { tenantDb } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);
      const tag = await tenantDb
        .selectFrom("tags")
        .select(["id", "name", "color"])
        .where("id", "=", args.tagId)
        .executeTakeFirst();
      if (!tag) {
        throw new McpToolError("Tag not found");
      }
      const existing = await tenantDb
        .selectFrom("contact_tags")
        .select(["contact_id"])
        .where("contact_id", "=", args.contactId)
        .where("tag_id", "=", args.tagId)
        .executeTakeFirst();
      if (existing) {
        return { contactId: args.contactId, tag, alreadyTagged: true };
      }
      await tenantDb
        .insertInto("contact_tags")
        .values({ contact_id: args.contactId, tag_id: args.tagId })
        .execute();
      return { contactId: args.contactId, tag, alreadyTagged: false };
    },
  },
  {
    name: "untag_contact",
    description: "Remove a tag from a contact.",
    scope: "write",
    inputSchema: {
      contactId: z.string().uuid(),
      tagId: z.string().uuid(),
    },
    handler: async (args: { contactId: string; tagId: string }, c) => {
      const { tenantDb } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);
      await tenantDb
        .deleteFrom("contact_tags")
        .where("contact_id", "=", args.contactId)
        .where("tag_id", "=", args.tagId)
        .execute();
      return { contactId: args.contactId, removed: true };
    },
  },
  {
    name: "create_broadcast",
    description:
      "Schedule a bulk text broadcast to many contacts. HIGH IMPACT: this messages every recipient in the audience; double-check the audience (tag ids and/or contact ids) and schedule before calling. Requires a stable idempotency key and a scheduled time from 30 seconds to one year in the future. Also requires the can_send_messages permission.",
    scope: "write",
    permission: "can_send_bulk_messages",
    inputSchema: {
      name: z.string().trim().min(1).max(200),
      content: z.string().trim().min(1).max(65536),
      tagIds: z.array(z.string().uuid()).max(50).optional(),
      contactIds: z.array(z.string().uuid()).max(500).optional(),
      scheduledAt: z
        .string()
        .datetime({ offset: true })
        .describe("ISO datetime, from 30s to one year in the future"),
      idempotencyKey: z
        .string()
        .trim()
        .min(8)
        .max(128)
        .describe("Stable client-generated key that makes retries safe"),
    },
    handler: async (
      args: {
        name: string;
        content: string;
        tagIds?: string[];
        contactIds?: string[];
        scheduledAt: string;
        idempotencyKey: string;
      },
      c,
    ) => {
      const { tenantDb, user, companyId, permissions } = getRouteContext(c);
      // Broadcast creation requires both bulk and regular send permissions,
      // mirroring the REST route's middleware stack.
      if (permissions.can_send_messages !== true) {
        throw new McpToolError(
          "Your workspace role does not grant the 'can_send_messages' permission required by this tool",
        );
      }
      await enforceBulkRateLimit(c);

      const tagIds = args.tagIds ?? [];
      const contactIds = args.contactIds ?? [];
      if (tagIds.length === 0 && contactIds.length === 0) {
        throw new McpToolError(
          "Provide at least one tagId or contactId for the audience",
        );
      }
      const scheduledAt = new Date(args.scheduledAt);
      validateBroadcastSchedule(scheduledAt);

      const audience = { tagIds, contactIds };
      const resolved = await resolveBulkAudience(tenantDb, audience);
      if (resolved.eligible.length === 0) {
        throw new McpToolError(
          "The audience resolves to zero eligible recipients",
        );
      }

      const result = await createBulkJob(tenantDb, {
        companyId,
        name: args.name,
        audience,
        content: args.content,
        messageType: "text",
        mediaUrl: null,
        mediaMimeType: null,
        mediaFileName: null,
        scheduledAt,
        audienceHash: resolved.audienceHash,
        idempotencyKey: args.idempotencyKey,
        createdBy: user.id,
      });

      if (result.created) {
        await createMcpAuditLog(c, {
          companyId,
          userId: user.id,
          action: "bulk_job.created",
          entityType: "bulk_job",
          entityId: result.job.id,
          details: {
            name: result.job.name,
            recipients: result.job.total_recipients,
            skipped: result.job.skipped_recipients,
            scheduledAt: args.scheduledAt,
            messageType: "text",
          },
          ipAddress: getClientIp(c),
        });
        await broadcastToCompany(companyId, "bulk_job:updated", {
          bulkJobId: result.job.id,
          status: result.job.status,
        });
      }

      const progress = await getBulkJobProgress(tenantDb, result.job.id);
      const job = formatBulkJob(result.job, progress);
      return {
        broadcastId: job.id,
        name: job.name,
        status: job.status,
        scheduledAt: job.scheduledAt,
        totalRecipients: job.totalRecipients,
        alreadyExisted: !result.created,
      };
    },
  },
] as McpToolDefinition[];
