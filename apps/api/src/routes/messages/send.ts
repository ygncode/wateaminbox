/**
 * Message Send Routes
 *
 * Routes for sending, forwarding, and retrying messages.
 */

import { zValidator } from "@hono/zod-validator";
import { toDbDate } from "@wateaminbox/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { sql } from "kysely";
import type { z } from "zod";
import { shadowLinkedDeviceLegacyMutation } from "../../channel-spine/providers/whatsapp-linked-device/shadow.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { buildOutboundMediaColumns } from "../../lib/message-formatters.js";
import { isConfirmedQuote } from "../../lib/message-quote.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
  MEDIA_MESSAGE_TYPES,
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
import { insertNeutralOutboundSend } from "../../services/channel-outbound.service.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../../services/channel-spine-authority.service.js";
import { isChannelSpineTenantReady } from "../../services/channel-spine-readiness.service.js";
import {
  conversationIdForContact,
  resolveWorkflowContactId,
} from "../../services/channel-workflow.service.js";
import { enqueueCommand } from "../../services/command-outbox.service.js";
import { validateGroupMentionJids } from "../../services/group-mention.service.js";
import { reserveMediaReferences } from "../../services/media-reference-lock.js";
import { broadcastNewMessageToViewers } from "../../services/message-broadcast.service.js";
import {
  requireConversationSendAccess,
  requireSendAccess,
} from "../../services/send-access.service.js";
import { getActiveSessionId } from "../../services/whatsapp/session.js";
import {
  IncompleteForwardAlbumError,
  planForwardBatch,
} from "./forward-batch.js";

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

type SendMessageBody = z.infer<typeof sendMessageSchema>;

