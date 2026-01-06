import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requirePermission } from "../middleware/tenant.js";
import { PERMISSIONS } from "../services/permission.service.js";
import { publishSendMessage, publishSendReaction } from "../lib/nats.js";
import { ensureContactAssignment } from "../services/contact.service.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("MessageRoutes");

export const messageRoutes = new Hono();

// All message routes require authentication and tenant context
messageRoutes.use("/*", authMiddleware);
messageRoutes.use("/*", tenantMiddleware());

// Message send rate limiter: 60 requests per minute per user
// Prevents message spam while allowing reasonable burst usage
const messageSendRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.messaging.send,
      keyStrategy: "user",
      keyPrefix: "messaging-send",
    })
  : async (_c, next) => await next();

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

  // Get reactions for all messages
  const messageIds = messages.map((m) => m.id);
  let reactionsMap: Map<
    string,
    Array<{ emoji: string; reactorJid: string; createdAt: Date }>
  > = new Map();
  if (messageIds.length > 0) {
    const reactions = await tenantDb
      .selectFrom("message_reactions")
      .select(["message_id", "emoji", "reactor_jid", "created_at"])
      .where("message_id", "in", messageIds)
      .orderBy("created_at", "asc")
      .execute();

    // Group reactions by message ID
    for (const reaction of reactions) {
      const existing = reactionsMap.get(reaction.message_id) || [];
      existing.push({
        emoji: reaction.emoji,
        reactorJid: reaction.reactor_jid,
        createdAt: reaction.created_at,
      });
      reactionsMap.set(reaction.message_id, existing);
    }
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
      reactions: reactionsMap.get(msg.id) || [],
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
 * Requires can_send_messages permission
 */
messageRoutes.post(
  "/",
  messageSendRateLimiter,
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  async (c) => {
    const tenantDb = c.get("tenantDb");
    const user = c.get("user");
    const companyId = c.get("companyId");
    const body = await c.req.json();

    const {
      contactId,
      content,
      messageType = "text",
      mediaUrl,
      replyToMessageId,
    } = body;

    if (!contactId) {
      return c.json({ error: "contactId is required" }, 400);
    }

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

    // Auto-assign contact to the user if unassigned ("Assign to me on first reply")
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

      // For reply context, we need the sender's JID
      if (quotedMessage?.from_me) {
        // If replying to our own message, use our JID from the connection
        quotedSenderJid = connection.jid || undefined;
      } else {
        // If replying to their message, use their sender_jid
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
        whatsapp_connection_id: connection.id,
        contact_id: contactId,
        message_id: waMessageId,
        from_me: true,
        sender_jid: connection.jid, // Set sender JID from connection
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
      waMessageId,
      mediaUrl,
      quotedWaMessageId,
      quotedSenderJid,
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
        replyToMessageId: replyToMessageId || null,
        timestamp: new Date().toISOString(),
        status: "pending",
      },
      autoAssigned: wasAutoAssigned,
    });
  },
);

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
 * DELETE /messages/:id - Soft delete a message
 */
messageRoutes.delete("/:id", async (c) => {
  const tenantDb = c.get("tenantDb");
  const messageId = c.req.param("id");

  const updated = await tenantDb
    .updateTable("messages")
    .set({ deleted_at: new Date() })
    .where("id", "=", messageId)
    .returning(["id", "deleted_at"])
    .executeTakeFirst();

  if (!updated) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({
    success: true,
    message: { id: updated.id, deletedAt: updated.deleted_at },
  });
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

  // Check message exists and get WhatsApp message_id, from_me, and contact ID
  const message = await tenantDb
    .selectFrom("messages")
    .select(["id", "contact_id", "message_id", "from_me"])
    .where("id", "=", messageId)
    .executeTakeFirst();

  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  if (!message.contact_id) {
    return c.json({ error: "Message has no associated contact" }, 400);
  }

  if (!message.message_id) {
    return c.json({ error: "Message has no WhatsApp message ID" }, 400);
  }

  // Get contact to determine chat JID
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["jid"])
    .where("id", "=", message.contact_id)
    .executeTakeFirst();

  if (!contact || !contact.jid) {
    return c.json({ error: "Contact not found or has no JID" }, 404);
  }

  // Get active WhatsApp connection
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection) {
    return c.json({ error: "No active WhatsApp connection" }, 400);
  }

  // Upsert reaction in database
  await tenantDb
    .insertInto("message_reactions")
    .values({
      message_id: messageId,
      reactor_jid: user.id, // Using user ID as reactor
      emoji,
    })
    .execute();

  // Send reaction to WhatsApp via NATS
  const companyId = c.get("companyId");
  try {
    await publishSendReaction(
      companyId,
      connection.id,
      contact.jid,
      message.message_id, // Use WhatsApp message_id
      emoji,
      user.id,
      message.from_me, // Pass from_me flag
    );
  } catch (error) {
    logger.error({ err: formatError(error) }, "Failed to send reaction to WhatsApp");
    // Don't fail the request - the reaction is stored in DB
  }

  return c.json({ success: true, emoji });
});

