import { Hono } from "hono";
import { successData } from "../../lib/response.js";
import { getAuthorizedMediaUrlOrNull } from "../../lib/storage.js";
import { authMiddleware } from "../../middleware/auth.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireConversationVisibility } from "../../middleware/resource-visibility.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { getChannelSpineWorkspaceAuthority } from "../../services/channel-spine-authority.service.js";
import {
  type ConversationCounterpart,
  resolveConversationCounterpart,
  resolveConversationCounterparts,
  resolveConversationDisplayName,
} from "../../services/conversation-display-name.service.js";
import { neutralActionRoutes } from "./actions.js";
import { analyticsRoutes } from "./analytics.js";
import { conversationAssignmentRoutes } from "./assignment.js";
import { messageRoutes } from "./messages.js";
import { metadataRoutes } from "./metadata.js";
import { stateRoutes } from "./state.js";

export const conversationRoutes = new Hono();

/**
 * Tag ids arrive as a comma-separated query parameter. Anything that is not a
 * UUID is dropped rather than passed on: the value is user-supplied and
 * reaches an IN list.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// All conversation routes require authentication and tenant context.
conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", tenantMiddleware());

conversationRoutes.get("/", async (c) => {
  const { tenantDb, companyId, user, permissions } = getRouteContext(c);
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  if (!authority.neutralReadsEnabled) {
    return c.json({ error: "Neutral conversations are not enabled" }, 404);
  }
  const requestedLimit = Number(c.req.query("limit") ?? "50");
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(100, Math.max(1, requestedLimit))
    : 50;
  // A channel conversation has no legacy contact, so its tags live on the
  // conversation rather than on a contact. The chat list's tag filter is
  // contact-scoped and so never matched one: selecting a tag left every
  // Telegram chat in the list whether or not it carried that tag.
  const tagIds = (c.req.query("tagIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID_PATTERN.test(value));
  const conversations = await tenantDb
    .selectFrom("conversations as conversation")
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
    )
    .leftJoin(
      "conversation_states as state",
      "state.conversation_id",
      "conversation.id",
    )
    .select([
      "conversation.id",
      "conversation.channel_account_id",
      "conversation.kind",
      "conversation.subject",
      "conversation.external_thread_id",
      "conversation.first_message_at",
      "conversation.last_message_at",
      "conversation.legacy_contact_id",
      "account.channel",
      "account.provider",
      "account.display_name as account_display_name",
      "account.provider_metadata as account_provider_metadata",
      "account.status as account_status",
      "state.unread_count",
      "state.last_message_preview",
      "state.status as conversation_status",
    ])
    .where("conversation.archived_at", "is", null)
    .where("account.archived_at", "is", null)
    // A linked-device WhatsApp conversation is a mirror of a legacy contact
    // thread, created by dual write and the backfill. The contacts and chats
    // endpoints already serve those threads, so returning them here listed
    // every WhatsApp chat a second time - with no preview, because the mirror
    // carries no message text - and, far worse, buried the real channel
    // conversations: one workspace ended up with 2,227 mirrors against 2
    // Telegram threads, so Telegram fell outside the page entirely and its
    // inbox looked empty.
    //
    // This surface stays channel-only until WhatsApp actually reads through
    // the spine. Removing the filter is part of that switch, not before it.
    .where("account.legacy_whatsapp_connection_id", "is", null)
    // A thread whose customer was merged away belongs to the surviving
    // customer's row, which the contacts list already returns. Listing it here
    // too puts the same person in the inbox twice - once as themselves and
    // once as the record they were merged into - because the two lists are
    // reconciled on ids the merge deliberately leaves alone.
    .where((eb) =>
      eb.or([
        eb("conversation.legacy_contact_id", "is", null),
        eb.not(
          eb.exists(
            eb
              .selectFrom("contacts as merged")
              .select("merged.id")
              .whereRef("merged.id", "=", "conversation.legacy_contact_id")
              .where("merged.merged_into_contact_id", "is not", null),
          ),
        ),
      ]),
    )
    .$if(tagIds.length > 0, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom("conversation_tags as link")
            .select("link.tag_id")
            .whereRef("link.conversation_id", "=", "conversation.id")
            .where("link.tag_id", "in", tagIds),
        ),
      ),
    )
    .$if(!permissions.can_view_all_chats, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom("contact_assignments as assignment")
            .select("assignment.id")
            .where("assignment.assigned_to", "=", user.id)
            .where("assignment.unassigned_at", "is", null)
            .where((inner) =>
              inner.or([
                inner(
                  "assignment.conversation_id",
                  "=",
                  eb.ref("conversation.id"),
                ),
                inner(
                  "assignment.contact_id",
                  "=",
                  eb.ref("conversation.legacy_contact_id"),
                ),
              ]),
            ),
        ),
      ),
    )
    .orderBy("conversation.last_message_at", "desc")
    .orderBy("conversation.id", "desc")
    .limit(limit)
    .execute();
  // A direct conversation usually carries no subject; its name is on the
  // counterpart's endpoint. Resolved in one batch rather than per row.
  const counterparts = await resolveConversationCounterparts(
    tenantDb,
    conversations.map((conversation) => conversation.id),
  );
  // Signed in one pass; the list renders an avatar per row and the client is
  // never handed a bucket path.
  const avatarUrls = new Map<string, string | null>(
    await Promise.all(
      [...counterparts].map(
        async ([conversationId, counterpart]) =>
          [
            conversationId,
            await getAuthorizedMediaUrlOrNull(counterpart.avatarUrl, companyId),
          ] as const,
      ),
    ),
  );
  return successData(
    c,
    conversations.map((conversation) => ({
      id: conversation.id,
      channelAccountId: conversation.channel_account_id,
      channel: conversation.channel,
      provider: conversation.provider,
      kind: conversation.kind,
      subject:
        conversation.subject?.trim() ||
        counterparts.get(conversation.id)?.displayName ||
        null,
      externalThreadId: conversation.external_thread_id,
      firstMessageAt: conversation.first_message_at,
      lastMessageAt: conversation.last_message_at,
      lastMessagePreview: conversation.last_message_preview,
      unreadCount: Number(conversation.unread_count ?? 0),
      conversationStatus: conversation.conversation_status ?? "open",
      legacyContactId: conversation.legacy_contact_id,
      account: {
        displayName: conversation.account_display_name,
        // The handle the provider knows this account by, so a composer can say
        // which account a reply leaves on rather than naming the customer.
        username: accountUsername(conversation.account_provider_metadata),
        status: conversation.account_status,
      },
      counterpart: {
        displayName: counterparts.get(conversation.id)?.displayName ?? null,
        addressDisplay:
          counterparts.get(conversation.id)?.addressDisplay ?? null,
        avatarUrl: avatarUrls.get(conversation.id) ?? null,
      },
    })),
  );
});

// Analytics paths begin with `/stats`, which Hono also matches as `/:id/*` with
// `id = "stats"`. Mount them before the per-contact visibility middleware so
// aggregate analytics are governed by their dashboard permission instead of a
// bogus contact lookup.
conversationRoutes.route("/", analyticsRoutes);

conversationRoutes.get("/:id", requireConversationVisibility(), async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  if (!authority.neutralReadsEnabled) {
    return c.json({ error: "Neutral conversations are not enabled" }, 404);
  }
  const id = c.req.param("id")!;
  const conversation = await tenantDb
    .selectFrom("conversations as conversation")
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
    )
    .leftJoin(
      "conversation_states as state",
      "state.conversation_id",
      "conversation.id",
    )
    .select([
      "conversation.id",
      "conversation.channel_account_id",
      "conversation.kind",
      "conversation.subject",
      "conversation.external_thread_id",
      "conversation.first_message_at",
      "conversation.last_message_at",
      "conversation.legacy_contact_id",
      "account.channel",
      "account.provider",
      "account.display_name as account_display_name",
      "account.provider_metadata as account_provider_metadata",
      "account.status as account_status",
      "state.unread_count",
      "state.last_message_preview",
      "state.status as conversation_status",
    ])
    .where("conversation.archived_at", "is", null)
    .where("account.archived_at", "is", null)
    // A linked-device WhatsApp conversation is a mirror of a legacy contact
    // thread, created by dual write and the backfill. The contacts and chats
    // endpoints already serve those threads, so returning them here listed
    // every WhatsApp chat a second time - with no preview, because the mirror
    // carries no message text - and, far worse, buried the real channel
    // conversations: one workspace ended up with 2,227 mirrors against 2
    // Telegram threads, so Telegram fell outside the page entirely and its
    // inbox looked empty.
    //
    // This surface stays channel-only until WhatsApp actually reads through
    // the spine. Removing the filter is part of that switch, not before it.
    .where("account.legacy_whatsapp_connection_id", "is", null)
    .where((eb) =>
      eb.or([
        eb("conversation.id", "=", id),
        eb("conversation.legacy_contact_id", "=", id),
      ]),
    )
    .executeTakeFirst();
  if (!conversation) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  return successData(c, {
    id: conversation.id,
    channelAccountId: conversation.channel_account_id,
    channel: conversation.channel,
    provider: conversation.provider,
    kind: conversation.kind,
    subject: await resolveConversationDisplayName(
      tenantDb,
      conversation.id,
      conversation.subject,
    ),
    externalThreadId: conversation.external_thread_id,
    firstMessageAt: conversation.first_message_at,
    lastMessageAt: conversation.last_message_at,
    lastMessagePreview: conversation.last_message_preview,
    unreadCount: Number(conversation.unread_count ?? 0),
    conversationStatus: conversation.conversation_status ?? "open",
    legacyContactId: conversation.legacy_contact_id,
    account: {
      displayName: conversation.account_display_name,
      username: accountUsername(conversation.account_provider_metadata),
      status: conversation.account_status,
    },
    counterpart: await authorizeCounterpartAvatar(
      companyId,
      await resolveConversationCounterpart(tenantDb, conversation.id),
    ),
  });
});

/**
 * Avatars are stored as private object references. The client is handed a
 * short-lived signed URL, never the bucket path.
 */
async function authorizeCounterpartAvatar(
  companyId: string,
  counterpart: ConversationCounterpart | null,
): Promise<ConversationCounterpart | null> {
  if (!counterpart) return null;
  return {
    ...counterpart,
    avatarUrl: await getAuthorizedMediaUrlOrNull(
      counterpart.avatarUrl,
      companyId,
    ),
  };
}

// Resource routes below this point address a real contact ID.
conversationRoutes.use("/:id/*", requireConversationVisibility());
conversationRoutes.route("/", stateRoutes);
conversationRoutes.route("/", conversationAssignmentRoutes);
conversationRoutes.route("/", messageRoutes);
conversationRoutes.route("/", metadataRoutes);
conversationRoutes.route("/", neutralActionRoutes);

/** The provider handle stored when the account was connected, if any. */
function accountUsername(metadata: unknown): string | null {
  const username = (metadata as { username?: unknown } | null)?.username;
  return typeof username === "string" && username ? username : null;
}
