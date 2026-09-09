import { zValidator } from "@hono/zod-validator";
import { getContactDisplayName, toDbDate } from "@wateaminbox/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { successData } from "../../lib/response.js";
import {
  openConversationSchema,
  resolveConversationSchema,
} from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  broadcastToContactViewers,
  broadcastToConversationViewers,
} from "../../services/message-broadcast.service.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import {
  getActiveCase,
  hasCaseHistory,
  reopenAsNewCase,
  reopenAsNewCaseForConversation,
  resolveActiveCase,
  resolveActiveCaseForConversation,
  resumePendingCase,
  resumePendingCaseForConversation,
  setActiveCasePending,
  setActiveCasePendingForConversation,
} from "../../services/conversation-case.service.js";
import {
  resolveWorkflowIdentity,
  type WorkflowIdentity,
} from "../../services/channel-workflow.service.js";
import { getConversationState } from "../../services/conversation-state.service.js";

export const stateRoutes = new Hono();

async function loadContact(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  contactId: string,
) {
  return tenantDb
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
}

async function loadWorkflowContact(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  id: string,
) {
  const contact = await loadContact(tenantDb, id);
  if (contact) return contact;
  const identity = await resolveWorkflowIdentity(tenantDb, id);
  return identity?.contactId
    ? loadContact(tenantDb, identity.contactId)
    : undefined;
}

function workflowLabel(
  identity: WorkflowIdentity,
  contact?:
    | {
        custom_name: string | null;
        push_name: string | null;
        username: string | null;
        phone_number: string | null;
      }
    | undefined,
) {
  if (contact) return getContactDisplayName(contact, "Unknown");
  return identity.subject?.trim() || "Conversation";
}

/**
 * GET /conversations/:id/state - Get the conversation lifecycle state (the
 * current projection plus the active case, if any) for a contact.
 * `hasCaseHistory` tells the UI whether Open (no prior case) or Reopen (a
 * prior, resolved case exists) is the correct label/flow to offer for a
 * resolved conversation.
 */
stateRoutes.get("/:id/state", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contact = await loadWorkflowContact(tenantDb, c.req.param("id")!);
  const contactId = contact?.id ?? c.req.param("id")!;

  const [state, activeCase, caseHistory] = await Promise.all([
    getConversationState(tenantDb, contactId),
    getActiveCase(tenantDb, contactId),
    hasCaseHistory(tenantDb, contactId),
  ]);

  if (!state) {
    return successData(c, {
      contactId,
      status: "resolved",
      resolvedAt: null,
      resolvedBy: null,
      reopenedAt: null,
      reopenedBy: null,
      resolutionNotes: null,
      activeCase: null,
      hasCaseHistory: caseHistory,
    });
  }

  return successData(c, { ...state, activeCase, hasCaseHistory: caseHistory });
});

/**
 * POST /conversations/:id/resolve - Resolve the contact's active case with
 * a required close outcome (and notes, if the outcome is `other`).
 */
stateRoutes.post(
  "/:id/resolve",
  requireMessageSendPermission,
  zValidator("json", resolveConversationSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const { outcome, notes } = c.req.valid("json");
    const identity = await resolveWorkflowIdentity(
      tenantDb,
      c.req.param("id")!,
    );
    if (!identity) return notFound(c, "Conversation");
    const contact = identity.contactId
      ? await loadContact(tenantDb, identity.contactId)
      : undefined;
    const resolvedCase = identity.contactId
      ? await resolveActiveCase(tenantDb, identity.contactId, {
          outcome,
          notes,
          resolvedBy: user.id,
        })
      : await resolveActiveCaseForConversation(
          tenantDb,
          identity.conversationId!,
          { outcome, notes, resolvedBy: user.id },
        );
    const entityId = identity.contactId ?? identity.conversationId!;
    await createAuditLog({
      companyId,
      userId: user.id,
      action: "conversation.resolved",
      entityType: "conversation",
      entityId,
      details: {
        contactId: identity.contactId,
        conversationId: identity.conversationId,
        contactName: workflowLabel(identity, contact),
        caseId: resolvedCase.id,
        outcome,
        notes,
      },
      ipAddress: getClientIp(c),
    });
    const payload = {
      event: "resolved",
      contactId: identity.contactId,
      conversationId: identity.conversationId,
      caseId: resolvedCase.id,
      resolvedBy: user.id,
      resolvedAt: resolvedCase.resolvedAt?.toISOString(),
    };
    if (identity.contactId) {
      await broadcastToContactViewers(
        companyId,
        identity.contactId,
        "conversation:updated",
        payload,
      );
    } else {
      await broadcastToConversationViewers(
        companyId,
        identity.conversationId,
        "conversation:updated",
        payload,
      );
    }
    return successData(c, resolvedCase);
  },
);

