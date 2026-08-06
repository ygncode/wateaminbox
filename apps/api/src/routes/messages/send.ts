/**
 * Message Send Routes
 *
 * Routes for sending, forwarding, and retrying messages.
 */

import { zValidator } from "@hono/zod-validator";
import { toDbDate } from "@wateaminbox/shared";
import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../../lib/nats/index.js";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import {
  forwardMessageSchema,
  sendMessageSchema,
} from "../../lib/schemas/index.js";
import {
  getAuthorizedMediaUrlOrNull,
  getPrivateMediaReference,
  resolveMediaKeyForCompany,
} from "../../lib/storage.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import { requireMessageVisibility } from "../../middleware/resource-visibility.js";
import { broadcastAutoAssignment } from "../../services/assignment-broadcast.service.js";
import { toAuthUserResponse } from "../../services/auth.service.js";
import { enqueueCommand } from "../../services/command-outbox.service.js";
import { broadcastNewMessageToViewers } from "../../services/message-broadcast.service.js";
import { requireSendAccess } from "../../services/send-access.service.js";
import { getActiveSessionId } from "../../services/whatsapp/session.js";

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
  requireMessageSendPermission,
  messageSendRateLimiter,
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

    // Send through the connection that owns this contact. Picking an arbitrary
    // connected account routes multi-account chats through the wrong worker.
    const connection = contact.whatsapp_connection_id
      ? await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["id", "jid"])
          .where("id", "=", contact.whatsapp_connection_id)
          .where("status", "=", "connected")
          .executeTakeFirst()
      : null;

    if (!connection) {
      return badRequest(c, "The contact's WhatsApp connection is not active");
    }

    // Look up the WhatsApp message ID and sender for reply-to if provided
    let quotedWaMessageId: string | undefined;
    let quotedSenderJid: string | undefined;
    if (body.replyToMessageId) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["message_id", "sender_jid", "from_me"])
        .where("id", "=", body.replyToMessageId)
        .where("contact_id", "=", body.contactId)
        .where("whatsapp_connection_id", "=", connection.id)
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
    const createdAt = toDbDate();
    const sessionId = await getActiveSessionId(tenantDb, connection.id);

    const sendCommand = await buildSendMessageCommand(
      companyId,
      sessionId,
      contact.jid,
      body.content || "",
      body.messageType,
      user.id,
      waMessageId,
      body.mediaUrl,
      quotedWaMessageId,
      quotedSenderJid,
    );

    const storedMediaReference = body.mediaUrl
      ? getPrivateMediaReference(
          resolveMediaKeyForCompany(body.mediaUrl, companyId),
        )
      : null;
    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      const result = await requireSendAccess(trx, body.contactId, user.id);
      autoAssigned = result.autoAssigned;
      await trx
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
          media_url: storedMediaReference,
          quoted_message_id: quotedWaMessageId || null,
          sent_by_user_id: user.id,
          status: "pending",
          timestamp: createdAt,
          created_at: createdAt,
          case_id: result.caseId,
        })
        .execute();
      await enqueueCommand(
        trx,
        buildCommandSubject(companyId, sessionId),
        sendCommand,
      );
    });
    if (autoAssigned) {
      await broadcastAutoAssignment(
        tenantDb,
        companyId,
        body.contactId,
        user.id,
      );
    }

    const senderProfile = await toAuthUserResponse(user);
    const formattedMessage = {
      id: messageId,
      messageId: waMessageId,
      whatsappMessageId: waMessageId,
      conversationId: body.contactId,
      contactId: body.contactId,
      senderId: user.id,
      senderType: "user" as const,
      sentByUserId: user.id,
      sentByUserName: user.name || user.email.split("@")[0],
      sentByUserAvatarUrl: senderProfile.avatarUrl,
      sentByUserGravatarUrl: senderProfile.gravatarUrl,
      messageType: body.messageType,
      content: body.content || "",
      metadata: body.mediaUrl ? { mediaUrl: body.mediaUrl } : undefined,
      replyToMessageId: body.replyToMessageId || undefined,
      status: "pending" as const,
      createdAt,
      updatedAt: createdAt,
    };

    await broadcastNewMessageToViewers(
      companyId,
      body.contactId,
      {
        message: {
          ...formattedMessage,
          metadata: body.mediaUrl ? { mediaAvailable: true } : undefined,
        },
        conversationId: body.contactId,
      },
      connection.id,
    );

    return c.json({
      success: true,
      message: formattedMessage,
      autoAssigned,
    });
  },
);

/**
 * POST /:id/forward - Forward a message to another contact
 * Requires can_send_messages permission
 */
