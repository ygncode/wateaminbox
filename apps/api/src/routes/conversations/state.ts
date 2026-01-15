import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { resolveConversationSchema } from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import {
  getConversationState,
  reopenConversation,
  resolveConversation,
  setConversationPending,
} from "../../services/conversation-state.service.js";
import { broadcastToCompany } from "../ws/index.js";

export const stateRoutes = new Hono();

/**
 * GET /conversations/:id/state - Get the conversation state for a contact
 */
stateRoutes.get("/:id/state", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");

  const state = await getConversationState(tenantDb, contactId);

  if (!state) {
    return successData(c, {
      contactId,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      reopenedAt: null,
      reopenedBy: null,
      resolutionNotes: null,
    });
  }

  return successData(c, state);
});

/**
 * POST /conversations/:id/resolve - Mark a conversation as resolved
 */
stateRoutes.post(
  "/:id/resolve",
  zValidator("json", resolveConversationSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const contactId = c.req.param("id");
    const { notes } = c.req.valid("json");

    // Verify contact exists
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "custom_name", "push_name", "phone_number"])
      .where("id", "=", contactId)
      .executeTakeFirst();

    if (!contact) {
      return notFound(c, "Contact");
    }

    const state = await resolveConversation(
      tenantDb,
      contactId,
      user.id,
      notes,
    );

    // Create audit log
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
        notes,
      },
      ipAddress: getClientIp(c.req.raw.headers),
    });

    // Broadcast WebSocket event
    broadcastToCompany(companyId, {
      type: "conversation",
      payload: {
        event: "resolved",
        contactId,
        resolvedBy: user.id,
        resolvedAt: state.resolvedAt?.toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    return successData(c, state);
  },
);

/**
 * POST /conversations/:id/reopen - Reopen a resolved conversation
 */
stateRoutes.post("/:id/reopen", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "custom_name", "push_name", "phone_number"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  const state = await reopenConversation(tenantDb, contactId, user.id);

  // Create audit log
  await createAuditLog({
    companyId,
    userId: user.id,
    action: "conversation.reopened",
    entityType: "conversation",
    entityId: contactId,
    details: {
      contactId,
      contactName:
        contact.custom_name || contact.push_name || contact.phone_number,
    },
    ipAddress: getClientIp(c.req.raw.headers),
  });

  // Broadcast WebSocket event
  broadcastToCompany(companyId, {
    type: "conversation",
    payload: {
      event: "reopened",
      contactId,
      reopenedBy: user.id,
      reopenedAt: state.reopenedAt?.toISOString(),
    },
    timestamp: new Date().toISOString(),
  });

  return successData(c, state);
});

/**
 * POST /conversations/:id/pending - Set a conversation to pending status
 */
stateRoutes.post("/:id/pending", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  const state = await setConversationPending(tenantDb, contactId);

  // Broadcast WebSocket event
  broadcastToCompany(companyId, {
    type: "conversation",
    payload: {
      event: "pending",
      contactId,
    },
    timestamp: new Date().toISOString(),
  });

  return successData(c, state);
});

/**
 * POST /conversations/:id/read - Mark a conversation as read (reset unread count)
 */
stateRoutes.post("/:id/read", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");

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
      read_at: new Date(),
      read_by_user_id: user.id,
      updated_at: new Date(),
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
        read_at: new Date(),
        read_by_user_id: user.id,
      })
      .execute();
  }

  // Broadcast WebSocket event to update other clients
  broadcastToCompany(companyId, {
    type: "conversation",
    payload: {
      event: "read",
      contactId,
      unreadCount: 0,
      readBy: user.id,
    },
    timestamp: new Date().toISOString(),
  });

  return successData(c, { unreadCount: 0 });
});
