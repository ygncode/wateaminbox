import { zValidator } from "@hono/zod-validator";
import { toDbDate } from "@wateaminbox/shared";
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
import { broadcastToContactViewers } from "../../services/message-broadcast.service.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import {
  getActiveCase,
  hasCaseHistory,
  reopenAsNewCase,
  resolveActiveCase,
  resumePendingCase,
  setActiveCasePending,
} from "../../services/conversation-case.service.js";
import { getConversationState } from "../../services/conversation-state.service.js";

export const stateRoutes = new Hono();

async function loadContact(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  contactId: string,
) {
  return tenantDb
    .selectFrom("contacts")
    .select(["id", "custom_name", "push_name", "phone_number", "is_group"])
    .where("id", "=", contactId)
    .executeTakeFirst();
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
  const contactId = c.req.param("id")!;

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
    const contactId = c.req.param("id")!;
    const { outcome, notes } = c.req.valid("json");

    const contact = await loadContact(tenantDb, contactId);
    if (!contact) {
      return notFound(c, "Contact");
    }

    const resolvedCase = await resolveActiveCase(tenantDb, contactId, {
      outcome,
      notes,
      resolvedBy: user.id,
    });

    await createAuditLog({
      companyId,
      userId: user.id,
      action: "conversation.resolved",
      entityType: "conversation",
      entityId: contactId,
      details: {
        contactId,
        contactName:
          contact.custom_name || contact.push_name || contact.phone_number,
        caseId: resolvedCase.id,
        outcome,
        notes,
      },
      ipAddress: getClientIp(c),
    });

    await broadcastToContactViewers(
      companyId,
      contactId,
      "conversation:updated",
      {
        event: "resolved",
        contactId,
        caseId: resolvedCase.id,
        resolvedBy: user.id,
        resolvedAt: resolvedCase.resolvedAt?.toISOString(),
      },
    );

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
  const contactId = c.req.param("id")!;

  const contact = await loadContact(tenantDb, contactId);
  if (!contact) {
    return notFound(c, "Contact");
  }

  const newCase = await reopenAsNewCase(
    tenantDb,
    { id: contactId, isGroup: contact.is_group },
    { companyId, openedBy: user.id, reason, expectedMode },
  );
  const wasReopen = Boolean(newCase.reopenedFromCaseId);

  await createAuditLog({
    companyId,
    userId: user.id,
    action: wasReopen ? "conversation.reopened" : "conversation.opened",
    entityType: "conversation",
    entityId: contactId,
    details: {
      contactId,
      contactName:
        contact.custom_name || contact.push_name || contact.phone_number,
      caseId: newCase.id,
      reopenedFromCaseId: newCase.reopenedFromCaseId,
      reason,
    },
    ipAddress: getClientIp(c),
  });

  await broadcastToContactViewers(
    companyId,
    contactId,
    "conversation:updated",
    {
      event: wasReopen ? "reopened" : "opened",
      contactId,
      caseId: newCase.id,
      // Field names track the ACTUAL transition (`wasReopen`), never the
      // endpoint name - a genuine first-ever open must never be reported
      // under reopenedBy/reopenedAt, and vice versa.
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
  const contactId = c.req.param("id")!;

  const contact = await loadContact(tenantDb, contactId);
  if (!contact) {
    return notFound(c, "Contact");
  }

  const pendingCase = await setActiveCasePending(tenantDb, contactId, user.id);

  // A live inbound can flip a pending case back to open at any moment (see
  // conversation-case.service.ts), so this transition otherwise leaves no
  // trace once that happens - the audit log is the only durable record
  // that an agent deliberately paused it.
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "conversation.pending",
    entityType: "conversation",
    entityId: contactId,
    details: {
      contactId,
      contactName:
        contact.custom_name || contact.push_name || contact.phone_number,
      caseId: pendingCase.id,
    },
    ipAddress: getClientIp(c),
  });

  await broadcastToContactViewers(
    companyId,
    contactId,
    "conversation:updated",
    {
      event: "pending",
      contactId,
      caseId: pendingCase.id,
    },
  );

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
  const contactId = c.req.param("id")!;

  const contact = await loadContact(tenantDb, contactId);
  if (!contact) {
    return notFound(c, "Contact");
  }

  const openedCase = await resumePendingCase(tenantDb, contactId, user.id);

  await createAuditLog({
    companyId,
    userId: user.id,
    action: "conversation.resumed",
    entityType: "conversation",
    entityId: contactId,
    details: {
      contactId,
      contactName:
        contact.custom_name || contact.push_name || contact.phone_number,
      caseId: openedCase.id,
    },
    ipAddress: getClientIp(c),
  });

  await broadcastToContactViewers(
    companyId,
    contactId,
    "conversation:updated",
    {
      event: "resumed",
      contactId,
      caseId: openedCase.id,
    },
  );

  return successData(c, openedCase);
});

/**
 * POST /conversations/:id/read - Mark a conversation as read (reset unread count)
 */
stateRoutes.post("/:id/read", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const contactId = c.req.param("id")!;

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  // Update conversation_states to reset unread count and record read time
  const updateResult = await tenantDb
    .updateTable("conversation_states")
    .set({
      unread_count: 0,
      read_at: toDbDate(),
      read_by_user_id: user.id,
      updated_at: toDbDate(),
    })
    .where("contact_id", "=", contactId)
    .executeTakeFirst();

  // If no row exists, create one with unread_count = 0
  if (updateResult.numUpdatedRows === BigInt(0)) {
    await tenantDb
      .insertInto("conversation_states")
      .values({
        contact_id: contactId,
        unread_count: 0,
        read_at: toDbDate(),
        read_by_user_id: user.id,
      })
      .execute();
  }

  await broadcastToContactViewers(companyId, contactId, "conversation:read", {
    contactId,
    unreadCount: 0,
    readBy: user.id,
  });

  return successData(c, { unreadCount: 0 });
});