/**
 * DELETE /messages/:id/reaction - Remove a reaction from a message
 */
messageRoutes.delete("/:id/reaction", async (c) => {
  const tenantDb = c.get("tenantDb");
  const user = c.get("user");
  const messageId = c.req.param("id");

  // Get message with WhatsApp message_id, from_me, and contact info
  const message = await tenantDb
    .selectFrom("messages")
    .select(["id", "contact_id", "message_id", "from_me"])
    .where("id", "=", messageId)
    .executeTakeFirst();

  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  // Delete reaction from database
  await tenantDb
    .deleteFrom("message_reactions")
    .where("message_id", "=", messageId)
    .where("reactor_jid", "=", user.id)
    .execute();

  // Send empty emoji to WhatsApp to remove reaction (if we have contact info)
  if (message.contact_id && message.message_id) {
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["jid"])
      .where("id", "=", message.contact_id)
      .executeTakeFirst();

    if (contact?.jid) {
      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "status"])
        .where("status", "=", "connected")
        .executeTakeFirst();

      if (connection) {
        const companyId = c.get("companyId");
        try {
          await publishSendReaction(
            companyId,
            connection.id,
            contact.jid,
            message.message_id, // Use WhatsApp message_id
            "", // Empty emoji removes the reaction
            user.id,
            message.from_me, // Pass from_me flag
          );
        } catch (error) {
          logger.error({ err: formatError(error) }, "Failed to remove reaction from WhatsApp");
          // Don't fail the request - the reaction is removed from DB
        }
      }
    }
  }

  return c.json({ success: true });
});

/**
 * POST /messages/:id/forward - Forward a message to another contact
 * Requires can_send_messages permission
 */
messageRoutes.post(
  "/:id/forward",
  messageSendRateLimiter,
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  async (c) => {
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

    // Get active WhatsApp connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      return c.json({ error: "No active WhatsApp connection" }, 400);
    }

    // Auto-assign target contact to the user if unassigned ("Assign to me on first reply")
    const wasAutoAssigned = await ensureContactAssignment(
      tenantDb,
      targetContactId,
      user.id,
    );

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
      connection.id,
      targetContact.jid,
      originalMessage.content || "",
      originalMessage.message_type,
      user.id,
      waMessageId,
      originalMessage.media_url || undefined,
      undefined, // replyTo - forwards don't have reply context
      undefined, // replyToSender - forwards don't have reply context
    );

    return c.json({
      success: true,
      message: {
        id: newMessageId,
        contactId: targetContactId,
        isForwarded: true,
      },
      autoAssigned: wasAutoAssigned,
    });
  },
);

/**
 * POST /messages/:id/retry - Retry a failed message
 * Requires can_send_messages permission
 */
