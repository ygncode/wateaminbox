import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  formatMessagesForConversation,
  buildQuotedMessageData,
  type MessageDbRow,
  type ReactionData,
} from "../../lib/message-formatters.js";
import { publishSendMessage } from "../../lib/nats/index.js";
import { extractPaginationParams } from "../../lib/route-helpers.js";
import { getRouteContext } from "../../middleware/context.js";
import { requirePermission } from "../../middleware/tenant.js";
import { ensureContactAssignment } from "../../services/contact.service.js";
import { PERMISSIONS } from "../../services/permission.service.js";

export const messageRoutes = new Hono();

/**
 * GET /conversations/:id/messages - Get messages for a conversation/contact
 * Query params: limit, cursor (for pagination)
 */
messageRoutes.get("/:id/messages", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.param("id");
  const { limit } = extractPaginationParams(c);
  const cursor = c.req.query("cursor"); // Message ID for cursor pagination

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

  // Get quoted messages if any (for reply functionality)
  const quotedIds = messages
    .filter((m) => m.quoted_message_id)
    .map((m) => m.quoted_message_id as string);

  let quotedMessagesMap = new Map<
    string,
    ReturnType<typeof buildQuotedMessageData>
  >();
  if (quotedIds.length > 0) {
    const quoted = await tenantDb
      .selectFrom("messages")
      .selectAll()
      .where("message_id", "in", quotedIds)
      .execute();

    quotedMessagesMap = new Map(
      quoted
        .filter((q) => q.message_id !== null)
        .map((q) => [
          q.message_id as string,
          buildQuotedMessageData(q as MessageDbRow),
        ]),
    );
  }

  // Get reactions for all messages
  const messageIds = messages.map((m) => m.id);
  const reactionsMap = new Map<string, ReactionData[]>();
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

  // Map to frontend format using shared formatter
  const formattedMessages = formatMessagesForConversation(
    messages as MessageDbRow[],
    quotedMessagesMap,
    reactionsMap,
  );

  return c.json({
    messages: formattedMessages,
    hasMore: messages.length === limit,
    nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
  });
});

/**
 * POST /conversations/:id/messages - Send a new message
 * Requires can_send_messages permission
 */
messageRoutes.post(
  "/:id/messages",
  requirePermission(PERMISSIONS.CAN_SEND_MESSAGES),
  async (c) => {
    const { tenantDb, user, companyId } = getRouteContext(c);
    const contactId = c.req.param("id");
    const body = await c.req.json();

    const { content, messageType = "text", mediaUrl, replyToMessageId } = body;

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
        contact_id: contactId,
        whatsapp_connection_id: connection.id,
        message_id: waMessageId,
        from_me: true,
        sender_jid: null,
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
      mediaUrl,
      quotedWaMessageId,
      quotedSenderJid,
    );

    return c.json({
      success: true,
      message: {
        id: messageId,
        messageId: waMessageId,
        conversationId: contactId,
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
