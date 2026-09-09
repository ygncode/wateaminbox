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
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { successData } from "../lib/response.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../services/channel-spine-authority.service.js";
import {
  ChannelAccountNotArchivedError,
  purgeArchivedChannelAccount,
} from "../services/channel-account-purge.service.js";
import { countUsedConnectionSlots } from "../services/connection-quota.service.js";
import { getMaxConnections } from "../services/whatsapp/connection.js";
import { isChannelSpineTenantReady } from "../services/channel-spine-readiness.service.js";
import {
  canStoreChannelCredentials,
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
      "provider_metadata",
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
      // A bot with privacy mode on receives no ordinary group messages, so
      // its group inbox stays empty with nothing on screen to explain why.
      canReadAllGroupMessages:
        account.provider_metadata?.canReadAllGroupMessages === true,
      connectedAt: account.connected_at,
      lastSyncAt: account.last_sync_at,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    })),
  );
});

/**
 * What this workspace may connect right now, and why not when it may not.
 *
 * The picker in Settings needs this before a user commits to a provider: a
 * grid that offers Telegram and then fails at submit reads as a broken
 * product. Availability is derived from the same authority the connect route
 * enforces, so the two can never disagree, and it fails closed - an
 * unreadable or missing flag row reports every provider as unavailable.
 */
channelAccountRoutes.get("/providers", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  const neutralWrites = authority.writeAuthority === "neutral";
  const storageReady = neutralWrites
    ? await isChannelSpineTenantReady(tenantDb, companyId)
    : false;
  // A provider that keeps a secret cannot be connected by a process that
  // cannot encrypt one, however the workspace is flagged.
  const canStoreSecrets = canStoreChannelCredentials();
  const providers = [
    {
      channel: "whatsapp" as const,
      provider: "whatsapp_linked_device" as const,
      // Linked device predates the spine and is connected through its own
      // QR pairing flow, which does not depend on any channel-spine flag.
      available: true,
      unavailableReason: null as string | null,
    },
    {
      channel: "telegram" as const,
      provider: "telegram_bot" as const,
      available:
        neutralWrites &&
        isChannelProviderEnabled(authority, "telegram_bot") &&
        storageReady &&
        canStoreSecrets,
      unavailableReason: !neutralWrites
        ? "Channel-neutral writes are not enabled for this workspace"
        : !isChannelProviderEnabled(authority, "telegram_bot")
          ? "Telegram Bot is not enabled for this workspace"
          : !storageReady
            ? "Channel storage indexes are not ready"
            : !canStoreSecrets
              ? "This server has no channel credential encryption key configured"
              : null,
    },
  ];
  return successData(c, providers);
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
    if (!(await isChannelSpineTenantReady(tenantDb, companyId))) {
      return c.json({ error: "Channel storage indexes are not ready" }, 503);
    }
    // Checked before Telegram is contacted, so a misconfigured server never
    // registers a webhook it could not have stored the secret for.
    if (!canStoreChannelCredentials()) {
      return c.json(
        {
          error:
            "This server has no channel credential encryption key configured",
        },
        503,
      );
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
      .select(["id", "status"])
      .where("channel", "=", "telegram")
      .where("provider", "=", "telegram_bot")
      .where("external_scope_id", "=", "telegram-bot")
      .where("external_account_id", "=", String(identity.id))
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (existingAccount?.status === "connected") {
      return c.json({ error: "Telegram bot is already connected" }, 409);
    }

    // The plan sells connection slots, not WhatsApp slots. Reusing the same
    // ceiling here keeps a workspace from adding channel accounts outside the
    // plan it pays for. Reconnecting an account that already exists does not
    // consume a new slot, so only a genuinely new account is counted.
    if (!existingAccount) {
      const maxConnections = await getMaxConnections(companyId);
      const used = await countUsedConnectionSlots(tenantDb);
      if (used >= maxConnections) {
        return c.json(
          {
            error: "Connection limit reached for this plan",
            code: "MAX_CONNECTIONS_EXCEEDED",
            used,
            max: maxConnections,
          },
          402,
        );
      }
    }

    const company = await db
      .selectFrom("companies")
      .select("schema_name")
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const accountId = existingAccount?.id ?? crypto.randomUUID();
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
      if (existingAccount) {
        await trx
          .updateTable("channel_ingress_routes")
          .set({
            state: "revoked",
            revoked_at: new Date(),
            updated_at: new Date(),
          })
          .where("company_id", "=", companyId)
          .where("channel_account_id", "=", accountId)
          .where("state", "!=", "revoked")
          .execute();
        await tenant
          .updateTable("channel_accounts")
          .set({
            display_name: displayName ?? identity.first_name,
            status: "connecting",
            provider_status: null,
            provider_metadata: {
              ...(identity.username ? { username: identity.username } : {}),
              canReadAllGroupMessages:
                identity.can_read_all_group_messages === true,
            },
            updated_at: new Date(),
          })
          .where("id", "=", accountId)
          .execute();
      } else {
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
            provider_metadata: {
              ...(identity.username ? { username: identity.username } : {}),
              // Recorded at connect so the UI can tell the operator their
              // group inbox will stay empty until privacy mode is off.
              canReadAllGroupMessages:
                identity.can_read_all_group_messages === true,
            },
            legacy_whatsapp_connection_id: null,
            connected_by: user.id,
            connected_at: null,
            last_sync_at: null,
            archived_at: null,
          })
          .execute();
      }
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
        .where("state", "=", "pending")
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
  await tenantDb
    .updateTable("channel_accounts")
    .set({ status: "disabled", provider_status: "webhook_removal_pending" })
    .where("id", "=", account.id)
    .execute();
  try {
    await removeTelegramWebhook(botToken);
  } catch {
    await tenantDb
      .updateTable("channel_accounts")
      .set({ status: "connected", provider_status: "webhook_removal_failed" })
      .where("id", "=", account.id)
      .execute();
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

channelAccountRoutes.post("/:id/purge", async (c) => {
  const { tenantDb, role } = getRouteContext(c);
  if (role === "member") return forbidden(c);
  try {
    const purged = await purgeArchivedChannelAccount(
      tenantDb,
      c.req.param("id"),
    );
    return successData(c, purged);
  } catch (error) {
    if (error instanceof ChannelAccountNotArchivedError) {
      return conflict(c, error.message);
    }
    throw error;
  }
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
