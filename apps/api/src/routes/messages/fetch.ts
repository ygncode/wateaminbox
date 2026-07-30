/**
 * Message Fetch Routes
 *
 * Routes for fetching and listing messages.
 */
import { Hono } from "hono";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  formatMessagesForFetch,
  type MessageDbRow,
  type QuotedMessageSimple,
} from "../../lib/message-formatters.js";
import { loadMessageReactions } from "../../lib/message-reactions.js";
import { extractPaginationParams } from "../../lib/route-helpers.js";
import { getRouteContext } from "../../middleware/context.js";
import { hasContactVisibility } from "../../middleware/resource-visibility.js";
import {
  getUserAvatarSources,
  getUserNames,
} from "../../services/user.service.js";

export const fetchRoutes = new Hono();

/**
 * GET / - Get messages for a contact
 * Query params: contactId (required), limit, before (cursor for pagination)
 */
fetchRoutes.get("/", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const contactId = c.req.query("contactId");
  const { limit } = extractPaginationParams(c, 50);
  const before = c.req.query("before"); // Message ID for cursor pagination

  if (!contactId) {
    return badRequest(c, "contactId is required");
  }
  if (!(await hasContactVisibility(c, contactId))) {
    return notFound(c, "Contact");
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
  const senderUserIds = messages
    .map((message) => message.sent_by_user_id)
    .filter((id): id is string => Boolean(id));
  const [userNames, userAvatarSources] = await Promise.all([
    getUserNames(senderUserIds),
    getUserAvatarSources(senderUserIds),
  ]);

  // Get quoted messages if any
  const quotedIds = messages
    .filter((m) => m.quoted_message_id)
    .map((m) => m.quoted_message_id as string);

  let quotedMessages = new Map<string, QuotedMessageSimple>();
  if (quotedIds.length > 0) {
    const connectionIds = [
      ...new Set(messages.map((message) => message.whatsapp_connection_id)),
    ];
    const quoted = await tenantDb
      .selectFrom("messages")
      .select(["message_id", "content", "message_type", "sender_jid"])
      .where("message_id", "in", quotedIds)
      .where("whatsapp_connection_id", "in", connectionIds)
      .execute();

    quotedMessages = new Map(
      quoted
        .filter((q) => q.message_id !== null)
        .map((q) => [q.message_id as string, q]),
    );
  }

  const reactionsMap = await loadMessageReactions(
    tenantDb,
    messages as MessageDbRow[],
  );

  // Return in chronological order (oldest first for display)
  const sortedMessages = messages.reverse();

  // Format messages using shared formatter
  const formattedMessages = formatMessagesForFetch(
    sortedMessages as MessageDbRow[],
    quotedMessages,
    reactionsMap,
    userNames,
    userAvatarSources,
  );

  return c.json({
    data: formattedMessages,
    pagination: {
      limit,
      hasMore: messages.length === limit,
      nextCursor: messages.length > 0 ? messages[0].id : null,
    },
  });
});

/**
 * GET /starred - Get all starred messages
 */
fetchRoutes.get("/starred", async (c) => {
  const { tenantDb, user, permissions } = getRouteContext(c);
  const { limit, offset } = extractPaginationParams(c, 50);

  let query = tenantDb
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
    .where("messages.is_starred", "=", true);

  if (!permissions.can_view_all_chats) {
    query = query.innerJoin("contact_assignments", (join) =>
      join
        .onRef("contact_assignments.contact_id", "=", "messages.contact_id")
        .on("contact_assignments.assigned_to", "=", user.id)
        .on("contact_assignments.unassigned_at", "is", null),
    );
  }

  const messages = await query
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
