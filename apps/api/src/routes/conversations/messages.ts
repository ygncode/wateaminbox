import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  buildQuotedMessageData,
  formatMessagesForConversation,
  type MessageDbRow,
} from "../../lib/message-formatters.js";
import { loadMessageReactions } from "../../lib/message-reactions.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../../lib/nats/index.js";
import { successData, successWithMessage } from "../../lib/response.js";
import {
  listConversationMessagesQuerySchema,
  sendConversationMessageSchema,
} from "../../lib/schemas/index.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  markDeprecatedMessageSend,
  requireMessageSendPermission,
} from "../../middleware/message-send-policy.js";
import { enqueueCommand } from "../../services/command-outbox.service.js";
import { ensureContactAssignment } from "../../services/contact.service.js";
import { getUserNames } from "../../services/user.service.js";

export const messageRoutes = new Hono();

/**
 * GET /conversations/:id/messages - Get messages for a conversation/contact
 * Query params: limit, cursor (for pagination)
 */
messageRoutes.get(
  "/:id/messages",
  zValidator("query", listConversationMessagesQuerySchema),
  async (c) => {
    const { tenantDb } = getRouteContext(c);
    const contactId = c.req.param("id");
    const { limit, cursor } = c.req.valid("query");

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
    const userNames = await getUserNames(
      messages
        .map((message) => message.sent_by_user_id)
        .filter((id): id is string => Boolean(id)),
    );

    // Get quoted messages if any (for reply functionality)
    const quotedIds = messages
      .filter((m) => m.quoted_message_id)
      .map((m) => m.quoted_message_id as string);

    let quotedMessagesMap = new Map<
      string,
      ReturnType<typeof buildQuotedMessageData>
    >();
    if (quotedIds.length > 0) {
      const connectionIds = [
        ...new Set(messages.map((message) => message.whatsapp_connection_id)),
      ];
      const quoted = await tenantDb
        .selectFrom("messages")
        .selectAll()
        .where("message_id", "in", quotedIds)
        .where("whatsapp_connection_id", "in", connectionIds)
        .execute();

      const quotedUserNames = await getUserNames(
        quoted
          .map((message) => message.sent_by_user_id)
          .filter((id): id is string => Boolean(id)),
      );
      for (const [id, name] of quotedUserNames) userNames.set(id, name);

      quotedMessagesMap = new Map(
        quoted
          .filter((q) => q.message_id !== null)
          .map((q) => [
            q.message_id as string,
            buildQuotedMessageData(q as MessageDbRow, userNames),
          ]),
      );
    }

    const reactionsMap = await loadMessageReactions(
      tenantDb,
      messages as MessageDbRow[],
    );

    // Map to frontend format using shared formatter
    const formattedMessages = formatMessagesForConversation(
      messages as MessageDbRow[],
      quotedMessagesMap,
      reactionsMap,
      userNames,
    );

    return successData(c, {
      messages: formattedMessages,
      hasMore: messages.length === limit,
      nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
    });
  },
);

/**
 * POST /conversations/:id/messages - Send a new message
 * Requires can_send_messages permission
 */
messageRoutes.post(
  "/:id/messages",
  requireMessageSendPermission,
  markDeprecatedMessageSend,
  zValidator("json", sendConversationMessageSchema),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const contactId = c.req.param("id");
    const { content, messageType, mediaUrl, replyToMessageId } =
      c.req.valid("json");

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
        .where("contact_id", "=", contactId)
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

    const sendCommand = await buildSendMessageCommand(
      companyId,
      connection.id,
      contact.jid,
      content ?? "",
      messageType,
      user.id,
      waMessageId,
      mediaUrl,
      quotedWaMessageId,
      quotedSenderJid,
    );
    await tenantDb.transaction().execute(async (trx) => {
      await trx
        .insertInto("messages")
        .values({
          id: messageId,
          contact_id: contactId,
          whatsapp_connection_id: connection.id,
          message_id: waMessageId,
          from_me: true,
          sender_jid: connection.jid,
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
      await enqueueCommand(
        trx,
        buildCommandSubject(companyId, connection.id),
        sendCommand,
      );
    });

    return successWithMessage(c, "Message queued", {
      message: {
        id: messageId,
        messageId: waMessageId,
        conversationId: contactId,
        contactId,
        senderId: user.id,
        senderType: "user",
        sentByUserId: user.id,
        sentByUserName: user.name || user.email.split("@")[0],
        messageType,
        content: content ?? "",
        metadata: mediaUrl ? { mediaUrl } : undefined,
        replyToMessageId: replyToMessageId || undefined,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      autoAssigned: wasAutoAssigned,
    });
  },
);
