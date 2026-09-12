import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  authorizeMessageMedia,
  buildQuotedMessageData,
  formatMessagesForConversation,
  type MessageDbRow,
  type QuotedMessageData,
} from "../../lib/message-formatters.js";
import { loadMessageReactions } from "../../lib/message-reactions.js";
import { successData } from "../../lib/response.js";
import { zValidator } from "../../lib/validator.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  hasContactVisibility,
  requireContactVisibility,
} from "../../middleware/resource-visibility.js";
import {
  type CustomerThread,
  decodeTimelineCursor,
  listCustomerTimeline,
  resolveCustomerThreads,
} from "../../services/customer-timeline.service.js";
import { resolveThreadProvenance } from "../../services/message-provenance.service.js";
import { getUserNames } from "../../services/user.service.js";

export const timelineRoutes = new Hono();

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  channel: z.string().min(1).max(40).optional(),
});

/**
 * GET /contacts/:id/timeline - one history across a customer's threads.
 *
 * A merge combines identity and leaves every conversation where it is, so a
 * merged customer is read here rather than one thread at a time. Nothing about
 * the stored conversations changes; this is a read.
 */
timelineRoutes.get(
  "/:id/timeline",
  requireContactVisibility(),
  zValidator("query", timelineQuerySchema),
  async (c) => {
    const { tenantDb, companyId, permissions } = getRouteContext(c);
    const { limit, cursor: rawCursor, channel } = c.req.valid("query");

    const cursor = rawCursor
      ? (decodeTimelineCursor(rawCursor) ?? undefined)
      : undefined;
    if (rawCursor && !cursor) {
      // Refused rather than ignored: silently answering with the newest page
      // reads as the history jumping to the bottom mid-scroll.
      return badRequest(c, "Invalid cursor");
    }

    const resolved = await resolveCustomerThreads(
      tenantDb,
      companyId,
      c.req.param("id")!,
    );
    if (!resolved) return notFound(c, "Contact");

    // Gated per thread, not per customer. A restricted member assigned to one
    // of a merged customer's threads must not read the others through the
    // timeline - the same rule the chat switcher applies.
    const visible: CustomerThread[] = [];
    for (const thread of resolved.threads) {
      const allowed = thread.contactId
        ? await hasContactVisibility(c, thread.contactId)
        : permissions.can_view_all_chats;
      if (allowed) visible.push(thread);
    }

    const page = await listCustomerTimeline(tenantDb, {
      threads: visible,
      limit,
      cursor,
    });

    const threads = await resolveThreadProvenance(
      tenantDb,
      page.messages
        .map((message) => message.conversation_id)
        .filter((id): id is string => Boolean(id)),
    );
    const kept = channel
      ? page.messages.filter(
          (message) =>
            (message.conversation_id
              ? threads.get(message.conversation_id)?.channel
              : "whatsapp") === channel,
        )
      : page.messages;

    const authorized = await authorizeMessageMedia(
      kept as MessageDbRow[],
      companyId,
    );
    const quotes = await loadThreadScopedQuotes(tenantDb, authorized);
    const reactions = await loadMessageReactions(tenantDb, authorized);
    const userNames = await getUserNames(
      authorized
        .map((message) => message.sent_by_user_id)
        .filter((id): id is string => Boolean(id)),
    );

    return successData(c, {
      // Oldest first, the order the thread renders in.
      messages: formatMessagesForConversation(
        authorized,
        new Map(),
        reactions,
        userNames,
        new Map(),
        threads,
        (message) => quotes.get(message.id) ?? null,
      ).reverse(),
      canonicalContactId: resolved.canonicalContactId,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  },
);

/**
 * The quoted message behind each reply, keyed by the replying message.
 *
 * Keyed by the reply rather than by the quote reference, because a timeline
 * spans threads and two threads can carry the same provider message id. The
 * lookup also refuses to cross threads: a quote is only attached when the
 * quoted row sits in the same conversation as the reply, so a merged view
 * never renders one thread's message as context in another.
 */
async function loadThreadScopedQuotes(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  messages: MessageDbRow[],
): Promise<Map<string, QuotedMessageData>> {
  const rowIds = [
    ...new Set(
      messages
        .map((message) => message.reply_to_message_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const externalIds = [
    ...new Set(
      messages
        .map((message) => message.quoted_message_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (rowIds.length === 0 && externalIds.length === 0) return new Map();

  const candidates = (await tenantDb
    .selectFrom("messages")
    .selectAll()
    .where((eb) =>
      eb.or(
        [
          rowIds.length > 0 ? eb("id", "in", rowIds) : null,
          externalIds.length > 0 ? eb("message_id", "in", externalIds) : null,
        ].filter((clause) => clause !== null),
      ),
    )
    .execute()) as unknown as MessageDbRow[];

  const userNames = await getUserNames(
    candidates
      .map((message) => message.sent_by_user_id)
      .filter((id): id is string => Boolean(id)),
  );

  const quotes = new Map<string, QuotedMessageData>();
  for (const message of messages) {
    const match = candidates.find(
      (candidate) =>
        (message.reply_to_message_id
          ? candidate.id === message.reply_to_message_id
          : false) ||
        (message.quoted_message_id
          ? candidate.message_id === message.quoted_message_id
          : false),
    );
    if (!match) continue;
    if ((match.conversation_id ?? null) !== (message.conversation_id ?? null)) {
      continue;
    }
    quotes.set(message.id, buildQuotedMessageData(match, userNames));
  }
  return quotes;
}
