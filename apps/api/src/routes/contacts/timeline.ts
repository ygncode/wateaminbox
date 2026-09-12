import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound } from "../../lib/errors.js";
import {
  authorizeMessageMedia,
  formatMessagesForConversation,
  type MessageDbRow,
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
      ).reverse(),
      canonicalContactId: resolved.canonicalContactId,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  },
);
