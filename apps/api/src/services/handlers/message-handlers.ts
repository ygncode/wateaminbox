/**
 * Message event handlers - incoming messages, receipts, send confirmations
 */

import { type MessageStatus, type MessageType } from "@wateaminbox/database";
import {
  extractPhoneFromJid,
  formatPhoneLikeText,
  normalizeJid,
  toDate,
  toDbDate,
} from "@wateaminbox/shared";
import { sql } from "kysely";
import { formatError } from "../../lib/logger.js";
import {
  buildQuotedMessageData,
  type MessageDbRow,
} from "../../lib/message-formatters.js";
import {
  buildCommandSubject,
  type MessageEvent,
  type NatsCommand,
  PermanentEventError,
  publishCommand,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type SendFailedEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { broadcastAutoUnassignment } from "../assignment-broadcast.service.js";
import { createAuditLog } from "../audit.service.js";
import {
  openOrReopenCaseForInboundMessage,
  resolveActiveCaseIdForContact,
} from "../conversation-case.service.js";
import { indexMessage, type MessageDocument } from "../meilisearch.service.js";
import { sendPushToUsers } from "../notification-delivery.service.js";
import { resolveIncomingMessageRecipients } from "../notification-recipient.service.js";
import { updateMessageSearchVector } from "../search.service.js";
import { getTenantConnection } from "../tenant.service.js";
import { handlerLogger as logger } from "./types.js";

const participantProfileRequests = new Map<string, number>();
const participantProfileRequestCooldownMs = 10 * 60 * 1000;

async function requestParticipantProfile(
  companyId: string,
  connectionId: string,
  jid: string,
): Promise<void> {
  const requestKey = `${connectionId}:${jid}`;
  const lastRequestedAt = participantProfileRequests.get(requestKey) || 0;
  if (Date.now() - lastRequestedAt < participantProfileRequestCooldownMs) {
    return;
  }
  participantProfileRequests.set(requestKey, Date.now());

  await publishCommand(buildCommandSubject(companyId, connectionId), {
    type: "fetch_profile_picture",
    company_id: companyId,
    connection_id: connectionId,
    jid,
  } as NatsCommand & { jid: string });
}

/**
 * Handles incoming WhatsApp messages
 */
export async function handleMessageEvent(event: MessageEvent): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.debug(
    { companyId, connectionId, from: payload.from },
    "Message received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Durable events must identify their owning connection. Falling back to a
    // different active account can corrupt contacts/messages when IDs collide.
    if (!connectionId) {
      logger.error({ companyId }, "Quarantining message without connection ID");
      throw new PermanentEventError(
        `Message event for company ${companyId} has no connection ID`,
      );
    }
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "name", "phone_number"])
      .where("id", "=", connectionId)
      .executeTakeFirst();

    if (!connection) {
      logger.error(
        { companyId, connectionId },
        "Quarantining message for unknown connection",
      );
      throw new PermanentEventError(
        `Message event references unknown connection ${connectionId}`,
      );
    }

    // Group messages belong to the group conversation, while `from` identifies
    // the participant who authored the message. Direct chats continue to use
    // the remote party as the conversation identity.
    const isGroupMessage =
      payload.isGroup === true ||
      Boolean(payload.groupId) ||
      payload.to?.includes("@g.us");
    const rawContactJid = isGroupMessage
      ? payload.groupId || payload.to
      : payload.fromMe
        ? payload.to
        : payload.from;
    if (!rawContactJid) {
      logger.warn(
        { companyId, messageId: payload.messageId },
        "Message has no contact JID",
      );
      throw new PermanentEventError(
        `Message ${payload.messageId} has no contact JID`,
      );
    }
    const contactJid = normalizeJid(rawContactJid);
    if (!contactJid) {
      logger.warn(
        { companyId, rawContactJid },
        "Message contact JID is invalid",
      );
      throw new PermanentEventError(
        `Message ${payload.messageId} has invalid contact JID ${rawContactJid}`,
      );
    }
    let contact = await tenantDb
      .selectFrom("contacts")
      .select(["id"])
      .where("jid", "=", contactJid)
      .where("whatsapp_connection_id", "=", connection.id)
      .executeTakeFirst();

    if (!contact) {
      const contactId = crypto.randomUUID();
      // Extract phone number from JID (removes device suffix like ":3")
      const phoneNumber = extractPhoneFromJid(contactJid);
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: contactJid,
          phone_number: phoneNumber,
          is_group: isGroupMessage || contactJid.includes("@g.us"),
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .execute();
      contact = { id: contactId };
    }

    // Preserve the participant separately from the group conversation. Push
    // names are carried by WhatsApp history/live events; fall back to an
    // existing contact name when WhatsApp omits one.
    let normalizedSenderJid = normalizeJid(payload.from);
    let senderName = payload.senderName?.trim() || null;

    // Some history syncs omit MessageKey.Participant and report the group as
    // `from`. Whatsmeow's message-secret store still retains the actual author.
    if (isGroupMessage && normalizedSenderJid?.includes("@g.us")) {
      const resolvedParticipant = await sql<{
        sender_jid: string;
        sender_name: string | null;
      }>`
        SELECT
          regexp_replace(
            coalesce(mapping.jid, secret.sender_jid),
            ':[0-9]+@',
            '@'
          ) AS sender_jid,
          coalesce(
            nullif(stored_contact.full_name, ''),
            nullif(stored_contact.push_name, ''),
            nullif(stored_contact.first_name, '')
          ) AS sender_name
        FROM whatsapp_sessions.whatsmeow_message_secrets AS secret
        LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS mapping
          ON mapping.connection_id::text = secret.connection_id::text
          AND regexp_replace(mapping.lid, ':[0-9]+@', '@') =
              regexp_replace(secret.sender_jid, ':[0-9]+@', '@')
        LEFT JOIN whatsapp_sessions.whatsmeow_contacts AS stored_contact
          ON stored_contact.connection_id::text = secret.connection_id::text
          AND regexp_replace(stored_contact.their_jid, ':[0-9]+@', '@') =
              regexp_replace(
                coalesce(mapping.jid, secret.sender_jid),
                ':[0-9]+@',
                '@'
              )
        WHERE secret.connection_id::text = ${connection.id}
          AND secret.message_id = ${payload.messageId}
        ORDER BY mapping.created_at DESC NULLS LAST
        LIMIT 1
      `.execute(tenantDb);
      const participant = resolvedParticipant.rows[0];
      if (participant) {
        normalizedSenderJid = participant.sender_jid;
        senderName ||= participant.sender_name;
      }
    }

    if (
      isGroupMessage &&
      !payload.fromMe &&
      !senderName &&
      normalizedSenderJid &&
      !normalizedSenderJid.includes("@g.us")
    ) {
      const storedWhatsAppContact = await sql<{
        full_name: string | null;
        push_name: string | null;
        first_name: string | null;
      }>`
        SELECT full_name, push_name, first_name
        FROM whatsapp_sessions.whatsmeow_contacts
        WHERE connection_id::text = ${connection.id}
          AND regexp_replace(their_jid, ':[0-9]+@', '@') = ${normalizedSenderJid}
        LIMIT 1
      `.execute(tenantDb);
      const whatsappName = storedWhatsAppContact.rows[0];

      const senderContact = await tenantDb
        .selectFrom("contacts")
        .select(["custom_name", "push_name", "phone_number"])
        .where("jid", "=", normalizedSenderJid)
        .where("whatsapp_connection_id", "=", connection.id)
        .executeTakeFirst();
      senderName =
        senderContact?.custom_name ||
        senderContact?.push_name ||
        whatsappName?.full_name ||
        whatsappName?.push_name ||
        whatsappName?.first_name ||
        senderContact?.phone_number ||
        extractPhoneFromJid(normalizedSenderJid) ||
        null;
    }

    // Store the message - also normalize sender_jid
    // Determine media download status based on whether it's a history sync with deferred media
    const hasMediaReference = Boolean(
      payload.mediaDirectPath && payload.mediaKey,
    );
    const mediaDownloadStatus = payload.mediaUrl
      ? "completed"
      : hasMediaReference
        ? "pending"
        : null;
    const messageStatus: MessageStatus = payload.fromMe
      ? (payload.status ?? "sent")
      : "delivered";

    const messageId = crypto.randomUUID();

    // The message insert, unread-count/last-message projection update, and
    // conversation-case open/reopen must succeed or fail together: a case
    // opening without its triggering message being durably stored (or vice
    // versa) would corrupt the SLA clock. See conversation-case.service.ts
    // for why the case-open step itself is additionally safe under retries
    // and concurrent events (partial unique index + ON CONFLICT DO NOTHING).
    const { insertResult, caseResult } = await tenantDb
      .transaction()
      .execute(async (trx) => {
        const insertQuery = trx.insertInto("messages").values({
          id: messageId,
          whatsapp_connection_id: connection.id,
          contact_id: contact.id,
          message_id: payload.messageId,
          from_me: payload.fromMe,
          sender_jid: normalizedSenderJid,
          sender_name: senderName,
          sender_avatar_url: null,
          message_type: payload.messageType as MessageType,
          content: payload.content,
          metadata: payload.protocolSenderJid
            ? { protocolSenderJid: payload.protocolSenderJid }
            : null,
          media_url: payload.mediaUrl || null,
          media_mime_type: payload.mediaType || null,
          media_size: payload.mediaSize || null,
          // Deferred media download fields
          media_direct_path: payload.mediaDirectPath || null,
          media_key: payload.mediaKey
            ? Buffer.from(payload.mediaKey, "base64")
            : null,
          media_file_sha256: payload.mediaFileSha256
            ? Buffer.from(payload.mediaFileSha256, "base64")
            : null,
          media_file_enc_sha256: payload.mediaFileEncSha256
            ? Buffer.from(payload.mediaFileEncSha256, "base64")
            : null,
          media_download_status: mediaDownloadStatus,
          quoted_message_id: payload.quotedMessageId || null,
          is_forwarded: false,
          is_starred: false,
          deleted_by_sender: false,
          status: messageStatus,
          timestamp: toDbDate(payload.timestamp),
          created_at: toDbDate(),
        });

        // A reconnect can resend history that was previously imported without
        // its group participant. Update just the sender fields so that a new
        // history sync repairs those existing rows without duplicating
        // messages.
        const insertResult = payload.isHistorySync
          ? await insertQuery
              .onConflict((oc) =>
                oc
                  .columns(["whatsapp_connection_id", "message_id"])
                  .doUpdateSet({
                    from_me: payload.fromMe,
                    sender_jid: normalizedSenderJid,
                    sender_name: senderName,
                    metadata: payload.protocolSenderJid
                      ? { protocolSenderJid: payload.protocolSenderJid }
                      : null,
                    quoted_message_id: payload.quotedMessageId || null,
                    // History sync contains the original WhatsApp status. Merge
                    // it monotonically so imported messages get their old
                    // double ticks without regressing newer realtime receipt
                    // state.
                    status: sql<MessageStatus>`CASE
                WHEN messages.status = 'read' OR excluded.status = 'read'
                  THEN 'read'::message_status
                WHEN messages.status = 'delivered' OR excluded.status = 'delivered'
                  THEN 'delivered'::message_status
                WHEN messages.status = 'sent' OR excluded.status = 'sent'
                  THEN 'sent'::message_status
                WHEN messages.status = 'pending' OR excluded.status = 'pending'
                  THEN 'pending'::message_status
                ELSE 'failed'::message_status
              END`,
                  }),
              )
              .returning("id")
              .executeTakeFirst()
          : await insertQuery
              .onConflict((oc) =>
                oc.columns(["whatsapp_connection_id", "message_id"]).doNothing(),
              )
              .returning("id")
              .executeTakeFirst();

        // If insert was skipped due to duplicate, skip all downstream
        // processing - including opening/reopening a case, which must never
        // happen for a message that was already processed.
        if (!insertResult) {
          return { insertResult: null, caseResult: null };
        }

        // Open/reopen the contact's conversation case FIRST, before any
        // other write to conversation_states in this transaction - it reads
        // the projection's CURRENT status to decide "opened" vs
        // "auto_reopened", and that read must see reality, not a row this
        // same transaction is about to create (see message-handlers bug:
        // running the unread-count upsert first could insert a
        // conversation_states row - defaulting to 'resolved' since 061 -
        // for a brand-new contact, making its own first-ever message look
        // like a reopen). Skip entirely for history sync - imported history
        // must never open cases or affect either SLA.
        let caseResult: Awaited<
          ReturnType<typeof openOrReopenCaseForInboundMessage>
        > = null;
        if (!payload.fromMe && !payload.isHistorySync) {
          caseResult = await openOrReopenCaseForInboundMessage(
            trx,
            companyId,
            { id: contact.id, isGroup: isGroupMessage },
            { id: messageId, timestamp: toDbDate(payload.timestamp) },
          );

          // Increment unread count for the incoming message. The case-open
          // step above already upserts a conversation_states row via
          // syncProjection in every reachable path, so this is normally an
          // UPDATE; the INSERT fallback only matters for the unreachable
          // defensive case where case-open found no active case at all -
          // explicitly `status: "open"` there rather than relying on the
          // column default, since we know a live inbound just arrived.
          const updateResult = await trx
            .updateTable("conversation_states")
            .set((eb) => ({
              unread_count: eb("unread_count", "+", 1),
              last_message_at: toDbDate(payload.timestamp),
              last_message_preview: payload.content?.substring(0, 100) || null,
              updated_at: toDbDate(),
            }))
            .where("contact_id", "=", contact.id)
            .executeTakeFirst();

          if (updateResult.numUpdatedRows === BigInt(0)) {
            await trx
              .insertInto("conversation_states")
              .values({
                contact_id: contact.id,
                status: "open",
                unread_count: 1,
                last_message_at: toDbDate(payload.timestamp),
                last_message_preview: payload.content?.substring(0, 100) || null,
              })
              .execute();
          }

          // Note: We don't create notification_history entries for regular
          // messages because the chat UI already shows unread counts via
          // conversation_states and new messages appear in real-time via the
          // message:new realtime event. notification_history is reserved for:
          // assignments, mentions, team, system events
        } else if (payload.fromMe && !payload.isHistorySync) {
          // Live outbound (e.g. relayed from another linked device): stamp
          // durable case membership from whatever is currently active, if
          // anything. Never opens/mutates a case - only inbound does that.
          const activeCaseId = await resolveActiveCaseIdForContact(
            trx,
            contact.id,
          );
          if (activeCaseId) {
            await trx
              .updateTable("messages")
              .set({ case_id: activeCaseId })
              .where("id", "=", messageId)
              .execute();
          }
        }

        return { insertResult, caseResult };
      });

    // If insert was skipped due to duplicate, skip all downstream processing.
    if (!insertResult) {
      logger.debug(
        { messageId: payload.messageId, companyId },
        "Skipped duplicate message",
      );
      return;
    }

    const storedMessageId = insertResult.id;
    logger.debug({ messageId: storedMessageId, companyId }, "Stored message");

    if (
      isGroupMessage &&
      !payload.fromMe &&
      normalizedSenderJid &&
      !normalizedSenderJid.includes("@g.us")
    ) {
      requestParticipantProfile(
        companyId,
        sessionId ?? connection.id,
        normalizedSenderJid,
      ).catch((error) => {
        logger.warn(
          { error: formatError(error), jid: normalizedSenderJid },
          "Failed to request group participant profile",
        );
      });
    }

    // Index message for search (run in background, don't block message processing)
    // Get contact name for search indexing
    const contactForSearch = await tenantDb
      .selectFrom("contacts")
      .select(["push_name", "custom_name", "jid", "is_group"])
      .where("id", "=", contact.id)
      .executeTakeFirst();

    const contactName =
      contactForSearch?.custom_name || contactForSearch?.push_name || null;

    // Update PostgreSQL full-text search vector
    updateMessageSearchVector(companyId, storedMessageId).catch((err) => {
      logger.error(formatError(err), "Failed to update search vector");
    });

    // Index in Meilisearch for better search experience
    const messageDoc: MessageDocument = {
      id: storedMessageId,
      companyId,
      contactId: contact.id,
      contactName,
      contactJid: contactForSearch?.jid || contactJid,
      isGroup: contactForSearch?.is_group || contactJid.includes("@g.us"),
      messageId: payload.messageId,
      content: payload.content || null,
      messageType: payload.messageType || "text",
      timestamp: toDate(payload.timestamp)?.getTime() || Date.now(),
      fromMe: payload.fromMe,
    };

    indexMessage(companyId, messageDoc).catch((err) => {
      logger.error(formatError(err), "Failed to index message in Meilisearch");
    });

    // Skip notifications, unread counts, and broadcasts for history sync messages
    // History sync imports hundreds of old messages - we don't want to flood the notification system
    if (payload.isHistorySync) {
      logger.debug(
        { messageId: storedMessageId, companyId, contactId: contact.id },
        "Skipping notifications for history sync message",
      );
    }

    // Resolve the quoted WhatsApp stanza for the realtime payload. Without the
    // embedded message, an incoming reply only looks like a regular message
    // until the conversation is manually refetched.
    let replyToMessage: ReturnType<typeof buildQuotedMessageData> | undefined;
    if (payload.quotedMessageId && !payload.isHistorySync) {
      const quotedMessage = await tenantDb
        .selectFrom("messages")
        .selectAll()
        .where("whatsapp_connection_id", "=", connection.id)
        .where("contact_id", "=", contact.id)
        .where("message_id", "=", payload.quotedMessageId)
        .executeTakeFirst();
      if (quotedMessage) {
        replyToMessage = buildQuotedMessageData(quotedMessage as MessageDbRow);
      }
    }

    // Broadcast to clients with proper format for frontend
    // Frontend expects { message: Message, conversationId: string }
    // Skip for history sync messages to avoid flooding during initial sync
    if (!payload.isHistorySync) {
      await broadcastToCompany(
        companyId,
        "message:new",
        {
          message: {
            id: storedMessageId,
            conversationId: contact.id,
            senderId: payload.from,
            senderType: payload.fromMe ? "user" : "contact",
            senderJid: normalizedSenderJid,
            senderName,
            senderAvatarUrl: null,
            content: payload.content || "",
            messageType: payload.messageType || "text",
            status: messageStatus,
            whatsappMessageId: payload.messageId,
            metadata: payload.mediaUrl
              ? { mediaUrl: payload.mediaUrl }
              : undefined,
            replyToMessageId: payload.quotedMessageId,
            replyToMessage,
            isForwarded: false,
            isDeleted: false,
            isStarred: false,
            createdAt: payload.timestamp,
            updatedAt: payload.timestamp,
          },
          conversationId: contact.id,
        },
        connectionId,
      );
    }

    if (caseResult) {
      await broadcastToCompany(
        companyId,
        "conversation:updated",
        {
          event: caseResult.wasAutoReopen ? "auto_reopened" : "opened",
          contactId: contact.id,
          caseId: caseResult.case.id,
          status: caseResult.case.status,
        },
        connectionId,
      );

      // The automatic reopen cleared the prior assignee inside the
      // transaction (see openOrReopenCaseForInboundMessage's doc comment) -
      // broadcast/audit that outside it, same as every other realtime
      // signal/audit entry in this handler.
      if (caseResult.unassignedPreviousAssignee) {
        await broadcastAutoUnassignment(
          tenantDb,
          companyId,
          contact.id,
          caseResult.unassignedPreviousAssignee,
        );
        await createAuditLog({
          companyId,
          userId: null,
          action: "contact.unassigned",
          entityType: "contact",
          entityId: contact.id,
          details: {
            previousAssignee: caseResult.unassignedPreviousAssignee,
            reason: "auto_reopen",
            caseId: caseResult.case.id,
          },
        });
      }
    }

    if (!payload.fromMe && !payload.isHistorySync) {
      const senderLabel =
        senderName || extractPhoneFromJid(normalizedSenderJid);
      const senderTitle = senderLabel
        ? formatPhoneLikeText(senderLabel)
        : contactName || "New message";
      const accountLabel = formatPhoneLikeText(
        connection.name || connection.phone_number,
      );
      const pushTitle = accountLabel
        ? `${senderTitle} → ${accountLabel}`
        : senderTitle;
      resolveIncomingMessageRecipients({
        companyId,
        contactId: contact.id,
        contactJid,
        fromMe: payload.fromMe,
        isHistorySync: Boolean(payload.isHistorySync),
      })
        .then((recipientIds) =>
          sendPushToUsers(companyId, recipientIds, {
            version: 1,
            type: "message",
            title: pushTitle,
            body: getPushMessagePreview(payload.messageType, payload.content),
            tag: `message-${storedMessageId}`,
            actionUrl: `/chat/${contact.id}`,
            icon: "/apple-touch-icon.png",
            badge: "/favicon-32x32.png",
          }),
        )
        .catch((pushError) => {
          logger.warn(
            {
              error: formatError(pushError),
              companyId,
              contactId: contact.id,
              messageId: storedMessageId,
              transport: "web-push",
            },
            "Incoming message persisted but push delivery failed",
          );
        });
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to store message");
    throw error;
  }
}

