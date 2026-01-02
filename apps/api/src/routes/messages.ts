import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { publishSendMessage } from "../lib/nats.js";

export const messageRoutes = new Hono();

// All message routes require authentication and tenant context
messageRoutes.use("/*", authMiddleware);
messageRoutes.use("/*", tenantMiddleware());

/**
 * GET /messages - Get messages for a contact
 * Query params: contactId (required), limit, before (cursor for pagination)
 */
messageRoutes.get("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const contactId = c.req.query("contactId");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const before = c.req.query("before"); // Message ID for cursor pagination

  if (!contactId) {
    return c.json({ error: "contactId is required" }, 400);
  }

  let query = tenantDb
    .selectFrom("messages")
    .selectAll()
    .where("contact_id", "=", contactId)
    .orderBy("timestamp", "desc")
    .limit(limit);

  // Cursor pagination - get messages before a specific message
  if (before) {
    const beforeMessage = await tenantDb
      .selectFrom("messages")
      .select(["timestamp"])
      .where("id", "=", before)
      .executeTakeFirst();

    if (beforeMessage) {
      query = query.where("timestamp", "<", beforeMessage.timestamp);
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

  // Return in chronological order (oldest first for display)
  const sortedMessages = messages.reverse();

  return c.json({
    data: sortedMessages.map((msg) => ({
      id: msg.id,
      messageId: msg.message_id,
      contactId: msg.contact_id,
      fromMe: msg.from_me,
      senderJid: msg.sender_jid,
      messageType: msg.message_type,
      content: msg.content,
      mediaUrl: msg.media_url,
      mediaMimeType: msg.media_mime_type,
      mediaSize: msg.media_size,
      quotedMessage: msg.quoted_message_id
        ? quotedMessages.get(msg.quoted_message_id) || null
        : null,
      isForwarded: msg.is_forwarded,
      isStarred: msg.is_starred,
      deletedBySender: msg.deleted_by_sender,
      deletedAt: msg.deleted_at,
      sentByUserId: msg.sent_by_user_id,
      status: msg.status || "sent",
      timestamp: msg.timestamp,
      createdAt: msg.created_at,
    })),
    pagination: {
      limit,
      hasMore: messages.length === limit,
      nextCursor: messages.length > 0 ? messages[0].id : null,
    },
  });
});

/**
 * POST /messages - Send a new message
 */
messageRoutes.post("/", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const body = await c.req.json();

  const { contactId, content, messageType = "text", mediaUrl } = body;

  if (!contactId) {
    return c.json({ error: "contactId is required" }, 400);
  }

  if (!content && messageType === "text") {
    return c.json({ error: "content is required for text messages" }, 400);
  }

  // Get contact JID
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Contact not found or has no JID" }, 404);
  }

  // Create a pending message in database
  const messageId = crypto.randomUUID();
  const waMessageId = `pending_${messageId}`;

  await tenantDb
    .insertInto("messages")
    .values({
      id: messageId,
      contact_id: contactId,
      message_id: waMessageId,
      from_me: true,
      sender_jid: null, // Will be updated when sent
      message_type: messageType,
      content,
      media_url: mediaUrl || null,
      sent_by_user_id: user.id,
      status: "pending",
      timestamp: new Date(),
    })
    .execute();

  // Publish send command to NATS
  await publishSendMessage(
    companyId,
    contact.jid,
    content,
    messageType,
    user.id,
    mediaUrl,
  );

  return c.json({
    success: true,
    message: {
      id: messageId,
      messageId: waMessageId,
      contactId,
      fromMe: true,
      messageType,
      content,
      mediaUrl,
      timestamp: new Date().toISOString(),
      status: "pending",
    },
  });
});

/**
 * POST /messages/:id/star - Star a message
 */
messageRoutes.post("/:id/star", async (c) => {
  const tenantDb = c.get("tenantDb");
  const messageId = c.req.param("id");

  const updated = await tenantDb
    .updateTable("messages")
    .set({ is_starred: true })
    .where("id", "=", messageId)
    .returning(["id", "is_starred"])
    .executeTakeFirst();

  if (!updated) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ success: true, isStarred: true });
});

/**
 * DELETE /messages/:id/star - Unstar a message
 */
