import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
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

  // Get quoted messages if any
  const quotedIds = messages
    .filter((m) => m.quoted_message_id)
    .map((m) => m.quoted_message_id as string);

  let quotedMessages: Map<string, unknown> = new Map();
  if (quotedIds.length > 0) {
    const quoted = await tenantDb
      .selectFrom("messages")
      .select(["message_id", "content", "message_type", "sender_jid"])
      .where("message_id", "in", quotedIds)
      .execute();

    quotedMessages = new Map(
      quoted
        .filter((q) => q.message_id !== null)
        .map((q) => [q.message_id as string, q]),
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
    quotedMessage: msg.quoted_message_id
      ? quotedMessages.get(msg.quoted_message_id) || null
      : null,
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
      contactName: contact.custom_name || contact.push_name || contact.phone_number,
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
      contactName: contact.custom_name || contact.push_name || contact.phone_number,
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