export function getPushMessagePreview(
  messageType: string | undefined,
  content: string | null | undefined,
): string {
  switch (messageType) {
    case "image":
      return "Sent an image";
    case "video":
      return "Sent a video";
    case "audio":
      return "Sent an audio message";
    case "document":
      return "Sent a document";
    case "location":
      return "Shared a location";
    default:
      return content?.slice(0, 100) || "New message";
  }
}

/**
 * Maps WhatsApp receipt types to database message_status enum values
 * WhatsApp types: "sender", "delivered", "read", "played", ""
 * DB enum: "pending", "sent", "delivered", "read", "failed"
 */
function mapReceiptStatus(
  waStatus: string,
): "sent" | "delivered" | "read" | null {
  switch (waStatus) {
    case "sender":
    case "sent":
      return "sent";
    case "":
    case "delivered":
      // WhatsApp represents a normal delivery receipt as an empty string.
      return "delivered";
    case "read":
    case "played":
      return "read";
    default:
      // Unknown or empty status - skip update
      return null;
  }
}

/**
 * Handles message receipt/status updates
 */
export async function handleReceiptEvent(event: ReceiptEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    { status: payload.status, messageId: payload.messageId, connectionId },
    "Receipt received",
  );

  // Map WhatsApp receipt type to database enum
  const dbStatus = mapReceiptStatus(payload.status);
  if (!dbStatus) {
    logger.debug({ status: payload.status }, "Skipping unknown receipt status");
    return;
  }

  try {
    const tenantDb = getTenantConnection(companyId);

    // Delivery receipts can arrive out of order. In particular, WhatsApp may
    // emit a "sender" receipt after a "read" receipt when a linked device
    // receives a new message. Only advance the persisted status so read ticks
    // never regress to sent/delivered.
    const eligibleCurrentStatuses: MessageStatus[] =
      dbStatus === "sent"
        ? ["pending", "failed"]
        : dbStatus === "delivered"
          ? ["pending", "sent", "failed"]
          : ["pending", "sent", "delivered", "failed"];

    // Note: We store the WhatsApp message ID in message_id column.
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({ status: dbStatus })
      .where("message_id", "=", payload.messageId)
      .where("whatsapp_connection_id", "=", connectionId)
      .where("from_me", "=", true)
      .where((eb) =>
        eb.or([
          eb("status", "in", eligibleCurrentStatuses),
          eb("status", "is", null),
        ]),
      )
      .returning(["id", "contact_id", "status"])
      .executeTakeFirst();

    logger.debug(
      {
        status: dbStatus,
        waMessageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      "Updated message status",
    );

    // Broadcast to clients with correct message:status format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      await broadcastToCompany(
        companyId,
        "message:status",
        {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: dbStatus,
        },
        connectionId,
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle receipt");
    throw error;
  }
}

