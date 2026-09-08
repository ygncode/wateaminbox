import { zValidator } from "@hono/zod-validator";
import { db, type TenantDatabase } from "@wateaminbox/database";
import { isChannel, isChannelProvider } from "@wateaminbox/shared";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Transaction } from "kysely";
import { z } from "zod";
import { resolveAdapterCapabilities } from "../channel-spine/application/adapter-registry.js";
import {
  configureTelegramWebhook,
  getTelegramBotIdentity,
  removeTelegramWebhook,
} from "../channel-spine/providers/telegram-bot/api.js";
import { channelAdapterRegistry } from "../channel-spine/registry.js";
import { env } from "../lib/env.js";
import { forbidden, notFound } from "../lib/errors.js";
import { successData } from "../lib/response.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../services/channel-spine-authority.service.js";
import {
  readChannelCredential,
  storeChannelCredential,
} from "../services/channel-credential.service.js";

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

const connectTelegramSchema = z.object({
  botToken: z.string().regex(/^\d{5,16}:[A-Za-z0-9_-]{30,128}$/),
  displayName: z.string().trim().min(1).max(100).optional(),
});

channelAccountRoutes.post(
  "/telegram-bot",
  zValidator("json", connectTelegramSchema),
  async (c) => {
    const { tenantDb, companyId, role, user } = getRouteContext(c);
    if (role === "member") return forbidden(c);
    const authority = await getChannelSpineWorkspaceAuthority(companyId);
    if (
      authority.writeAuthority !== "neutral" ||
      !isChannelProviderEnabled(authority, "telegram_bot")
    ) {
      return notFound(c, "Telegram Bot is not enabled for this workspace");
    }
    const { botToken, displayName } = c.req.valid("json");
    let identity;
    try {
      identity = await getTelegramBotIdentity(botToken);
    } catch {
      return c.json({ error: "Telegram rejected the bot credential" }, 400);
    }

    const existingAccount = await tenantDb
      .selectFrom("channel_accounts")
      .select("id")
      .where("channel", "=", "telegram")
      .where("provider", "=", "telegram_bot")
      .where("external_scope_id", "=", "telegram-bot")
      .where("external_account_id", "=", String(identity.id))
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (existingAccount) {
      return c.json({ error: "Telegram bot is already connected" }, 409);
    }

    const company = await db
      .selectFrom("companies")
      .select("schema_name")
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const accountId = crypto.randomUUID();
    const routeKey = randomBytes(32).toString("base64url");
    const webhookSecret = randomBytes(32).toString("base64url");
    const routeHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(routeKey),
    );
    await db.transaction().execute(async (trx) => {
      const tenant = trx.withSchema(
        company.schema_name,
      ) as unknown as Transaction<TenantDatabase>;
      await tenant
        .insertInto("channel_accounts")
        .values({
          id: accountId,
          channel: "telegram",
          provider: "telegram_bot",
          display_name: displayName ?? identity.first_name,
          external_account_id: String(identity.id),
          external_scope_id: "telegram-bot",
          status: "connecting",
          provider_status: null,
          capabilities_revision: "telegram-bot:v1",
          provider_metadata: identity.username
            ? { username: identity.username }
            : {},
          legacy_whatsapp_connection_id: null,
          connected_by: user.id,
          connected_at: null,
          last_sync_at: null,
          archived_at: null,
        })
        .execute();
      await storeChannelCredential(
        tenant,
        companyId,
        accountId,
        "telegram_bot_token",
        botToken,
      );
      await storeChannelCredential(
        tenant,
        companyId,
        accountId,
        "telegram_webhook_secret",
        webhookSecret,
      );
      await trx
        .insertInto("channel_ingress_routes")
        .values({
          provider: "telegram_bot",
          route_key_hash: Buffer.from(routeHash).toString("hex"),
          company_id: companyId,
          channel_account_id: accountId,
          state: "pending",
          revoked_at: null,
        })
        .execute();
    });

    const webhookUrl = `${env.APP_URL.replace(/\/$/, "")}/api/channel-ingress/telegram_bot/${routeKey}`;
    try {
      await configureTelegramWebhook(botToken, webhookUrl, webhookSecret);
    } catch {
      const tenantDb = getRouteContext(c).tenantDb;
      await tenantDb
        .updateTable("channel_accounts")
        .set({
          status: "error",
          provider_status: "webhook_configuration_failed",
        })
        .where("id", "=", accountId)
        .execute();
      return c.json(
        { error: "Telegram webhook configuration failed", accountId },
        502,
      );
    }

    await db.transaction().execute(async (trx) => {
      const tenant = trx.withSchema(
        company.schema_name,
      ) as unknown as Transaction<TenantDatabase>;
      await tenant
        .updateTable("channel_accounts")
        .set({
          status: "connected",
          connected_at: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", accountId)
        .execute();
      await trx
        .updateTable("channel_ingress_routes")
        .set({ state: "active", updated_at: new Date() })
        .where("company_id", "=", companyId)
        .where("channel_account_id", "=", accountId)
        .execute();
    });
    return successData(
      c,
      {
        id: accountId,
        channel: "telegram",
        provider: "telegram_bot",
        displayName: displayName ?? identity.first_name,
        username: identity.username ?? null,
        status: "connected",
      },
      201,
    );
  },
);

channelAccountRoutes.delete("/:id", async (c) => {
  const { tenantDb, companyId, role } = getRouteContext(c);
  if (role === "member") return forbidden(c);
  const account = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "provider", "archived_at"])
    .where("id", "=", c.req.param("id"))
    .executeTakeFirst();
  if (!account || account.archived_at) return notFound(c, "Channel account");
  if (account.provider !== "telegram_bot") {
    return c.json({ error: "Use the provider-specific disconnect flow" }, 400);
  }
  const botToken = await readChannelCredential(
    tenantDb,
    companyId,
    account.id,
    "telegram_bot_token",
  );
  if (!botToken)
    return c.json({ error: "Channel credential unavailable" }, 503);
  try {
    await removeTelegramWebhook(botToken);
  } catch {
    return c.json({ error: "Telegram webhook removal failed" }, 502);
  }
  const company = await db
    .selectFrom("companies")
    .select("schema_name")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  await db.transaction().execute(async (trx) => {
    const tenant = trx.withSchema(
      company.schema_name,
    ) as unknown as Transaction<TenantDatabase>;
    await trx
      .updateTable("channel_ingress_routes")
      .set({ state: "revoked", revoked_at: new Date(), updated_at: new Date() })
      .where("company_id", "=", companyId)
      .where("channel_account_id", "=", account.id)
      .where("state", "!=", "revoked")
      .execute();
    await tenant
      .updateTable("channel_accounts")
      .set({
        status: "archived",
        archived_at: new Date(),
        updated_at: new Date(),
      })
      .where("id", "=", account.id)
      .execute();
    await tenant
      .deleteFrom("channel_account_credentials")
      .where("channel_account_id", "=", account.id)
      .execute();
  });
  return c.json({ success: true });
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