messageRoutes.post(
  "/:id/retry",
  messageSendRateLimiter,
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  async (c) => {
    const tenantDb = c.get("tenantDb");
    const user = c.get("user");
    const companyId = c.get("companyId");
    const messageId = c.req.param("id");

    // Get the original failed message
    const originalMessage = await tenantDb
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirst();

    if (!originalMessage) {
      return c.json({ error: "Message not found" }, 404);
    }

    // Verify this is a user's failed message
    if (!originalMessage.from_me) {
      return c.json({ error: "Can only retry sent messages" }, 400);
    }

    if (originalMessage.status !== "failed") {
      return c.json({ error: "Can only retry failed messages" }, 400);
    }

    // Get contact JID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid"])
      .where("id", "=", originalMessage.contact_id)
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

    // Create a new message entry for the retry
    const newMessageId = crypto.randomUUID();
    const waMessageId = `pending_${newMessageId}`;

    await tenantDb
      .insertInto("messages")
      .values({
        id: newMessageId,
        contact_id: originalMessage.contact_id,
        message_id: waMessageId,
        from_me: true,
        sender_jid: null,
        message_type: originalMessage.message_type,
        content: originalMessage.content,
        media_url: originalMessage.media_url,
        media_mime_type: originalMessage.media_mime_type,
        quoted_message_id: originalMessage.quoted_message_id,
        sent_by_user_id: user.id,
        status: "pending",
        timestamp: new Date(),
      })
      .execute();

    // Look up the sender JID for reply context
    let quotedSenderJid: string | undefined;
    if (originalMessage.quoted_message_id) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["from_me", "sender_jid"])
        .where("message_id", "=", originalMessage.quoted_message_id)
        .executeTakeFirst();
      if (quotedMessage?.from_me) {
        quotedSenderJid = connection.jid || undefined;
      } else {
        quotedSenderJid = quotedMessage?.sender_jid || contact.jid;
      }
    }

    // Publish send command to NATS
    await publishSendMessage(
      companyId,
      connection.id,
      contact.jid,
      originalMessage.content || "",
      originalMessage.message_type,
      user.id,
      waMessageId,
      originalMessage.media_url || undefined,
      originalMessage.quoted_message_id || undefined,
      quotedSenderJid,
    );

    return c.json({
      success: true,
      message: {
        id: newMessageId,
        messageId: waMessageId,
        contactId: originalMessage.contact_id,
        fromMe: true,
        messageType: originalMessage.message_type,
        content: originalMessage.content,
        mediaUrl: originalMessage.media_url,
        status: "pending",
        timestamp: new Date().toISOString(),
      },
      originalMessageId: messageId,
    });
  },
);

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

// Batch operation limit
const BATCH_LIMIT = 50;

/**
 * POST /messages/batch/star - Star multiple messages at once
 * Body: { messageIds: string[], star: boolean }
 * Limit: 50 messages per request
 */
messageRoutes.post("/batch/star", async (c) => {
  const tenantDb = c.get("tenantDb");
  const body = await c.req.json();

  const { messageIds, star = true } = body;

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return c.json({ error: "messageIds array is required" }, 400);
  }

  if (messageIds.length > BATCH_LIMIT) {
    return c.json(
      { error: `Maximum ${BATCH_LIMIT} messages per batch request` },
      400,
    );
  }

  // Update all messages
  const result = await tenantDb
    .updateTable("messages")
    .set({ is_starred: star })
    .where("id", "in", messageIds)
    .execute();

  return c.json({
    success: true,
    updated: Number(result[0]?.numUpdatedRows || 0),
    isStarred: star,
  });
});

/**
 * POST /messages/batch/delete - Soft delete multiple messages at once
 * Body: { messageIds: string[] }
 * Limit: 50 messages per request
 */
messageRoutes.post("/batch/delete", async (c) => {
  const tenantDb = c.get("tenantDb");
  const body = await c.req.json();

  const { messageIds } = body;

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return c.json({ error: "messageIds array is required" }, 400);
  }

  if (messageIds.length > BATCH_LIMIT) {
    return c.json(
      { error: `Maximum ${BATCH_LIMIT} messages per batch request` },
      400,
    );
  }

  // Soft delete all messages
  const result = await tenantDb
    .updateTable("messages")
    .set({ deleted_at: new Date() })
    .where("id", "in", messageIds)
    .where("deleted_at", "is", null) // Don't re-delete already deleted messages
    .execute();

  return c.json({
    success: true,
    deleted: Number(result[0]?.numUpdatedRows || 0),
  });
});