/**
 * Handles send confirmation events
 * Updates a message from pending status with its real WhatsApp message ID
 */
export async function handleSendConfirmationEvent(
  event: SendConfirmationEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    {
      pendingMessageId: payload.pendingMessageId,
      messageId: payload.messageId,
      connectionId,
    },
    "Send confirmation received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Always replace the temporary WhatsApp ID, but preserve a higher status
    // if an unusually fast delivery/read receipt was processed first.
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({
        message_id: payload.messageId,
        status: sql<MessageStatus>`CASE
          WHEN status IN ('delivered', 'read') THEN status
          ELSE 'sent'::message_status
        END`,
      })
      .where("message_id", "=", payload.pendingMessageId)
      .where("whatsapp_connection_id", "=", connectionId)
      .returning(["id", "contact_id", "status"])
      .executeTakeFirst();

    logger.debug(
      {
        pendingMessageId: payload.pendingMessageId,
        messageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      "Updated message with real ID",
    );

    // Broadcast to clients with the correct payload format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      await broadcastToCompany(
        companyId,
        "message:status",
        {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: updatedMessage.status ?? "sent",
        },
        connectionId,
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle send confirmation");
    throw error;
  }
}

/**
 * Handles send failed events
 * Updates a message to failed status when max delivery attempts exceeded
 */
