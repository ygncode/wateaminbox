import { db } from "@wateaminbox/database";
import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { applyNormalizedChannelEvent } from "../channel-spine/application/event-processor.js";
import { channelAdapterRegistry } from "../channel-spine/registry.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../services/channel-spine-authority.service.js";
import { getTenantConnection } from "../services/tenant.service.js";

const MAX_INGRESS_BYTES = 1_048_576;
export const channelIngressRoutes = new Hono();

channelIngressRoutes.post("/:provider/:routeKey", async (c) => {
  const provider = c.req.param("provider");
  const routeKey = c.req.param("routeKey");
  if (!isChannelProvider(provider) || !validRouteKey(routeKey)) {
    throw new HTTPException(404, {
      message: "Channel ingress route not found",
    });
  }
  const route = await db
    .selectFrom("channel_ingress_routes")
    .select(["company_id", "channel_account_id", "state"])
    .where("provider", "=", provider)
    .where(
      "route_key_hash",
      "=",
      createHash("sha256").update(routeKey).digest("hex"),
    )
    .where("state", "=", "active")
    .executeTakeFirst();
  if (!route) {
    throw new HTTPException(404, {
      message: "Channel ingress route not found",
    });
  }
  const authority = await getChannelSpineWorkspaceAuthority(route.company_id);
  if (
    authority.writeAuthority !== "neutral" ||
    !isChannelProviderEnabled(authority, provider)
  ) {
    throw new HTTPException(404, {
      message: "Channel ingress route not found",
    });
  }

  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_INGRESS_BYTES) {
    throw new HTTPException(413, {
      message: "Channel ingress body is too large",
    });
  }
  const rawBody = new Uint8Array(await c.req.arrayBuffer());
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_INGRESS_BYTES) {
    throw new HTTPException(413, {
      message: "Channel ingress body is invalid",
    });
  }

  const tenantDb = await getTenantConnection(route.company_id);
  const account = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "channel", "provider", "archived_at"])
    .where("id", "=", route.channel_account_id)
    .executeTakeFirst();
  if (
    !account ||
    account.archived_at ||
    !isChannel(account.channel) ||
    !isChannelProvider(account.provider) ||
    account.provider !== provider
  ) {
    throw new HTTPException(404, {
      message: "Channel ingress route not found",
    });
  }

  let events;
  try {
    events = await channelAdapterRegistry
      .get(account.channel, account.provider)
      .verifyAndNormalizeIngress({
        rawBody,
        headers: Object.fromEntries(c.req.raw.headers.entries()),
        receivedAt: new Date().toISOString(),
        trustedContext: {
          companyId: route.company_id,
          channelAccountId: route.channel_account_id,
        },
      });
  } catch {
    throw new HTTPException(401, {
      message: "Channel ingress verification failed",
    });
  }

  for (const event of events) {
    // Never put transient activity on a company-wide channel: that would leak
    // conversation activity across assignment-based visibility boundaries.
    await applyNormalizedChannelEvent(tenantDb, event);
  }
  return c.json({ ok: true });
});

function validRouteKey(routeKey: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(routeKey);
}