sendRoutes.post(
  "/:id/forward",
  requireMessageSendPermission,
  requireMessageVisibility(),
  messageSendRateLimiter,
  zValidator("json", forwardMessageSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const messageId = c.req.param("id")!;
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
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", body.targetContactId)
      .executeTakeFirst();

    if (!targetContact || !targetContact.jid) {
      return notFound(c, "Target contact or JID");
    }

    const connection = targetContact.whatsapp_connection_id
      ? await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["id"])
          .where("id", "=", targetContact.whatsapp_connection_id)
          .where("status", "=", "connected")
          .executeTakeFirst()
      : null;

    if (!connection) {
      return badRequest(c, "The contact's WhatsApp connection is not active");
    }

    // Create forwarded message
    const newMessageId = crypto.randomUUID();
    const waMessageId = `pending_${newMessageId}`;
    const sessionId = await getActiveSessionId(tenantDb, connection.id);

    const sendCommand = await buildSendMessageCommand(
      companyId,
      sessionId,
      targetContact.jid,
      originalMessage.content || "",
      originalMessage.message_type,
      user.id,
      waMessageId,
      originalMessage.media_url || undefined,
    );

    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      const result = await requireSendAccess(
        trx,
        body.targetContactId,
        user.id,
      );
      autoAssigned = result.autoAssigned;
      await trx
        .insertInto("messages")
        .values({
          id: newMessageId,
          whatsapp_connection_id: connection.id,
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
          case_id: result.caseId,
        })
        .execute();
      await enqueueCommand(
        trx,
        buildCommandSubject(companyId, sessionId),
        sendCommand,
      );
    });
    if (autoAssigned) {
      await broadcastAutoAssignment(
        tenantDb,
        companyId,
        body.targetContactId,
        user.id,
      );
    }

    return c.json({
      success: true,
      message: {
        id: newMessageId,
        contactId: body.targetContactId,
        isForwarded: true,
      },
      autoAssigned,
    });
  },
);

/**
 * POST /:id/retry - Retry a failed message
 * Requires can_send_messages permission
 */
sendRoutes.post(
  "/:id/retry",
  requireMessageSendPermission,
  requireMessageVisibility(),
  messageSendRateLimiter,
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const messageId = c.req.param("id")!;

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
      .select(["id", "jid", "whatsapp_connection_id"])
      .where("id", "=", originalMessage.contact_id)
      .executeTakeFirst();

    if (!contact || !contact.jid) {
      return notFound(c, "Contact or JID");
    }

    const connection = contact.whatsapp_connection_id
      ? await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["id", "jid"])
          .where("id", "=", contact.whatsapp_connection_id)
          .where("status", "=", "connected")
          .executeTakeFirst()
      : null;

    if (!connection) {
      return badRequest(c, "The contact's WhatsApp connection is not active");
    }

    // Create a new message entry for the retry
    const newMessageId = crypto.randomUUID();
    const waMessageId = `pending_${newMessageId}`;
    const sessionId = await getActiveSessionId(tenantDb, connection.id);

    // Look up the sender JID for reply context
    let quotedSenderJid: string | undefined;
    if (originalMessage.quoted_message_id) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["from_me", "sender_jid"])
        .where("message_id", "=", originalMessage.quoted_message_id)
        .where("whatsapp_connection_id", "=", connection.id)
        .executeTakeFirst();
      if (quotedMessage?.from_me) {
        quotedSenderJid = connection.jid || undefined;
      } else {
        quotedSenderJid = quotedMessage?.sender_jid || contact.jid;
      }
    }

    const sendCommand = await buildSendMessageCommand(
      companyId,
      sessionId,
      contact.jid,
      originalMessage.content || "",
      originalMessage.message_type,
      user.id,
      waMessageId,
      originalMessage.media_url || undefined,
      originalMessage.quoted_message_id || undefined,
      quotedSenderJid,
    );

    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      const result = await requireSendAccess(trx, contact.id, user.id);
      autoAssigned = result.autoAssigned;
      await trx
        .insertInto("messages")
        .values({
          id: newMessageId,
          whatsapp_connection_id: connection.id,
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
          case_id: result.caseId,
        })
        .execute();
      await enqueueCommand(
        trx,
        buildCommandSubject(companyId, sessionId),
        sendCommand,
      );
    });
    if (autoAssigned) {
      await broadcastAutoAssignment(tenantDb, companyId, contact.id, user.id);
    }

    const [senderProfile, authorizedMediaUrl] = await Promise.all([
      toAuthUserResponse(user),
      getAuthorizedMediaUrlOrNull(originalMessage.media_url, companyId),
    ]);
    return c.json({
      success: true,
      message: {
        id: newMessageId,
        messageId: waMessageId,
        conversationId: originalMessage.contact_id,
        contactId: originalMessage.contact_id,
        senderId: user.id,
        senderType: "user",
        sentByUserId: user.id,
        sentByUserName: user.name || user.email.split("@")[0],
        sentByUserAvatarUrl: senderProfile.avatarUrl,
        sentByUserGravatarUrl: senderProfile.gravatarUrl,
        messageType: originalMessage.message_type,
        content: originalMessage.content || "",
        metadata: authorizedMediaUrl
          ? { mediaUrl: authorizedMediaUrl }
          : undefined,
        status: "pending",
        createdAt: toDbDate(),
        updatedAt: toDbDate(),
      },
      originalMessageId: messageId,
      autoAssigned,
    });
  },
);
