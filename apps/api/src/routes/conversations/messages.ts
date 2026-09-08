import { zValidator } from "@hono/zod-validator";
import {
  isChannel,
  isChannelProvider,
  REMOTE_HISTORY_RESPONSE_TIMEOUT_MS,
  toDbDate,
  toISOString,
} from "@wateaminbox/shared";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { resolveAdapterCapabilities } from "../../channel-spine/application/adapter-registry.js";
import { channelAdapterRegistry } from "../../channel-spine/registry.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import {
  authorizeMessageMedia,
  buildOutboundMediaColumns,
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
import {
  getPrivateMediaReference,
  resolveMediaKeyForCompany,
} from "../../lib/storage.js";
import { isConfirmedQuote } from "../../lib/message-quote.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  markDeprecatedMessageSend,
  requireMessageSendPermission,
} from "../../middleware/message-send-policy.js";
import { broadcastAutoAssignment } from "../../services/assignment-broadcast.service.js";
import { toAuthUserResponse } from "../../services/auth.service.js";
import {
  enqueueCommand,
  enqueueSessionCommand,
} from "../../services/command-outbox.service.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../../services/channel-spine-authority.service.js";
import { reserveMediaReferences } from "../../services/media-reference-lock.js";
import { requireSendAccess } from "../../services/send-access.service.js";
import {
  getUserAvatarSources,
  getUserNames,
} from "../../services/user.service.js";
import { getActiveSessionId } from "../../services/whatsapp/session.js";
import { validateGroupMentionJids } from "../../services/group-mention.service.js";

export const messageRoutes = new Hono();

/**
 * GET /conversations/:id/messages - Get messages for a conversation/contact
 * Query params: limit, cursor (for pagination)
 */