messageRoutes.delete("/:id/star", async (c) => {
  const tenantDb = c.get("tenantDb");
  const messageId = c.req.param("id");

  const updated = await tenantDb
    .updateTable("messages")
    .set({ is_starred: false })
    .where("id", "=", messageId)
    .returning(["id", "is_starred"])
    .executeTakeFirst();

  if (!updated) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ success: true, isStarred: false });
});

/**
 * POST /messages/:id/reaction - Add a reaction to a message
 */
messageRoutes.post("/:id/reaction", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const messageId = c.req.param("id");
  const body = await c.req.json();

  const { emoji } = body;

  if (!emoji) {
    return c.json({ error: "emoji is required" }, 400);
  }

  // Check message exists
  const message = await tenantDb
    .selectFrom("messages")
    .select(["id"])
    .where("id", "=", messageId)
    .executeTakeFirst();

  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  // Upsert reaction
  await tenantDb
    .insertInto("message_reactions")
    .values({
      message_id: messageId,
      reactor_jid: user.id, // Using user ID as reactor
      emoji,
    })
    .execute();

  return c.json({ success: true, emoji });
});

/**
 * DELETE /messages/:id/reaction - Remove a reaction from a message
 */
messageRoutes.delete("/:id/reaction", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const messageId = c.req.param("id");

  await tenantDb
    .deleteFrom("message_reactions")
    .where("message_id", "=", messageId)
    .where("reactor_jid", "=", user.id)
    .execute();

  return c.json({ success: true });
});

/**
 * POST /messages/:id/forward - Forward a message to another contact
 */
messageRoutes.post("/:id/forward", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const companyId = c.get("companyId");
  const messageId = c.req.param("id");
  const body = await c.req.json();

  const { targetContactId } = body;

  if (!targetContactId) {
    return c.json({ error: "targetContactId is required" }, 400);
  }

  // Get original message
  const originalMessage = await tenantDb
    .selectFrom("messages")
    .selectAll()
    .where("id", "=", messageId)
    .executeTakeFirst();

  if (!originalMessage) {
    return c.json({ error: "Message not found" }, 404);
  }

  // Get target contact
  const targetContact = await tenantDb
    .selectFrom("contacts")
    .select(["id", "jid"])
    .where("id", "=", targetContactId)
    .executeTakeFirst();

  if (!targetContact || !targetContact.jid) {
    return c.json({ error: "Target contact not found or has no JID" }, 404);
  }

  // Create forwarded message
  const newMessageId = crypto.randomUUID();
  const waMessageId = `pending_${newMessageId}`;

  await tenantDb
    .insertInto("messages")
    .values({
      id: newMessageId,
      contact_id: targetContactId,
      message_id: waMessageId,
      from_me: true,
      sender_jid: null,
      message_type: originalMessage.message_type,
      content: originalMessage.content,
      media_url: originalMessage.media_url,
      is_forwarded: true,
      sent_by_user_id: user.id,
      status: "pending",
      timestamp: new Date(),
    })
    .execute();

  // Publish send command
  await publishSendMessage(
    companyId,
    targetContact.jid,
    originalMessage.content || "",
    originalMessage.message_type,
    user.id,
    originalMessage.media_url || undefined,
  );

  return c.json({
    success: true,
    message: {
      id: newMessageId,
      contactId: targetContactId,
      isForwarded: true,
    },
  });
});

/**
 * GET /messages/starred - Get all starred messages
 */
messageRoutes.get("/starred", async (c) => {
  const tenantDb = c.get("tenantDb");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const messages = await tenantDb
    .selectFrom("messages")
    .innerJoin("contacts", "contacts.id", "messages.contact_id")
    .select([
      "messages.id",
      "messages.message_id",
      "messages.contact_id",
      "messages.from_me",
      "messages.message_type",
      "messages.content",
      "messages.timestamp",
      "contacts.push_name",
      "contacts.custom_name",
      "contacts.phone_number",
    ])
    .where("messages.is_starred", "=", true)
    .orderBy("messages.timestamp", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return c.json({
    data: messages.map((msg) => ({
      id: msg.id,
      messageId: msg.message_id,
      contactId: msg.contact_id,
      contactName: msg.custom_name || msg.push_name || msg.phone_number,
      fromMe: msg.from_me,
      messageType: msg.message_type,
      content: msg.content,
      timestamp: msg.timestamp,
    })),
    pagination: {
      limit,
      offset,
      hasMore: messages.length === limit,
    },
  });
});
