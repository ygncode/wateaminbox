import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requirePermission } from "../middleware/tenant.js";
import {
  getConversationState,
  resolveConversation,
  reopenConversation,
  setConversationPending,
  getResolutionStats,
  getResolutionTrend,
} from "../services/conversation-state.service.js";
import { createAuditLog, getClientIp } from "../services/audit.service.js";
import { broadcastToCompany } from "./ws.js";
import { PERMISSIONS } from "../services/permission.service.js";
import { publishSendMessage } from "../lib/nats.js";
import { ensureContactAssignment } from "../services/contact.service.js";

export const conversationRoutes = new Hono();

// All conversation routes require authentication and tenant context
conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", tenantMiddleware());

/**
 * GET /conversations/:id/messages - Get messages for a conversation/contact
 * Query params: limit, cursor (for pagination)
 */
conversationRoutes.get("/:id/messages", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "50", 10);
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

  let quotedMessagesMap: Map<string, any> = new Map();
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
          {
            id: q.id,
            conversationId: q.contact_id,
            senderId: q.sent_by_user_id || q.sender_jid || "",
            senderType: q.from_me ? "user" : "contact",
            messageType: q.message_type,
            content: q.content || "",
            isDeleted: q.deleted_by_sender || !!q.deleted_at,
            status: q.status || (q.from_me ? "sent" : "delivered"),
            createdAt: q.created_at,
            updatedAt: q.created_at,
          },
        ]),
    );
  }

  // Map to frontend format
  const formattedMessages = messages.map((msg) => ({
    id: msg.id,
    messageId: msg.message_id,
    conversationId: msg.contact_id,
    contactId: msg.contact_id,
    senderId: msg.sent_by_user_id || msg.sender_jid || "",
    senderType: msg.from_me ? "user" : "contact",
    senderJid: msg.sender_jid,
    messageType: msg.message_type,
    content: msg.content || "",
    mediaUrl: msg.media_url,
    metadata: msg.media_url
      ? {
          mediaUrl: msg.media_url,
          mimeType: msg.media_mime_type,
          fileSize: msg.media_size,
        }
      : undefined,
    replyToMessageId: msg.quoted_message_id || undefined,
    replyToMessage: msg.quoted_message_id
      ? quotedMessagesMap.get(msg.quoted_message_id) || null
      : undefined,
    isForwarded: msg.is_forwarded,
    isStarred: msg.is_starred,
    isDeleted: msg.deleted_by_sender || !!msg.deleted_at,
    deletedAt: msg.deleted_at,
    sentByUserId: msg.sent_by_user_id,
    status: msg.status || (msg.from_me ? "sent" : "delivered"),
    timestamp: msg.timestamp,
    createdAt: msg.created_at,
    updatedAt: msg.created_at,
  }));

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
    const tenantDb = c.get("tenantDb");
    const user = c.get("user");
    const companyId = c.get("companyId");
    const contactId = c.req.param("id");
    const body = await c.req.json();

    const { content, messageType = "text", mediaUrl, replyToMessageId } = body;

    if (!content && messageType === "text") {
      return c.json({ error: "content is required for text messages" }, 400);
    }

    // Get contact JID and connection ID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", contactId)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return c.json({ error: "Contact not found or has no JID" }, 404);
    }

    // Get active WhatsApp connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "jid"])
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      return c.json({ error: "No active WhatsApp connection" }, 400);
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
  const tenantDb = c.get("tenantDb");
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
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
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
    return c.json({ error: "Contact not found" }, 404);
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
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "custom_name", "push_name", "phone_number"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
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
  const tenantDb = c.get("tenantDb");
  const companyId = c.get("companyId");
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
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
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
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
  const tenantDb = c.get("tenantDb");

  const stats = await getResolutionStats(tenantDb);

  return c.json({
    data: stats,
  });
});

/**
 * GET /conversations/stats/resolution-trend - Get resolution trend over time
 */
conversationRoutes.get("/stats/resolution-trend", async (c) => {
  const tenantDb = c.get("tenantDb");
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
