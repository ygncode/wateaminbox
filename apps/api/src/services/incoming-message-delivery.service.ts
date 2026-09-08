import {
  extractPhoneFromJid,
  formatPhoneLikeText,
  getContactDisplayName,
} from "@wateaminbox/shared";
import {
  buildQuotedMessageData,
  type MessageDbRow,
} from "../lib/message-formatters.js";
import { broadcastAutoUnassignment } from "./assignment-broadcast.service.js";
import { broadcastToContactViewers } from "./message-broadcast.service.js";
import type { MessageDeliveryJob } from "./message-delivery-outbox.service.js";
import { getPushMessagePreview } from "./message-push-preview.js";
import { sendPushToUsers } from "./notification-delivery.service.js";
import { resolveIncomingMessageRecipients } from "./notification-recipient.service.js";
import { getTenantConnection } from "./tenant.service.js";

// Retry using current rows and current visibility. Deleted messages are never replayed.
export async function deliverIncomingMessage(
  job: MessageDeliveryJob,
): Promise<void> {
  const {
    company_id: companyId,
    connection_id: connectionId,
    message_id: storedMessageId,
    kind,
    case_event: caseResult,
  } = job;
  const tenantDb = getTenantConnection(companyId);
  const message = await tenantDb
    .selectFrom("messages")
    .selectAll()
    .where("id", "=", storedMessageId)
    .where("whatsapp_connection_id", "=", connectionId)
    .executeTakeFirst();
  if (!message || message.deleted_by_sender || !message.contact_id) return;
  const contact = await tenantDb
    .selectFrom("contacts")
    .selectAll()
    .where("id", "=", message.contact_id)
    .executeTakeFirst();
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .selectAll()
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!contact || !connection || connection.archived_at) return;
  const contactJid = contact.jid || "";
  const contactName = getContactDisplayName(contact, "Unknown");
  const normalizedSenderJid = message.sender_jid || "";
  const senderName = message.sender_name;
  const incomingMetadata = message.metadata;
  const messageStatus = message.status;
  const payload = {
    quotedMessageId: message.quoted_message_id,
    mediaUrl: message.media_url,
    messageType: message.message_type,
    from: normalizedSenderJid,
    fromMe: message.from_me,
    content: message.content,
    messageId: message.message_id,
    timestamp: new Date(message.timestamp).toISOString(),
  };
  // Resolve the quoted WhatsApp stanza for the realtime payload. Without the
  // embedded message, an incoming reply only looks like a regular message
  // until the conversation is manually refetched.
  let replyToMessage: ReturnType<typeof buildQuotedMessageData> | undefined;
  if (payload.quotedMessageId && kind === "realtime") {
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
  if (kind === "realtime") {
    const realtimeMetadata = {
      ...(payload.mediaUrl ? { mediaAvailable: true } : {}),
      ...(payload.messageType === "contact" && incomingMetadata?.contactCards
        ? { contactCards: incomingMetadata.contactCards }
        : {}),
      ...(incomingMetadata?.mediaAlbumId
        ? {
            mediaAlbumId: incomingMetadata.mediaAlbumId,
            mediaAlbumIndex: incomingMetadata.mediaAlbumIndex,
            mediaAlbumCount: incomingMetadata.mediaAlbumCount,
          }
        : {}),
    };
    await broadcastToContactViewers(
      companyId,
      contact.id,
      "message:new",
      {
        message: {
          id: storedMessageId,
          conversationId: contact.id,
          channelConversationId: message.conversation_id,
          senderId: payload.from,
          senderType: payload.fromMe ? "user" : "contact",
          senderJid: normalizedSenderJid,
          senderName,
          senderAvatarUrl: null,
          content: payload.content || "",
          messageType: payload.messageType || "text",
          status: messageStatus,
          whatsappMessageId: payload.messageId,
          // Private media URLs are issued only by visibility-checked HTTP
          // reads; realtime payloads carry update signals only.
          metadata:
            Object.keys(realtimeMetadata).length > 0
              ? realtimeMetadata
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
        channelConversationId: message.conversation_id,
      },
      { connectionId, requireDelivery: true },
    );
  }

  if (kind === "realtime" && caseResult) {
    await broadcastToContactViewers(
      companyId,
      contact.id,
      "conversation:updated",
      {
        event: caseResult.wasAutoReopen ? "auto_reopened" : "opened",
        contactId: contact.id,
        caseId: caseResult.case.id,
        status: caseResult.case.status,
      },
      { connectionId, requireDelivery: true },
    );

    // The automatic reopen cleared the prior assignee inside the
    // transaction (see openOrReopenCaseForInboundMessage's doc comment) -
    // broadcast the change here. Its audit entry committed with the message.
    if (caseResult.unassignedPreviousAssignee) {
      await broadcastAutoUnassignment(
        tenantDb,
        companyId,
        contact.id,
        caseResult.unassignedPreviousAssignee,
        true,
      );
    }
  }

  if (kind === "push" && !payload.fromMe) {
    const senderLabel = senderName || extractPhoneFromJid(normalizedSenderJid);
    const senderTitle = senderLabel
      ? formatPhoneLikeText(senderLabel)
      : contactName || "New message";
    const accountLabel = formatPhoneLikeText(
      connection.name || connection.phone_number,
    );
    const pushTitle = accountLabel
      ? `${senderTitle} → ${accountLabel}`
      : senderTitle;
    const recipientIds = await resolveIncomingMessageRecipients({
      companyId,
      contactId: contact.id,
      contactJid,
      fromMe: false,
      isHistorySync: false,
    });
    const result = await sendPushToUsers(companyId, recipientIds, {
      version: 1,
      type: "message",
      title: pushTitle,
      body: getPushMessagePreview(payload.messageType, payload.content),
      tag: `message-${storedMessageId}`,
      actionUrl: `/chat/${contact.id}`,
      icon: "/apple-touch-icon.png",
      badge: "/favicon-96x96.png",
    });
    if (result.failed > 0)
      throw new Error("Incoming message push delivery failed");
  }
}
