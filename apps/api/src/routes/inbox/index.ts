import { Hono } from "hono";
import {
  type RawContactFromDb,
  transformContact,
} from "../../lib/data-transformers.js";
import { badRequest } from "../../lib/errors.js";
import { listInboxQuerySchema } from "../../lib/schemas/conversation.js";
import {
  getAuthorizedAvatarUrlOrNull,
  getAuthorizedMediaUrlOrNull,
} from "../../lib/storage.js";
import { zValidator } from "../../lib/validator.js";
import { authMiddleware } from "../../middleware/auth.js";
import { getRouteContext } from "../../middleware/context.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { getChannelSpineWorkspaceAuthority } from "../../services/channel-spine-authority.service.js";
import { resolveConversationCounterparts } from "../../services/conversation-display-name.service.js";
import {
  getInboxPage,
  getInboxUnreadTotal,
  type InboxThreadRow,
} from "../../services/inbox.service.js";
import { decodeInboxCursor } from "../../services/inbox-cursor.js";

/**
 * GET /api/inbox - the unified inbox, newest activity first.
 *
 * One list for every channel: customer rows (WhatsApp linked-device contacts
 * and merged customers) and channel threads with no contact (e.g. Telegram),
 * ordered and paged on the server by an opaque cursor.
 *
 * Response: { data, nextCursor, prevCursor, unreadTotal } - page down with
 * ?cursor=<nextCursor>, back up with ?before=<prevCursor>. `data` items are
 * { type: "contact", contact } with the GET /contacts row
 * shape, or { type: "conversation", conversation } with the
 * GET /conversations row shape - so clients map each with what they have.
 */
export const inboxRoutes = new Hono();

inboxRoutes.use("/*", authMiddleware);
inboxRoutes.use("/*", tenantMiddleware());

inboxRoutes.get("/", zValidator("query", listInboxQuerySchema), async (c) => {
  const { tenantDb, companyId, user, permissions } = getRouteContext(c);
  const query = c.req.valid("query");

  if (query.cursor && query.before) {
    return badRequest(c, "Use either cursor or before, not both");
  }
  const rawCursor = query.cursor ?? query.before;
  const cursor = rawCursor ? decodeInboxCursor(rawCursor) : undefined;
  if (rawCursor && !cursor) {
    return badRequest(c, "Invalid cursor");
  }

  // Channel threads exist only where the spine's neutral reads are enabled;
  // elsewhere the inbox is exactly the customer list, as before.
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  const includeThreads = authority.neutralReadsEnabled;
  const restrictToAssigned = !permissions.can_view_all_chats;
  const filter = query.filter ?? "all";

  const startedAt = performance.now();
  const [page, unreadTotal] = await Promise.all([
    getInboxPage(tenantDb, companyId, {
      search: query.search?.trim() || undefined,
      limit: query.limit,
      cursor: cursor ?? undefined,
      direction: query.before ? "before" : "after",
      includeGroups: query.includeGroups,
      accountId: query.accountId,
      tagIds: query.tagIds,
      assignedToMe: filter === "assignedToMe",
      unassigned: filter === "unassigned",
      unreadOnly: filter === "unread",
      conversationStatus: query.conversationStatus,
      userId: user.id,
      restrictToAssigned,
      includeThreads,
    }),
    // The badge is the first page's companion; later pages do not need it.
    cursor
      ? Promise.resolve(null)
      : getInboxUnreadTotal(tenantDb, companyId, {
          userId: user.id,
          restrictToAssigned,
          includeThreads,
        }),
  ]);
  const databaseDuration = performance.now() - startedAt;

  const threadIds = page.items
    .filter((item) => item.kind === "thread")
    .map((item) => (item.kind === "thread" ? item.thread.id : ""));
  const counterparts = await resolveConversationCounterparts(
    tenantDb,
    threadIds,
  );

  const data = await Promise.all(
    page.items.map(async (item) => {
      if (item.kind === "contact") {
        const contact = {
          ...item.contact,
          profile_picture_url: await getAuthorizedAvatarUrlOrNull(
            item.contact.profile_picture_url,
            companyId,
          ),
        };
        return {
          type: "contact" as const,
          contact: transformContact(contact as unknown as RawContactFromDb),
        };
      }
      return {
        type: "conversation" as const,
        conversation: await presentThread(
          item.thread,
          counterparts.get(item.thread.id),
          companyId,
        ),
      };
    }),
  );

  c.header("Server-Timing", `inbox_db;dur=${databaseDuration.toFixed(1)}`);
  return c.json({
    data,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
    unreadTotal,
  });
});

async function presentThread(
  thread: InboxThreadRow,
  counterpart:
    | {
        displayName: string | null;
        addressDisplay: string | null;
        avatarUrl: string | null;
      }
    | undefined,
  companyId: string,
) {
  return {
    id: thread.id,
    channelAccountId: thread.channel_account_id,
    channel: thread.channel,
    provider: thread.provider,
    kind: thread.kind,
    subject: thread.subject?.trim() || counterpart?.displayName || null,
    externalThreadId: thread.external_thread_id,
    firstMessageAt: thread.first_message_at,
    lastMessageAt: thread.last_message_at,
    lastMessagePreview: thread.last_message_preview,
    unreadCount: Number(thread.unread_count ?? 0),
    conversationStatus: thread.conversation_status ?? "open",
    legacyContactId: null,
    assignedTo: thread.assigned_to,
    account: {
      displayName: thread.account_display_name,
      username: accountUsername(thread.account_provider_metadata),
      status: thread.account_status,
    },
    counterpart: {
      displayName: counterpart?.displayName ?? null,
      addressDisplay: counterpart?.addressDisplay ?? null,
      avatarUrl: await getAuthorizedMediaUrlOrNull(
        counterpart?.avatarUrl,
        companyId,
      ),
    },
  };
}

function accountUsername(metadata: unknown): string | null {
  const username = (metadata as { username?: unknown } | null)?.username;
  return typeof username === "string" && username ? username : null;
}
