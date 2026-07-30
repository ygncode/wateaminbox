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
import {
  REMOTE_HISTORY_RESPONSE_TIMEOUT_MS,
  toDbDate,
  toISOString,
} from "@wateaminbox/shared";
import { toAuthUserResponse } from "../../services/auth.service.js";
import {
  enqueueCommand,
  enqueueSessionCommand,
} from "../../services/command-outbox.service.js";
import { ensureContactAssignment } from "../../services/contact.service.js";
import {
  getUserAvatarSources,
  getUserNames,
} from "../../services/user.service.js";
import { getActiveSessionId } from "../../services/whatsapp/session.js";

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
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["remote_history_status", "remote_history_updated_at"])
      .where("id", "=", contactId)
      .executeTakeFirst();
    if (!contact) {
      return notFound(c, "Contact");
    }
    let remoteHistoryStatus = contact.remote_history_status;
    if (
      remoteHistoryStatus === "requesting" &&
      (!contact.remote_history_updated_at ||
        contact.remote_history_updated_at.getTime() <=
          Date.now() - REMOTE_HISTORY_RESPONSE_TIMEOUT_MS)
    ) {
      remoteHistoryStatus = "failed";
      await tenantDb
        .updateTable("contacts")
        .set({
          remote_history_status: remoteHistoryStatus,
          remote_history_updated_at: toDbDate(),
        })
        .where("id", "=", contactId)
        .execute();
    }

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
    const senderUserIds = messages
      .map((message) => message.sent_by_user_id)
      .filter((id): id is string => Boolean(id));
    const [userNames, userAvatarSources] = await Promise.all([
      getUserNames(senderUserIds),
      getUserAvatarSources(senderUserIds),
    ]);

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
      userAvatarSources,
    );

    return successData(c, {
      messages: formattedMessages,
      hasMore: messages.length === limit,
      nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
      remoteHistoryStatus,
    });
  },
);

/**
 * POST /conversations/:id/history - Request the next remote history page from
 * the primary WhatsApp device after local database pages are exhausted.
 */
messageRoutes.post("/:id/history", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");
  const now = toDbDate();
  const staleRequestBefore = new Date(
    now.getTime() - REMOTE_HISTORY_RESPONSE_TIMEOUT_MS,
  );

  const result = await tenantDb.transaction().execute(async (trx) => {
    const contact = await trx
      .selectFrom("contacts")
      .select([
        "id",
        "jid",
        "whatsapp_connection_id",
        "remote_history_status",
        "remote_history_updated_at",
      ])
      .where("id", "=", contactId)
      .forUpdate()
      .executeTakeFirst();
    if (!contact?.jid || !contact.whatsapp_connection_id) {
      return { error: "This conversation is not linked to WhatsApp" } as const;
    }

    if (
      contact.remote_history_status === "exhausted" ||
      contact.remote_history_status === "unavailable"
    ) {
      return {
        error:
          contact.remote_history_status === "exhausted"
            ? "WhatsApp reports that no older messages remain"
            : "Older messages are not available from the primary phone",
      } as const;
    }
    if (
      contact.remote_history_status === "requesting" &&
      contact.remote_history_updated_at &&
      contact.remote_history_updated_at > staleRequestBefore
    ) {
      return { queued: true, alreadyPending: true } as const;
    }

    const connection = await trx
      .selectFrom("whatsapp_connections")
      .select("id")
      .where("id", "=", contact.whatsapp_connection_id)
      .where("status", "=", "connected")
      .executeTakeFirst();
    if (!connection) {
      return {
        error: "The contact's WhatsApp connection is not active",
      } as const;
    }

    const oldestMessage = await trx
      .selectFrom("messages")
      .select(["message_id", "from_me", "timestamp"])
      .where("contact_id", "=", contact.id)
      .where("whatsapp_connection_id", "=", connection.id)
      .where("message_id", "is not", null)
      .where("message_id", "not like", "pending_%")
      .orderBy("timestamp", "asc")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (!oldestMessage?.message_id) {
      return {
        error: "An existing WhatsApp message is required to load older history",
      } as const;
    }

    const sessionId = await getActiveSessionId(trx, connection.id);
    await trx
      .updateTable("contacts")
      .set({
        remote_history_status: "requesting",
        remote_history_updated_at: now,
        updated_at: now,
      })
      .where("id", "=", contact.id)
      .execute();
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.requestHistory({
        chatJid: contact.jid!,
        oldestMessageId: oldestMessage.message_id!,
        oldestFromMe: oldestMessage.from_me,
        oldestTimestamp: toISOString(oldestMessage.timestamp),
        count: 50,
      }),
    );
    return { queued: true, alreadyPending: false } as const;
  });

  if ("error" in result) {
    return badRequest(c, result.error);
  }
  return successData(
    c,
    {
      ...result,
      remoteHistoryStatus: "requesting" as const,
    },
    202,
  );
});

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
    const sessionId = await getActiveSessionId(tenantDb, connection.id);

    const sendCommand = await buildSendMessageCommand(
      companyId,
      sessionId,
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
        buildCommandSubject(companyId, sessionId),
        sendCommand,
      );
    });

    const senderProfile = await toAuthUserResponse(user);
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
        sentByUserAvatarUrl: senderProfile.avatarUrl,
        sentByUserGravatarUrl: senderProfile.gravatarUrl,
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
