import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import { Hono } from "hono";
import { channelAdapterRegistry } from "../channel-spine/registry.js";
import { notFound } from "../lib/errors.js";
import { successData } from "../lib/response.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { resolveAdapterCapabilities } from "../channel-spine/application/adapter-registry.js";
import { getChannelSpineWorkspaceAuthority } from "../services/channel-spine-authority.service.js";

export const channelAccountRoutes = new Hono();
channelAccountRoutes.use("/*", authMiddleware);
channelAccountRoutes.use("/*", tenantMiddleware());

channelAccountRoutes.get("/", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  if (
    !(await getChannelSpineWorkspaceAuthority(companyId)).neutralReadsEnabled
  ) {
    return notFound(c, "Channel accounts are not enabled for this workspace");
  }
  const accounts = await tenantDb
    .selectFrom("channel_accounts")
    .select([
      "id",
      "channel",
      "provider",
      "display_name",
      "external_account_id",
      "status",
      "provider_status",
      "connected_at",
      "last_sync_at",
      "created_at",
      "updated_at",
    ])
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();
  return successData(
    c,
    accounts.map((account) => ({
      id: account.id,
      channel: account.channel,
      provider: account.provider,
      displayName: account.display_name,
      externalAccountId: account.external_account_id,
      status: account.status,
      providerStatus: account.provider_status,
      connectedAt: account.connected_at,
      lastSyncAt: account.last_sync_at,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    })),
  );
});

channelAccountRoutes.get("/:id/capabilities", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  if (
    !(await getChannelSpineWorkspaceAuthority(companyId)).neutralReadsEnabled
  ) {
    return notFound(
      c,
      "Channel capabilities are not enabled for this workspace",
    );
  }
  const account = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "channel", "provider"])
    .where("id", "=", c.req.param("id"))
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (
    !account ||
    !isChannel(account.channel) ||
    !isChannelProvider(account.provider)
  ) {
    return notFound(c, "Channel account not found");
  }
  const capabilities = await resolveAdapterCapabilities(
    channelAdapterRegistry,
    account.channel,
    account.provider,
    {
      companyId,
      channelAccountId: account.id,
      now: new Date().toISOString(),
    },
  );
  c.header("Cache-Control", "private, max-age=30");
  c.header("Vary", "X-Company-Id");
  return successData(c, capabilities);
});