async function sendChannelContactMessage(
  c: Context,
  contact: { id: string },
  body: SendMessageBody,
  mentionedJids?: string[],
) {
  const { tenantDb, user, companyId } = getRouteContext(c);
  const conversationId = await conversationIdForContact(tenantDb, contact.id);
  if (!conversationId) return notFound(c, "Contact or JID");
  const conversation = await tenantDb
    .selectFrom("conversations")
    .select("channel_account_id")
    .where("id", "=", conversationId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!conversation) return notFound(c, "Conversation");
  const storedMediaReference = body.mediaUrl
    ? getPrivateMediaReference(
        resolveMediaKeyForCompany(body.mediaUrl, companyId),
      )
    : null;
  let autoAssigned = false;
  let messageId = "";
  await tenantDb.transaction().execute(async (trx) => {
    await reserveMediaReferences(trx, companyId, [storedMediaReference]);
    const access = await requireConversationSendAccess(
      trx,
      conversationId,
      user.id,
    );
    autoAssigned = access.autoAssigned;
    let replyToExternalMessageId: string | null = null;
    if (body.replyToMessageId) {
      const quoted = await trx
        .selectFrom("messages")
        .select("external_message_id")
        .where("id", "=", body.replyToMessageId)
        .where("conversation_id", "=", conversationId)
        .executeTakeFirst();
      if (!quoted) throw new Error("quoted_missing");
      replyToExternalMessageId = quoted.external_message_id;
    }
    const inserted = await insertNeutralOutboundSend(trx, {
      companyId,
      actorUserId: user.id,
      contactId: contact.id,
      conversationId,
      channelAccountId: conversation.channel_account_id,
      content: body.content ?? "",
      messageType: body.messageType,
      mediaUrl: storedMediaReference,
      caseId: access.caseId,
      replyToMessageId: body.replyToMessageId,
      replyToExternalMessageId,
      mediaAlbum: body.mediaAlbum ?? null,
      mentionedJids: mentionedJids ?? null,
      idempotencyKey: crypto.randomUUID(),
    });
    messageId = inserted.messageId;
  });
  if (autoAssigned) {
    await broadcastAutoAssignment(tenantDb, companyId, contact.id, user.id);
  }
  const senderProfile = await toAuthUserResponse(user);
  const createdAt = toDbDate();
  return c.json({
    success: true,
    message: {
      id: messageId,
      conversationId: contact.id,
      contactId: contact.id,
      senderId: user.id,
      senderType: "user",
      sentByUserId: user.id,
      sentByUserName: user.name || user.email.split("@")[0],
      sentByUserAvatarUrl: senderProfile.avatarUrl,
      sentByUserGravatarUrl: senderProfile.gravatarUrl,
      messageType: body.messageType,
      content: body.content || "",
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    },
    autoAssigned,
  });
}

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

    // Media types require a media object; text must not carry one. The
    // explicit allow-list (not `!== "text"`) keeps the non-media
    // location/contact/reaction types from being misclassified as media
    // — the send schema uses the full messageType enum.
    if (MEDIA_MESSAGE_TYPES.includes(body.messageType) && !body.mediaUrl) {
      return badRequest(c, "mediaUrl is required for media messages");
    }
    if (body.messageType === "text" && body.mediaUrl) {
      return badRequest(c, "mediaUrl is not allowed for text messages");
    }

    const contactId =
      (await resolveWorkflowContactId(tenantDb, body.contactId)) ??
      body.contactId;
    // Get contact JID and connection ID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "is_group", "whatsapp_connection_id"])
      .where("id", "=", contactId)
      .executeTakeFirst();

    if (!contact) {
      return notFound(c, "Contact");
    }
    if (!contact.jid || !contact.whatsapp_connection_id) {
      return sendChannelContactMessage(c, contact, body);
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

    if (body.mentionedJids?.length && body.messageType !== "text") {
      return badRequest(c, "Mentions are currently supported in text messages");
    }
    if (
      body.mediaAlbum &&
      body.messageType !== "image" &&
      body.messageType !== "video"
    ) {
      return badRequest(c, "Albums support only image and video messages");
    }
    if (body.mediaAlbum && !body.mediaUrl) {
      return badRequest(c, "Album items require mediaUrl");
    }
    if (
      body.mediaAlbum &&
      ((body.messageType === "image" && body.mediaAlbum.imageCount === 0) ||
        (body.messageType === "video" && body.mediaAlbum.videoCount === 0))
    ) {
      return badRequest(c, "Album media type does not match its item counts");
    }
    const mentionValidation = await validateGroupMentionJids(
      tenantDb,
      { id: contact.id, jid: contact.jid, isGroup: contact.is_group },
      body.content ?? "",
      body.mentionedJids,
    );
    if (mentionValidation.error) {
      return badRequest(c, mentionValidation.error);
    }

    // Look up the WhatsApp message ID and sender for reply-to if provided
    let quotedWaMessageId: string | undefined;
    let quotedSenderJid: string | undefined;
    if (body.replyToMessageId) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["message_id", "sender_jid", "from_me", "status"])
        .where("id", "=", body.replyToMessageId)
        .where("contact_id", "=", contact.id)
        .where("whatsapp_connection_id", "=", connection.id)
        .executeTakeFirst();
      if (!quotedMessage) return notFound(c, "Quoted message");
      if (!isConfirmedQuote(quotedMessage)) {
        return badRequest(
          c,
          "Wait for the quoted message to be confirmed before replying",
        );
      }
      quotedWaMessageId = quotedMessage?.message_id || undefined;

      if (quotedMessage?.from_me) {
        quotedSenderJid = connection.jid || undefined;
      } else {
        quotedSenderJid = quotedMessage?.sender_jid || contact.jid;
      }
    }

    // Every check above still runs: the connection is live, mentions name
    // real participants, the album is coherent, the quote is confirmed. Only
    // the write differs, so enabling the provider cannot change what this
    // route accepts - just which path records and dispatches it.
    const spineAuthorityForSend =
      await getChannelSpineWorkspaceAuthority(companyId);
    if (
      spineAuthorityForSend.writeAuthority === "neutral" &&
      isChannelProviderEnabled(
        spineAuthorityForSend,
        "whatsapp_linked_device",
      ) &&
      (await isChannelSpineTenantReady(tenantDb, companyId))
    ) {
      return sendChannelContactMessage(
        c,
        contact,
        body,
        mentionValidation.mentionedJids,
      );
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
      mentionValidation.mentionedJids,
      body.mediaAlbum,
    );

    const storedMediaReference = body.mediaUrl
      ? getPrivateMediaReference(
          resolveMediaKeyForCompany(body.mediaUrl, companyId),
        )
      : null;
    const spineAuthority = await getChannelSpineWorkspaceAuthority(companyId);
    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      await reserveMediaReferences(trx, companyId, [storedMediaReference]);
      const result = await requireSendAccess(trx, contact.id, user.id);
      autoAssigned = result.autoAssigned;
      await trx
        .insertInto("messages")
        .values({
          id: messageId,
          whatsapp_connection_id: connection.id,
          contact_id: contact.id,
          message_id: waMessageId,
          from_me: true,
          sender_jid: connection.jid,
          message_type: body.messageType,
          content: body.content,
          media_url: storedMediaReference,
          ...buildOutboundMediaColumns(sendCommand),
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
      if (spineAuthority.dualWriteEnabled) {
        await shadowLinkedDeviceLegacyMutation(
          trx,
          companyId,
          contact.id,
          messageId,
        );
      }
    });
    if (autoAssigned) {
      await broadcastAutoAssignment(tenantDb, companyId, contact.id, user.id);
    }

    const senderProfile = await toAuthUserResponse(user);
    const formattedMessage = {
      id: messageId,
      messageId: waMessageId,
      whatsappMessageId: waMessageId,
      conversationId: contact.id,
      contactId: contact.id,
      senderId: user.id,
      senderType: "user" as const,
      sentByUserId: user.id,
      sentByUserName: user.name || user.email.split("@")[0],
      sentByUserAvatarUrl: senderProfile.avatarUrl,
      sentByUserGravatarUrl: senderProfile.gravatarUrl,
      messageType: body.messageType,
      content: body.content || "",
      metadata: body.mediaUrl
        ? {
            mediaUrl: body.mediaUrl,
            mediaAlbumId: body.mediaAlbum?.id,
            mediaAlbumIndex: body.mediaAlbum?.index,
            mediaAlbumCount: body.mediaAlbum?.count,
          }
        : undefined,
      replyToMessageId: body.replyToMessageId || undefined,
      status: "pending" as const,
      createdAt,
      updatedAt: createdAt,
    };

    await broadcastNewMessageToViewers(
      companyId,
      contact.id,
      {
        message: {
          ...formattedMessage,
          metadata: body.mediaUrl
            ? {
                mediaAvailable: true,
                mediaAlbumId: body.mediaAlbum?.id,
                mediaAlbumIndex: body.mediaAlbum?.index,
                mediaAlbumCount: body.mediaAlbum?.count,
              }
            : undefined,
        },
        conversationId: contact.id,
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
          .select(["id", "jid"])
          .where("id", "=", targetContact.whatsapp_connection_id)
          .where("status", "=", "connected")
          .executeTakeFirst()
      : null;

    if (!connection) {
      return badRequest(c, "The contact's WhatsApp connection is not active");
    }

    const sourceAlbumId =
      originalMessage.message_type === "image" ||
      originalMessage.message_type === "video"
        ? originalMessage.metadata?.mediaAlbumId
        : undefined;
    const albumCandidates =
      typeof sourceAlbumId === "string" && sourceAlbumId.trim().length > 0
        ? await tenantDb
            .selectFrom("messages")
            .selectAll()
            .where("contact_id", "=", originalMessage.contact_id)
            .where(
              sql<boolean>`metadata ->> 'mediaAlbumId' = ${sourceAlbumId.trim()}`,
            )
            .execute()
        : [originalMessage];

    let forwardBatch;
    try {
      forwardBatch = planForwardBatch(originalMessage, albumCandidates);
    } catch (error) {
      if (error instanceof IncompleteForwardAlbumError) {
        return badRequest(c, error.message);
      }
      throw error;
    }

    const sessionId = await getActiveSessionId(tenantDb, connection.id);
    const pendingMessages = await Promise.all(
      forwardBatch.map(async ({ source, mediaAlbum }) => {
        const id = crypto.randomUUID();
        const waMessageId = `pending_${id}`;
        const sendCommand = await buildSendMessageCommand(
          companyId,
          sessionId,
          targetContact.jid!,
          source.content || "",
          source.message_type,
          user.id,
          waMessageId,
          source.media_url || undefined,
          undefined,
          undefined,
          undefined,
          mediaAlbum,
        );
        return { id, waMessageId, source, sendCommand };
      }),
    );

    const spineAuthority = await getChannelSpineWorkspaceAuthority(companyId);
    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      // Forwarded copies reuse the source messages' objects. Reserve the full
      // collection before inserting any row so the batch is all-or-nothing.
      await reserveMediaReferences(
        trx,
        companyId,
        pendingMessages.map(({ source }) => source.media_url),
      );
      const result = await requireSendAccess(
        trx,
        body.targetContactId,
        user.id,
      );
      autoAssigned = result.autoAssigned;
      for (const pending of pendingMessages) {
        await trx
          .insertInto("messages")
          .values({
            id: pending.id,
            whatsapp_connection_id: connection.id,
            contact_id: body.targetContactId,
            message_id: pending.waMessageId,
            from_me: true,
            sender_jid: connection.jid,
            message_type: pending.source.message_type,
            content: pending.source.content,
            media_url: pending.source.media_url,
            ...buildOutboundMediaColumns(pending.sendCommand),
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
          pending.sendCommand,
        );
        if (spineAuthority.dualWriteEnabled) {
          await shadowLinkedDeviceLegacyMutation(
            trx,
            companyId,
            body.targetContactId,
            pending.id,
          );
        }
      }
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
      forwardedMessageId: pendingMessages[0]!.id,
      forwardedMessageIds: pendingMessages.map(({ id }) => id),
      forwardedCount: pendingMessages.length,
      message: {
        id: pendingMessages[0]!.id,
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

    const spineAuthority = await getChannelSpineWorkspaceAuthority(companyId);
    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      // The retry copy reuses the failed message's object.
      await reserveMediaReferences(trx, companyId, [originalMessage.media_url]);
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
          ...buildOutboundMediaColumns(sendCommand),
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
      if (spineAuthority.dualWriteEnabled) {
        await shadowLinkedDeviceLegacyMutation(
          trx,
          companyId,
          contact.id,
          newMessageId,
        );
      }
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
