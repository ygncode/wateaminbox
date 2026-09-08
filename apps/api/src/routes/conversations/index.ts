import { Hono } from "hono";
import { successData } from "../../lib/response.js";
import { authMiddleware } from "../../middleware/auth.js";
import { getRouteContext } from "../../middleware/context.js";
import { requireConversationVisibility } from "../../middleware/resource-visibility.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { getChannelSpineWorkspaceAuthority } from "../../services/channel-spine-authority.service.js";
import { neutralActionRoutes } from "./actions.js";
import { analyticsRoutes } from "./analytics.js";
import { messageRoutes } from "./messages.js";
import { metadataRoutes } from "./metadata.js";
import { stateRoutes } from "./state.js";

export const conversationRoutes = new Hono();

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
  const conversations = await tenantDb
    .selectFrom("conversations as conversation")
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
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
      "account.status as account_status",
    ])
    .where("conversation.archived_at", "is", null)
    .where("account.archived_at", "is", null)
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
  return successData(
    c,
    conversations.map((conversation) => ({
      id: conversation.id,
      channelAccountId: conversation.channel_account_id,
      channel: conversation.channel,
      provider: conversation.provider,
      kind: conversation.kind,
      subject: conversation.subject,
      externalThreadId: conversation.external_thread_id,
      firstMessageAt: conversation.first_message_at,
      lastMessageAt: conversation.last_message_at,
      legacyContactId: conversation.legacy_contact_id,
      account: {
        displayName: conversation.account_display_name,
        status: conversation.account_status,
      },
    })),
  );
});

// Analytics paths begin with `/stats`, which Hono also matches as `/:id/*` with
// `id = "stats"`. Mount them before the per-contact visibility middleware so
// aggregate analytics are governed by their dashboard permission instead of a
// bogus contact lookup.
conversationRoutes.route("/", analyticsRoutes);

// Resource routes below this point address a real contact ID.
conversationRoutes.use("/:id/*", requireConversationVisibility());
conversationRoutes.route("/", stateRoutes);
conversationRoutes.route("/", messageRoutes);
conversationRoutes.route("/", metadataRoutes);
conversationRoutes.route("/", neutralActionRoutes);
