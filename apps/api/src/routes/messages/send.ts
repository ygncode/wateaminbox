/**
 * Message Send Routes
 *
 * Routes for sending, forwarding, and retrying messages.
 */
import { toDbDate, toISOString } from "@wateaminbox/shared";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { badRequest, notFound } from "../../lib/errors.js";
import { publishSendMessage } from "../../lib/nats/index.js";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import {
  sendMessageSchema,
  forwardMessageSchema,
} from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import { requirePermission } from "../../middleware/tenant.js";
import { ensureContactAssignment } from "../../services/contact.service.js";
import { PERMISSIONS } from "../../services/permission.service.js";

// Message send rate limiter: 60 requests per minute per user
const messageSendRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.messaging.send,
    keyStrategy: "user",
    keyPrefix: "messaging-send",
  },
  rateLimitConfig.enabled,
);

export const sendRoutes = new Hono();

/**
 * POST / - Send a new message
 * Requires can_send_messages permission
 */
sendRoutes.post(
  "/",
  messageSendRateLimiter,
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  zValidator("json", sendMessageSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const body = c.req.valid("json");

    if (!body.content && body.messageType === "text") {
      return badRequest(c, "content is required for text messages");
    }

    // Get contact JID and connection ID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", body.contactId)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Contact or JID");
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
      body.contactId,
      user.id,
    );

    // Look up the WhatsApp message ID and sender for reply-to if provided
    let quotedWaMessageId: string | undefined;
    let quotedSenderJid: string | undefined;
    if (body.replyToMessageId) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["message_id", "sender_jid", "from_me"])
        .where("id", "=", body.replyToMessageId)
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
        whatsapp_connection_id: connection.id,
        contact_id: body.contactId,
        message_id: waMessageId,
        from_me: true,
        sender_jid: connection.jid,
        message_type: body.messageType,
        content: body.content,
        media_url: body.mediaUrl || null,
        quoted_message_id: quotedWaMessageId || null,
        sent_by_user_id: user.id,
        status: "pending",
        timestamp: toDbDate(),
        created_at: toDbDate(),
      })
      .execute();

    // Publish send command to NATS
    await publishSendMessage(
      companyId,
      connection.id,
      contact.jid,
      body.content || "",
      body.messageType,
      user.id,
      waMessageId,
      body.mediaUrl,
      quotedWaMessageId,
      quotedSenderJid,
    );

    return c.json({
      success: true,
      message: {
        id: messageId,
        messageId: waMessageId,
        contactId: body.contactId,
        fromMe: true,
        messageType: body.messageType,
        content: body.content,
        mediaUrl: body.mediaUrl,
        replyToMessageId: body.replyToMessageId || null,
        timestamp: toISOString(),
        status: "pending",
      },
      autoAssigned: wasAutoAssigned,
    });
  },
);

/**
 * POST /:id/forward - Forward a message to another contact
 * Requires can_send_messages permission
 */
sendRoutes.post(
  "/:id/forward",
  messageSendRateLimiter,
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  zValidator("json", forwardMessageSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const messageId = c.req.param("id");
    const body = c.req.valid("json");

    // Get original message
    const originalMessage = await tenantDb
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirst();

    if (!originalMessage) {
      return notFound(c, "Message");
    }

    // Get target contact
    const targetContact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid"])
      .where("id", "=", body.targetContactId)
      .executeTakeFirst();

    if (!targetContact || !targetContact.jid) {
      return notFound(c, "Target contact or JID");
    }

    // Get active WhatsApp connection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      return badRequest(c, "No active WhatsApp connection");
    }

    // Auto-assign target contact to the user if unassigned
    const wasAutoAssigned = await ensureContactAssignment(
      tenantDb,
      body.targetContactId,
      user.id,
    );

    // Create forwarded message
    const newMessageId = crypto.randomUUID();
    const waMessageId = `pending_${newMessageId}`;

    await tenantDb
      .insertInto("messages")
      .values({
        id: newMessageId,
        contact_id: body.targetContactId,
        message_id: waMessageId,
        from_me: true,
        sender_jid: null,
        message_type: originalMessage.message_type,
        content: originalMessage.content,
        media_url: originalMessage.media_url,
        is_forwarded: true,
        sent_by_user_id: user.id,
        status: "pending",
        timestamp: toDbDate(),
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
        contactId: body.targetContactId,
        isForwarded: true,
      },
      autoAssigned: wasAutoAssigned,
    });
  },
);

/**
 * POST /:id/retry - Retry a failed message
 * Requires can_send_messages permission
 */
sendRoutes.post(
  "/:id/retry",
  messageSendRateLimiter,
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const messageId = c.req.param("id");

    // Get the original failed message
    const originalMessage = await tenantDb
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", messageId)
      .executeTakeFirst();

    if (!originalMessage) {
      return notFound(c, "Message");
    }

    // Verify this is a user's failed message
    if (!originalMessage.from_me) {
      return badRequest(c, "Can only retry sent messages");
    }

    if (originalMessage.status !== "failed") {
      return badRequest(c, "Can only retry failed messages");
    }

    // Get contact JID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid"])
      .where("id", "=", originalMessage.contact_id)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Contact or JID");
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
        timestamp: toDbDate(),
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
        timestamp: toISOString(),
      },
      originalMessageId: messageId,
    });
  },
);