/**
 * Shared implementation for manual Open and Reopen. `expectedMode` is which
 * endpoint was actually hit - `/open` requires there to be NO prior case
 * history, `/reopen` requires there to BE some; a mismatch (a stale client
 * view of `hasCaseHistory` racing a concurrent auto-reopen or resolve) is a
 * controlled 409, never a silent fallthrough into the other transition. See
 * `reopenAsNewCase`'s `expectedMode` doc comment.
 */
async function performManualOpenOrReopen(
  c: Context,
  expectedMode: "open" | "reopen",
  reason: string | undefined,
) {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  if (!identity) return notFound(c, "Conversation");
  const contact = identity.contactId
    ? await loadContact(tenantDb, identity.contactId)
    : undefined;
  const newCase = identity.contactId
    ? await reopenAsNewCase(
        tenantDb,
        { id: identity.contactId, isGroup: identity.isGroup },
        { companyId, openedBy: user.id, reason, expectedMode },
      )
    : await reopenAsNewCaseForConversation(
        tenantDb,
        { id: identity.conversationId!, isGroup: identity.isGroup },
        { companyId, openedBy: user.id, reason, expectedMode },
      );
  const wasReopen = Boolean(newCase.reopenedFromCaseId);
  const entityId = identity.contactId ?? identity.conversationId!;
  await createAuditLog({
    companyId,
    userId: user.id,
    action: wasReopen ? "conversation.reopened" : "conversation.opened",
    entityType: "conversation",
    entityId,
    details: {
      contactId: identity.contactId,
      conversationId: identity.conversationId,
      contactName: workflowLabel(identity, contact),
      caseId: newCase.id,
      reopenedFromCaseId: newCase.reopenedFromCaseId,
      reason,
    },
    ipAddress: getClientIp(c),
  });
  const payload = {
    event: wasReopen ? "reopened" : "opened",
    contactId: identity.contactId,
    conversationId: identity.conversationId,
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
  };
  if (identity.contactId) {
    await broadcastToContactViewers(
      companyId,
      identity.contactId,
      "conversation:updated",
      payload,
    );
  } else {
    await broadcastToConversationViewers(
      companyId,
      identity.conversationId,
      "conversation:updated",
      payload,
    );
  }
  return successData(c, newCase);
}

/**
 * POST /conversations/:id/open - Manually open a conversation that has
 * never had a case. Reason is optional (there's nothing prior to justify
 * reopening). If a prior case actually exists, this returns a 409 instead
 * of transparently reopening - the caller's view is stale and must refetch
 * and use `/reopen`.
 */
stateRoutes.post(
  "/:id/open",
  requireMessageSendPermission,
  zValidator("json", openConversationSchema.optional().default({})),
  (c) => performManualOpenOrReopen(c, "open", c.req.valid("json").reason),
);

/**
 * POST /conversations/:id/reopen - Manually reopen a resolved conversation
 * as a brand-new case (the previous case is preserved, never mutated).
 * Requires `reason`. If there is no prior case history at all, returns a
 * 409 instead of transparently opening - the caller's view is stale and
 * must refetch and use `/open`.
 */
stateRoutes.post(
  "/:id/reopen",
  requireMessageSendPermission,
  zValidator("json", openConversationSchema.optional().default({})),
  (c) => performManualOpenOrReopen(c, "reopen", c.req.valid("json").reason),
);

/**
 * POST /conversations/:id/pending - Mark the contact's active case pending.
 * Stays within the same case; does not pause either SLA clock.
 */