messageRoutes.get(
  "/:id/messages",
  zValidator("query", listConversationMessagesQuerySchema),
  async (c) => {
    const { tenantDb, companyId } = getRouteContext(c);
    const contactId = c.req.param("id");
    const { limit, cursor } = c.req.valid("query");
    const authority = await getChannelSpineWorkspaceAuthority(companyId);
    const neutralConversation = authority.neutralReadsEnabled
      ? await tenantDb
          .selectFrom("conversations")
          .select(["id", "provider_status"])
          .where("id", "=", contactId)
          .where("archived_at", "is", null)
          .executeTakeFirst()
      : undefined;
    if (neutralConversation) {
      let neutralQuery = tenantDb
        .selectFrom("messages")
        .select([
          "id",
          "channel_account_id",
          "conversation_id",
          "external_message_id",
          "direction",
          "normalized_type",
          "subject",
          "text_content",
          "sanitized_html_content",
          "reply_to_message_id",
          "sent_by_user_id",
          "status",
          "provider_occurred_at",
          "timestamp",
          "created_at",
        ])
        .where("conversation_id", "=", neutralConversation.id)
        .orderBy("timestamp", "desc")
        .orderBy("id", "desc")
        .limit(limit);
      if (cursor) {
        const cursorMessage = await tenantDb
          .selectFrom("messages")
          .select(["timestamp", "id"])
          .where("id", "=", cursor)
          .where("conversation_id", "=", neutralConversation.id)
          .executeTakeFirst();
        if (!cursorMessage) return badRequest(c, "Invalid cursor");
        neutralQuery = neutralQuery.where((eb) =>
          eb.or([
            eb("timestamp", "<", cursorMessage.timestamp),
            eb.and([
              eb("timestamp", "=", cursorMessage.timestamp),
              eb("id", "<", cursorMessage.id),
            ]),
          ]),
        );
      }
      const messages = await neutralQuery.execute();
      const messageIds = messages.map(({ id }) => id);
      const attachments = messageIds.length
        ? await tenantDb
            .selectFrom("message_attachments")
            .select([
              "id",
              "message_id",
              "ordinal",
              "kind",
              "file_name",
              "content_type",
              "byte_size",
              "status",
              "error_code",
            ])
            .where("message_id", "in", messageIds)
            .orderBy("ordinal")
            .execute()
        : [];
      const attachmentsByMessage = new Map<string, typeof attachments>();
      for (const attachment of attachments) {
        const current = attachmentsByMessage.get(attachment.message_id) ?? [];
        current.push(attachment);
        attachmentsByMessage.set(attachment.message_id, current);
      }
      return successData(c, {
        messages: messages.map((message) => ({
          id: message.id,
          channelAccountId: message.channel_account_id,
          conversationId: message.conversation_id,
          externalMessageId: message.external_message_id,
          direction: message.direction,
          messageType: message.normalized_type,
          subject: message.subject,
          textContent: message.text_content,
          sanitizedHtmlContent: message.sanitized_html_content,
          replyToMessageId: message.reply_to_message_id,
          sentByUserId: message.sent_by_user_id,
          status: message.status,
          providerOccurredAt: message.provider_occurred_at,
          timestamp: message.timestamp,
          createdAt: message.created_at,
          attachments: (attachmentsByMessage.get(message.id) ?? []).map(
            (attachment) => ({
              id: attachment.id,
              ordinal: attachment.ordinal,
              kind: attachment.kind,
              fileName: attachment.file_name,
              contentType: attachment.content_type,
              byteSize: attachment.byte_size,
              status: attachment.status,
              errorCode: attachment.error_code,
            }),
          ),
        })),
        hasMore: messages.length === limit,
        nextCursor:
          messages.length > 0 ? messages[messages.length - 1].id : null,
        providerStatus: neutralConversation.provider_status,
      });
    }

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
      .orderBy("id", "desc")
      .limit(limit);

    if (cursor) {
      const cursorMessage = await tenantDb
        .selectFrom("messages")
        .select(["timestamp", "id"])
        .where("id", "=", cursor)
        .where("contact_id", "=", contactId)
        .executeTakeFirst();

      if (!cursorMessage) {
        return badRequest(c, "Invalid cursor");
      }

      query = query.where((eb) =>
        eb.or([
          eb("timestamp", "<", cursorMessage.timestamp),
          eb.and([
            eb("timestamp", "=", cursorMessage.timestamp),
            eb("id", "<", cursorMessage.id),
          ]),
        ]),
      );
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
    const authorizedMessages = await authorizeMessageMedia(
      messages as MessageDbRow[],
      companyId,
    );
    const formattedMessages = formatMessagesForConversation(
      authorizedMessages,
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
    const { content, messageType, mediaUrl, replyToMessageId, mentionedJids } =
      c.req.valid("json");

    if (!content && messageType === "text") {
      return badRequest(c, "content is required for text messages");
    }

    const authority = await getChannelSpineWorkspaceAuthority(companyId);
    const neutralConversation = await tenantDb
      .selectFrom("conversations as conversation")
      .innerJoin(
        "channel_accounts as account",
        "account.id",
        "conversation.channel_account_id",
      )
      .select([
        "conversation.id",
        "conversation.channel_account_id",
        "conversation.external_thread_id",
        "account.channel",
        "account.provider",
      ])
      .where("conversation.id", "=", contactId)
      .where("conversation.archived_at", "is", null)
      .where("account.archived_at", "is", null)
      .executeTakeFirst();
    if (
      neutralConversation &&
      authority.writeAuthority === "neutral" &&
      isChannelProviderEnabled(authority, neutralConversation.provider)
    ) {
      if (
        !isChannel(neutralConversation.channel) ||
        !isChannelProvider(neutralConversation.provider) ||
        !["telegram_bot", "whatsapp_linked_device"].includes(
          neutralConversation.provider,
        )
      ) {
        return c.json(
          { error: "The channel adapter is not available for neutral writes" },
          503,
        );
      }
      const idempotencyKey = c.req.header("idempotency-key")?.trim();
      if (!idempotencyKey || idempotencyKey.length > 200) {
        return badRequest(c, "A valid Idempotency-Key header is required");
      }
      if (mentionedJids?.length) {
        return badRequest(c, "Mentions are not supported by this channel");
      }
      const capabilities = await resolveAdapterCapabilities(
        channelAdapterRegistry,
        neutralConversation.channel,
        neutralConversation.provider,
        {
          companyId,
          channelAccountId: neutralConversation.channel_account_id,
          conversationId: neutralConversation.id,
          now: new Date().toISOString(),
        },
      );
      const descriptor = capabilities.messageTypes.find(
        ({ type }) => type === messageType,
      );
      if (!descriptor?.enabled) {
        return badRequest(c, "Message type is not supported by this channel");
      }
      const storedMediaReference = mediaUrl
        ? getPrivateMediaReference(
            resolveMediaKeyForCompany(mediaUrl, companyId),
          )
        : null;
      const normalizedPayload = {
        messageType,
        textContent: content ?? "",
        sentByUserId: user.id,
        replyToExternalMessageId: null as string | null,
        attachments: storedMediaReference
          ? [{ ordinal: 0, storageUri: storedMediaReference }]
          : [],
      };
      if (replyToMessageId) {
        const quoted = await tenantDb
          .selectFrom("messages")
          .select("external_message_id")
          .where("id", "=", replyToMessageId)
          .where("conversation_id", "=", neutralConversation.id)
          .executeTakeFirst();
        if (!quoted?.external_message_id) return notFound(c, "Quoted message");
        normalizedPayload.replyToExternalMessageId = quoted.external_message_id;
      }
      const requestFingerprint = createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");
      const previous = await tenantDb
        .selectFrom("outbound_message_intents")
        .select(["message_id", "request_fingerprint", "status"])
        .where(
          "channel_account_id",
          "=",
          neutralConversation.channel_account_id,
        )
        .where("operation", "=", "send")
        .where("idempotency_key", "=", idempotencyKey)
        .executeTakeFirst();
      if (previous) {
        if (previous.request_fingerprint !== requestFingerprint) {
          return conflict(c, "Idempotency-Key was reused with another request");
        }
        return successData(
          c,
          { messageId: previous.message_id, intentStatus: previous.status },
          202,
        );
      }
      const messageId = crypto.randomUUID();
      await tenantDb.transaction().execute(async (trx) => {
        await reserveMediaReferences(trx, companyId, [storedMediaReference]);
        await trx
          .insertInto("messages")
          .values({
            id: messageId,
            whatsapp_connection_id: null,
            contact_id: null,
            message_id: null,
            from_me: true,
            sender_jid: null,
            sender_name: user.name,
            sender_avatar_url: null,
            message_type: messageType,
            content: content ?? "",
            media_url: storedMediaReference,
            media_mime_type: null,
            media_size: null,
            media_direct_path: null,
            media_key: null,
            media_file_sha256: null,
            media_file_enc_sha256: null,
            media_download_status: null,
            media_download_error: null,
            media_downloaded_at: null,
            quoted_message_id: null,
            sent_by_user_id: user.id,
            status: "pending",
            metadata: {},
            timestamp: new Date(),
            case_id: null,
            channel_account_id: neutralConversation.channel_account_id,
            conversation_id: neutralConversation.id,
            external_message_id: null,
            external_identity_scope: null,
            client_idempotency_key: idempotencyKey,
            direction: "outbound",
            sender_participant_id: null,
            reply_to_message_id: replyToMessageId ?? null,
            provider_occurred_at: null,
            normalized_type: messageType,
            subject: null,
            text_content: content ?? null,
            sanitized_html_content: null,
            provider_metadata: {},
          })
          .execute();
        await trx
          .insertInto("outbound_message_intents")
          .values({
            channel_account_id: neutralConversation.channel_account_id,
            conversation_id: neutralConversation.id,
            message_id: messageId,
            scheduled_message_id: null,
            operation: "send",
            idempotency_key: idempotencyKey,
            request_fingerprint: requestFingerprint,
            normalized_payload: normalizedPayload,
            lease_token: null,
            lease_expires_at: null,
            provider_request_id: null,
            last_error_code: null,
          })
          .execute();
      });
      return successData(c, { messageId, intentStatus: "pending" }, 202);
    }

    // Get contact JID and connection ID
    const contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "jid", "is_group", "whatsapp_connection_id"])
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

    if (mentionedJids?.length && messageType !== "text") {
      return badRequest(c, "Mentions are currently supported in text messages");
    }
    const mentionValidation = await validateGroupMentionJids(
      tenantDb,
      { id: contact.id, jid: contact.jid, isGroup: contact.is_group },
      content ?? "",
      mentionedJids,
    );
    if (mentionValidation.error) {
      return badRequest(c, mentionValidation.error);
    }

    // Look up the WhatsApp message ID and sender for reply-to if provided
    let quotedWaMessageId: string | undefined;
    let quotedSenderJid: string | undefined;
    if (replyToMessageId) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .select(["message_id", "sender_jid", "from_me", "status"])
        .where("id", "=", replyToMessageId)
        .where("contact_id", "=", contactId)
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
      mentionValidation.mentionedJids,
    );
    const storedMediaReference = mediaUrl
      ? getPrivateMediaReference(resolveMediaKeyForCompany(mediaUrl, companyId))
      : null;
    let autoAssigned = false;
    await tenantDb.transaction().execute(async (trx) => {
      await reserveMediaReferences(trx, companyId, [storedMediaReference]);
      const result = await requireSendAccess(trx, contactId, user.id);
      autoAssigned = result.autoAssigned;
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
          media_url: storedMediaReference,
          ...buildOutboundMediaColumns(sendCommand),
          quoted_message_id: quotedWaMessageId || null,
          sent_by_user_id: user.id,
          status: "pending",
          timestamp: new Date(),
          created_at: new Date(),
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
      await broadcastAutoAssignment(tenantDb, companyId, contactId, user.id);
    }

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
      autoAssigned,
    });
  },
);
