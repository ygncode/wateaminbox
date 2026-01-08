import { Hono } from "hono";
import { badRequest, notFound } from "../lib/errors.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requirePermission } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import {
  getConversationState,
  resolveConversation,
  reopenConversation,
  setConversationPending,
  getResolutionStats,
  getResolutionTrend,
} from "../services/conversation-state.service.js";
import { createAuditLog, getClientIp } from "../services/audit.service.js";
import { broadcastToCompany } from "./ws/index.js";
import { PERMISSIONS } from "../services/permission.service.js";
import { publishSendMessage } from "../lib/nats/index.js";
import { ensureContactAssignment } from "../services/contact.service.js";
import {
  formatMessagesForConversation,
  buildQuotedMessageData,
  type MessageDbRow,
} from "../lib/message-formatters.js";
import { extractPaginationParams } from "../lib/route-helpers.js";

export const conversationRoutes = new Hono();

// All conversation routes require authentication and tenant context
conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", tenantMiddleware());

/**
 * GET /conversations/:id/messages - Get messages for a conversation/contact
 * Query params: limit, cursor (for pagination)
 */
conversationRoutes.get("/:id/messages", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const { limit } = extractPaginationParams(c);
  const cursor = c.req.query("cursor"); // Message ID for cursor pagination

  let query = tenantDb
    .selectFrom("messages")
    .selectAll()
    .where("contact_id", "=", contactId)
    .orderBy("timestamp", "desc")
    .limit(limit);

  // Cursor pagination - get messages before a specific message
  if (cursor) {
    const cursorMessage = await tenantDb
      .selectFrom("messages")
      .select(["timestamp"])
      .where("id", "=", cursor)
      .executeTakeFirst();

    if (cursorMessage) {
      query = query.where("timestamp", "<", cursorMessage.timestamp);
    }
  }

  const messages = await query.execute();

  // Get quoted messages if any (for reply functionality)
  const quotedIds = messages
    .filter((m) => m.quoted_message_id)
    .map((m) => m.quoted_message_id as string);

  let quotedMessagesMap = new Map<string, ReturnType<typeof buildQuotedMessageData>>();
  if (quotedIds.length > 0) {
    const quoted = await tenantDb
      .selectFrom("messages")
      .selectAll()
      .where("message_id", "in", quotedIds)
      .execute();

    quotedMessagesMap = new Map(
      quoted
        .filter((q) => q.message_id !== null)
        .map((q) => [
          q.message_id as string,
          buildQuotedMessageData(q as MessageDbRow),
        ]),
    );
  }

  // Map to frontend format using shared formatter
  const formattedMessages = formatMessagesForConversation(
    messages as MessageDbRow[],
    quotedMessagesMap
  );

  return c.json({
    messages: formattedMessages,
    hasMore: messages.length === limit,
    nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
  });
});

/**
 * POST /conversations/:id/messages - Send a new message
 * Requires can_send_messages permission
 */
conversationRoutes.post(
  "/:id/messages",
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const contactId = c.req.param("id");
    const body = await c.req.json();

    const { content, messageType = "text", mediaUrl, replyToMessageId } = body;

    if (!content && messageType === "text") {
      return badRequest(c, "content is required for text messages");
    }

    // Get contact JID and connection ID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", contactId)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Contact");
    }

    // Get active WhatsApp connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "jid"])
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      return badRequest(c, "No active WhatsApp connection");
    }

    // Auto-assign contact to the user if unassigned
    const wasAutoAssigned = await ensureContactAssignment(
      tenantDb,
      contactId,
      user.id,
    );

    // Look up the WhatsApp message ID and sender for reply-to if provided
    let quotedWaMessageId: string | undefined;
    let quotedSenderJid: string | undefined;
    if (replyToMessageId) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["message_id", "sender_jid", "from_me"])
        .where("id", "=", replyToMessageId)
        .executeTakeFirst();
      quotedWaMessageId = quotedMessage?.message_id || undefined;

      if (quotedMessage?.from_me) {
        quotedSenderJid = connection.jid || undefined;
      } else {
        quotedSenderJid = quotedMessage?.sender_jid || contact.jid;
      }
    }

    // Create a pending message in database
    const messageId = crypto.randomUUID();
    const waMessageId = `pending_${messageId}`;

    await tenantDb
      .insertInto("messages")
      .values({
        id: messageId,
        contact_id: contactId,
        whatsapp_connection_id: connection.id,
        message_id: waMessageId,
        from_me: true,
        sender_jid: null,
        message_type: messageType,
        content,
        media_url: mediaUrl || null,
        quoted_message_id: quotedWaMessageId || null,
        sent_by_user_id: user.id,
        status: "pending",
        timestamp: new Date(),
        created_at: new Date(),
      })
      .execute();

    // Publish send command to NATS
    await publishSendMessage(
      companyId,
      connection.id,
      contact.jid,
      content,
      messageType,
      user.id,
      mediaUrl,
      quotedWaMessageId,
      quotedSenderJid,
    );

    return c.json({
      success: true,
      message: {
        id: messageId,
        messageId: waMessageId,
        conversationId: contactId,
        contactId,
        fromMe: true,
        messageType,
        content,
        mediaUrl,
        replyToMessageId: replyToMessageId || null,
        timestamp: new Date().toISOString(),
        status: "pending",
      },
      autoAssigned: wasAutoAssigned,
    });
  },
);

/**
 * GET /conversations/:id/state - Get the conversation state for a contact
 */
conversationRoutes.get("/:id/state", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");

  const state = await getConversationState(tenantDb, contactId);

  if (!state) {
    return c.json({
      contactId,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      reopenedAt: null,
      reopenedBy: null,
      resolutionNotes: null,
    });
  }

  return c.json(state);
});

/**
 * POST /conversations/:id/resolve - Mark a conversation as resolved
 */
conversationRoutes.post("/:id/resolve", async (c) => {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");

  let notes: string | undefined;
  try {
    const body = await c.req.json();
    notes = body.notes;
  } catch {
    // No body
  }

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "custom_name", "push_name", "phone_number"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  const state = await resolveConversation(tenantDb, contactId, user.id, notes);

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

  return c.json({
    success: true,
    state,
  });
});

/**
 * POST /conversations/:id/reopen - Reopen a resolved conversation
 */
conversationRoutes.post("/:id/reopen", async (c) => {
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

  return c.json({
    success: true,
    state,
  });
});

/**
 * POST /conversations/:id/pending - Set a conversation to pending status
 */
conversationRoutes.post("/:id/pending", async (c) => {
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

  return c.json({
    success: true,
    state,
  });
});

/**
 * POST /conversations/:id/read - Mark a conversation as read (reset unread count)
 */
conversationRoutes.post("/:id/read", async (c) => {
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

  return c.json({
    success: true,
    unreadCount: 0,
  });
});

/**
 * GET /conversations/stats/resolution - Get resolution statistics
 */
conversationRoutes.get("/stats/resolution", async (c) => {
  const { tenantDb } = getRouteContext(c);

  const stats = await getResolutionStats(tenantDb);

  return c.json({
    data: stats,
  });
});

/**
 * GET /conversations/stats/resolution-trend - Get resolution trend over time
 */
conversationRoutes.get("/stats/resolution-trend", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  // Default to last 30 days if not specified
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const trend = await getResolutionTrend(tenantDb, startDate, endDate);

  return c.json({
    data: trend,
    meta: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  });
});
