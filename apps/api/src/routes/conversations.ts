import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";

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