stateRoutes.post("/:id/pending", requireMessageSendPermission, async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  if (!identity) return notFound(c, "Conversation");
  const contact = identity.contactId
    ? await loadContact(tenantDb, identity.contactId)
    : undefined;
  const pendingCase = identity.contactId
    ? await setActiveCasePending(tenantDb, identity.contactId, user.id)
    : await setActiveCasePendingForConversation(
        tenantDb,
        identity.conversationId!,
        user.id,
      );
  const entityId = identity.contactId ?? identity.conversationId!;
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "conversation.pending",
    entityType: "conversation",
    entityId,
    details: {
      contactId: identity.contactId,
      conversationId: identity.conversationId,
      contactName: workflowLabel(identity, contact),
      caseId: pendingCase.id,
    },
    ipAddress: getClientIp(c),
  });
  const payload = {
    event: "pending",
    contactId: identity.contactId,
    conversationId: identity.conversationId,
    caseId: pendingCase.id,
  };
  if (identity.contactId) {
    await broadcastToContactViewers(
      companyId,
      identity.contactId,
      "conversation:updated",
      payload,
    );
  } else {
    await broadcastToConversationViewers(
      companyId,
      identity.conversationId,
      "conversation:updated",
      payload,
    );
  }
  return successData(c, pendingCase);
});

/**
 * POST /conversations/:id/resume - Resume a pending case back to open.
 * The SAME case (never a new one) - `opened_at` and both SLA clocks are
 * unaffected, since `pending` never paused them. Distinct from `/open`
 * (which always starts a brand-new case for a contact with none active).
 */
stateRoutes.post("/:id/resume", requireMessageSendPermission, async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  if (!identity) return notFound(c, "Conversation");
  const contact = identity.contactId
    ? await loadContact(tenantDb, identity.contactId)
    : undefined;
  const openedCase = identity.contactId
    ? await resumePendingCase(tenantDb, identity.contactId, user.id)
    : await resumePendingCaseForConversation(
        tenantDb,
        identity.conversationId!,
        user.id,
      );
  const entityId = identity.contactId ?? identity.conversationId!;
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "conversation.resumed",
    entityType: "conversation",
    entityId,
    details: {
      contactId: identity.contactId,
      conversationId: identity.conversationId,
      contactName: workflowLabel(identity, contact),
      caseId: openedCase.id,
    },
    ipAddress: getClientIp(c),
  });
  const payload = {
    event: "resumed",
    contactId: identity.contactId,
    conversationId: identity.conversationId,
    caseId: openedCase.id,
  };
  if (identity.contactId) {
    await broadcastToContactViewers(
      companyId,
      identity.contactId,
      "conversation:updated",
      payload,
    );
  } else {
    await broadcastToConversationViewers(
      companyId,
      identity.conversationId,
      "conversation:updated",
      payload,
    );
  }
  return successData(c, openedCase);
});

/**
 * POST /conversations/:id/read - Mark a conversation as read (reset unread count)
 */
stateRoutes.post("/:id/read", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  if (!identity) return notFound(c, "Conversation");
  const updateQuery = tenantDb.updateTable("conversation_states").set({
    unread_count: 0,
    read_at: toDbDate(),
    read_by_user_id: user.id,
    updated_at: toDbDate(),
  });
  const updateResult = identity.contactId
    ? await updateQuery
        .where("contact_id", "=", identity.contactId)
        .executeTakeFirst()
    : await updateQuery
        .where("conversation_id", "=", identity.conversationId!)
        .executeTakeFirst();
  if (updateResult.numUpdatedRows === BigInt(0)) {
    await tenantDb
      .insertInto("conversation_states")
      .values({
        contact_id: identity.contactId,
        conversation_id: identity.conversationId,
        unread_count: 0,
        read_at: toDbDate(),
        read_by_user_id: user.id,
      })
      .execute();
  }
  const payload = {
    contactId: identity.contactId,
    conversationId: identity.conversationId,
    unreadCount: 0,
    readBy: user.id,
  };
  if (identity.contactId) {
    await broadcastToContactViewers(
      companyId,
      identity.contactId,
      "conversation:read",
      payload,
    );
  } else {
    await broadcastToConversationViewers(
      companyId,
      identity.conversationId,
      "conversation:read",
      payload,
    );
  }
  return successData(c, { unreadCount: 0 });
});
