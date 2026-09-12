import { randomBytes } from "node:crypto";
import { zValidator } from "../lib/validator.js";
import { db, type TenantDatabase } from "@wateaminbox/database";
import { isChannel, isChannelProvider } from "@wateaminbox/shared";
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
  ChannelAccountNotArchivedError,
  purgeArchivedChannelAccount,
} from "../services/channel-account-purge.service.js";
import { createLogger, formatError } from "../lib/logger.js";
import {
  canStoreChannelCredentials,
  ChannelCredentialKeyError,
  readChannelCredential,
  storeChannelCredential,
} from "../services/channel-credential.service.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "../services/channel-spine-authority.service.js";
import { isChannelSpineTenantReady } from "../services/channel-spine-readiness.service.js";
import { countUsedConnectionSlots } from "../services/connection-quota.service.js";
import { getMaxConnections } from "../services/whatsapp/connection.js";

const logger = createLogger("ChannelAccounts");

/**
 * The base a provider calls back on.
 *
 * Separate from `APP_URL` because the two answer different questions: a
 * webhook needs a publicly routable HTTPS address, while `APP_URL` is where a
 * person opens the app - in local development a tunnel and localhost
 * respectively. Sending invite or OAuth links to the tunnel would be wrong,
 * and pointing a webhook at localhost simply never arrives.
 */
function channelIngressBaseUrl(): string {
  return (env.CHANNEL_INGRESS_PUBLIC_URL || env.APP_URL).replace(/\/$/, "");
}

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
      "archived_at",
    ])
    // Archived accounts are listed too. Hiding them removed the account from
    // the connections page while its conversations stayed in the inbox, so a
    // disconnected Telegram bot left threads behind that nothing could clean
    // up - the operator could see the mess and had no way to reach it.
    // A linked-device WhatsApp account is a projection of a row in
    // `whatsapp_connections`, created by dual write and the backfill so the
    // spine has something to hang conversations off. The connections API
    // already returns the same account, so listing it here too made every
    // WhatsApp number appear twice in the inbox picker, the connections page,
    // and the broadcast wizard - as two identical entries with no way to tell
    // which was which. The spine's copy is the internal one, so it is the one
    // that stays hidden.
    .where("legacy_whatsapp_connection_id", "is", null)
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
      // Set once the account has been disconnected. Its threads survive until
      // the account is purged, so the operator needs to see it to clean up.
      archivedAt: account.archived_at,
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

    const webhookUrl = `${channelIngressBaseUrl()}/api/channel-ingress/telegram_bot/${routeKey}`;
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

/**
 * Stop delivery without giving up the account.
 *
 * Unlinking erases the bot token, so the only way back is to fetch it from
 * BotFather again - too much ceremony for "mute this bot over the weekend".
 * Pausing removes the webhook and revokes the ingress route, so Telegram
 * stops sending and a leaked URL stops being honoured, while the credential
 * stays encrypted at rest and the account keeps its conversations, its slot,
 * and its name.
 *
 * Webhook-first and fail-closed, like unlink: the account is marked on its way
 * down before Telegram is asked, and a refusal puts it back rather than
 * leaving a row that claims to be paused while updates still arrive.
 */
channelAccountRoutes.post("/:id/disconnect", async (c) => {
  const { tenantDb, companyId, role } = getRouteContext(c);
  if (role === "member") return forbidden(c);
  const account = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "provider", "status", "archived_at"])
    .where("id", "=", c.req.param("id"))
    .executeTakeFirst();
  if (!account || account.archived_at) return notFound(c, "Channel account");
  if (account.provider !== "telegram_bot") {
    return c.json({ error: "Use the provider-specific disconnect flow" }, 400);
  }
  if (account.status === "disabled") {
    return conflict(c, "Channel account is already disconnected");
  }
  const botToken = await readChannelCredential(
    tenantDb,
    companyId,
    account.id,
    "telegram_bot_token",
  );
  if (!botToken)
    return c.json({ error: "Channel credential unavailable" }, 503);
  const previousStatus = account.status;
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
      .set({
        status: previousStatus,
        provider_status: "webhook_removal_failed",
      })
      .where("id", "=", account.id)
      .execute();
    return c.json({ error: "Telegram webhook removal failed" }, 502);
  }
  await db.transaction().execute(async (trx) => {
    const company = await trx
      .selectFrom("companies")
      .select("schema_name")
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
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
        status: "disabled",
        // Cleared, not left at the in-flight value: a paused account is at
        // rest, and a row still reading "removal pending" reads as stuck.
        provider_status: null,
        connected_at: null,
        updated_at: new Date(),
      })
      .where("id", "=", account.id)
      .execute();
  });
  return c.json({ success: true });
});