export async function handleSendFailedEvent(
  event: SendFailedEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.warn(
    {
      pendingMessageId: payload.pendingMessageId,
      reason: payload.reason,
      connectionId,
    },
    "Message send failed after max retries",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // A late failure must not overwrite a confirmed delivery/read status.
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({ status: "failed" })
      .where("message_id", "=", payload.pendingMessageId)
      .where("whatsapp_connection_id", "=", connectionId)
      .where("status", "=", "pending")
      .returning(["id", "contact_id"])
      .executeTakeFirst();

    if (!updatedMessage) {
      logger.warn(
        { pendingMessageId: payload.pendingMessageId },
        "Message not found for send_failed event",
      );
      return;
    }

    logger.debug(
      {
        pendingMessageId: payload.pendingMessageId,
        internalId: updatedMessage.id,
        contactId: updatedMessage.contact_id,
      },
      "Marked message as failed",
    );

    // Broadcast message:failed event to clients
    // Frontend can show retry option
    await broadcastToCompany(
      companyId,
      "message:failed",
      {
        conversationId: updatedMessage.contact_id,
        messageId: updatedMessage.id,
        reason: payload.reason,
      },
      connectionId,
    );

    // Also broadcast a toast notification for user visibility
    await broadcastToCompany(
      companyId,
      "notification:toast",
      {
        type: "error",
        title: "Message failed",
        message: `Failed to send message: ${payload.reason}`,
      },
      connectionId,
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to handle send_failed event");
    throw error;
  }
}