/**
 * Put a paused bot back to work.
 *
 * This is the connect flow without the parts that only apply to a new
 * account: no identity call, no quota check (a paused account never released
 * its slot), no new row. What it does repeat is the rotation - the stored
 * route key is a one-way hash, so the old webhook URL cannot be rebuilt even
 * in principle, and resuming mints a fresh key and secret. Rotating is the
 * only option available and also the better one: a URL that leaked while the
 * account was paused never becomes live again.
 */
channelAccountRoutes.post("/:id/resume", async (c) => {
  const { tenantDb, companyId, role } = getRouteContext(c);
  if (role === "member") return forbidden(c);
  const account = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "provider", "status", "archived_at"])
    .where("id", "=", c.req.param("id"))
    .executeTakeFirst();
  if (!account || account.archived_at) return notFound(c, "Channel account");
  if (account.provider !== "telegram_bot") {
    return c.json({ error: "Use the provider-specific connect flow" }, 400);
  }
  if (account.status === "connected") {
    return conflict(c, "Channel account is already connected");
  }
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  if (
    authority.writeAuthority !== "neutral" ||
    !isChannelProviderEnabled(authority, "telegram_bot")
  ) {
    return notFound(c, "Telegram Bot is not enabled for this workspace");
  }
  // Resuming stores a fresh webhook secret, so a server that cannot encrypt
  // one must say so before Telegram is told about a route we cannot honour.
  if (!canStoreChannelCredentials()) {
    return c.json(
      {
        error:
          "This server has no channel credential encryption key configured",
      },
      503,
    );
  }
  const botToken = await readChannelCredential(
    tenantDb,
    companyId,
    account.id,
    "telegram_bot_token",
  );
  // An account paused before the credential outlived the pause, or one whose
  // keyring has since changed, cannot be resumed - only unlinked and
  // reconnected with the token again. Say that rather than throwing.
  if (!botToken) {
    return c.json(
      {
        error:
          "The stored bot token is unavailable. Unlink this account and connect the bot again.",
      },
      409,
    );
  }

  const company = await db
    .selectFrom("companies")
    .select("schema_name")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
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
        status: "connecting",
        provider_status: null,
        updated_at: new Date(),
      })
      .where("id", "=", account.id)
      .execute();
    await storeChannelCredential(
      tenant,
      companyId,
      account.id,
      "telegram_webhook_secret",
      webhookSecret,
    );
    await trx
      .insertInto("channel_ingress_routes")
      .values({
        provider: "telegram_bot",
        route_key_hash: Buffer.from(routeHash).toString("hex"),
        company_id: companyId,
        channel_account_id: account.id,
        state: "pending",
        revoked_at: null,
      })
      .execute();
  });

  const webhookUrl = `${channelIngressBaseUrl()}/api/channel-ingress/telegram_bot/${routeKey}`;
  try {
    await configureTelegramWebhook(botToken, webhookUrl, webhookSecret);
  } catch {
    await tenantDb
      .updateTable("channel_accounts")
      .set({ status: "error", provider_status: "webhook_configuration_failed" })
      .where("id", "=", account.id)
      .execute();
    return c.json({ error: "Telegram webhook configuration failed" }, 502);
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
      .where("id", "=", account.id)
      .execute();
    await trx
      .updateTable("channel_ingress_routes")
      .set({ state: "active", updated_at: new Date() })
      .where("company_id", "=", companyId)
      .where("channel_account_id", "=", account.id)
      .where("state", "=", "pending")
      .execute();
  });
  return c.json({ success: true });
});

const renameChannelAccountSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

/**
 * PATCH /channel-accounts/:id - rename the account.
 *
 * The display name is ours, not the provider's: Telegram hands back the bot's
 * own first_name at connect time, which is what the bot is called in Telegram
 * and rarely what the workspace calls the inbox it feeds. A linked WhatsApp
 * number has been renameable since it shipped, and an inbox that lets you
 * name one of its two accounts reads as an oversight rather than a rule.
 *
 * Only the name moves. Nothing here touches the provider, the credential, or
 * the ingress route, so a rename cannot fail halfway and leave the account in
 * a state the provider disagrees with.
 */
channelAccountRoutes.patch(
  "/:id",
  zValidator("json", renameChannelAccountSchema),
  async (c) => {
    const { tenantDb, role } = getRouteContext(c);
    if (role === "member") return forbidden(c);
    const { displayName } = c.req.valid("json");
    const account = await tenantDb
      .selectFrom("channel_accounts")
      .select(["id", "archived_at"])
      .where("id", "=", c.req.param("id"))
      .executeTakeFirst();
    // An archived account is gone as far as the workspace is concerned; it is
    // listed nowhere and renaming it would only edit history.
    if (!account || account.archived_at) return notFound(c, "Channel account");
    const updated = await tenantDb
      .updateTable("channel_accounts")
      .set({ display_name: displayName, updated_at: new Date() })
      .where("id", "=", account.id)
      .returning([
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
      .executeTakeFirstOrThrow();
    return successData(c, {
      id: updated.id,
      channel: updated.channel,
      provider: updated.provider,
      displayName: updated.display_name,
      externalAccountId: updated.external_account_id,
      status: updated.status,
      providerStatus: updated.provider_status,
      canReadAllGroupMessages:
        updated.provider_metadata?.canReadAllGroupMessages === true,
      connectedAt: updated.connected_at,
      lastSyncAt: updated.last_sync_at,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    });
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
  // An unreadable credential must not trap the account here. Removal is the
  // one action an operator still needs when the key that sealed a token is
  // gone, and refusing it leaves the workspace unable to disconnect or to
  // connect a replacement - the account becomes permanent.
  let botToken: string | null = null;
  try {
    botToken = await readChannelCredential(
      tenantDb,
      companyId,
      account.id,
      "telegram_bot_token",
    );
  } catch (error) {
    if (!(error instanceof ChannelCredentialKeyError)) throw error;
    logger.warn(
      { err: formatError(error), companyId, channelAccountId: account.id },
      "Removing a Telegram account whose credentials cannot be read",
    );
  }
  await tenantDb
    .updateTable("channel_accounts")
    .set({ status: "disabled", provider_status: "webhook_removal_pending" })
    .where("id", "=", account.id)
    .execute();
  // Without a token there is nothing to call Telegram with, so the webhook is
  // left registered on their side and reported rather than silently assumed
  // gone. Its deliveries stop at the ingress route revoked below.
  let webhookRemoved = false;
  if (botToken) {
    try {
      await removeTelegramWebhook(botToken);
      webhookRemoved = true;
    } catch {
      await tenantDb
        .updateTable("channel_accounts")
        .set({ status: "connected", provider_status: "webhook_removal_failed" })
        .where("id", "=", account.id)
        .execute();
      return c.json({ error: "Telegram webhook removal failed" }, 502);
    }
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
        // The removal did succeed to reach this line, so the in-flight flag
        // set on the way in has to come back off; left behind, an archived
        // row reads as permanently mid-operation.
        provider_status: null,
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
  return c.json({
    success: true,
    // False when the credential could not be read: the account is gone from
    // this workspace, but the operator still has to revoke the bot's webhook
    // (or the whole bot) with the provider.
    webhookRemoved,
  });
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
