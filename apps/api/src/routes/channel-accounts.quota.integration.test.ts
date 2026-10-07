import { describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { env } from "../lib/env.js";
import { hashPassword } from "../lib/password.js";
import { countUsedConnectionSlots } from "../services/connection-quota.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "../services/tenant.service.js";
import { spawnConnection } from "../services/whatsapp/connection.js";

const isIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = isIntegration ? test : test.skip;

/**
 * End-to-end proof for the Telegram connection-quota TOCTOU fix.
 *
 * The bug: the Telegram connect route counted used connection slots on the
 * shared pool BEFORE its insert transaction and took no advisory lock, so two
 * concurrent connects (or a Telegram connect racing a WhatsApp spawn) both
 * observed the same pre-insert count, both passed `used < max`, and both
 * inserted - leaving the workspace above its paid limit. The fix moves the
 * count+insert inside one transaction behind the same company-scoped
 * `pg_advisory_xact_lock(hashtextextended(${companyId}, 0))` that WhatsApp's
 * `spawnConnection` already takes.
 *
 * These tests drive the real Hono app (auth + tenant middleware included),
 * mock the Telegram Bot API so the only external dependency is pinned, and
 * race two concurrent `POST /channel-accounts/telegram-bot` requests with
 * DISTINCT bot tokens (the shape that defeats the cap - a same-token double
 * submit is caught by the `ca_external_uidx` unique index, see the report).
 * They run only under `RUN_DB_INTEGRATION=1` against a migrated Postgres on
 * `DATABASE_URL`.
 */

// Recorded by the mocked Telegram Bot API so the tests can assert that exactly
// the winning request configured its webhook, and the rejected one never did.
const webhookConfigCalls: string[] = [];

// Mutable so a test can force `configureTelegramWebhook` to reject (the
// webhook-failure path). Reset to `false` around the test that flips it.
let webhookShouldFail = false;

// The mock is registered ONLY under `RUN_DB_INTEGRATION=1`. `bun run test`
// (the unit gate) loads every *.test.ts in one process; a top-level
// `mock.module` here would replace the real telegram-bot module for the whole
// process and break `channel-spine/providers/telegram-bot/api.test.ts`. The
// integration runner executes each integration file in its OWN process, so the
// mock is isolated there. Registering it before `await import("../app.js")`
// (below) ensures the route picks up the mocked module when it loads.
if (isIntegration) {
  // The route imports these via `../channel-spine/providers/telegram-bot/api.js`
  // (relative to this routes/ file). `getTelegramBotIdentity` derives a DISTINCT,
  // stable bot id from the token's numeric prefix so two different tokens map to
  // two different `(external_scope_id, external_account_id)` tuples and the
  // `ca_external_uidx` unique index does NOT collapse them - both would insert
  // without the quota lock, which is the overage path under test.
  mock.module("../channel-spine/providers/telegram-bot/api.js", () => ({
    getTelegramBotIdentity: async (token: string) => ({
      id: Number.parseInt(token.slice(0, token.indexOf(":")), 10),
      first_name: "QuotaBot",
      can_read_all_group_messages: true,
    }),
    configureTelegramWebhook: async (
      _token: string,
      webhookUrl: string,
      _secretToken: string,
    ) => {
      if (webhookShouldFail) throw new Error("simulated webhook failure");
      webhookConfigCalls.push(webhookUrl);
    },
    removeTelegramWebhook: async () => {},
    // Exported by the real module and re-exported elsewhere; keep the mock whole.
    getTelegramProfilePhotoFileId: async () => null,
    downloadTelegramFile: async () => ({
      data: new Uint8Array(),
      contentType: "application/octet-stream",
    }),
    telegramBotRequest: async () => true as never,
  }));
}

const { app } = await import("../app.js");

const PASSWORD = "Quota-race-123!";

/**
 * Patch the live `env` object's channel-credential keyring around `fn` so the
 * route's `canStoreChannelCredentials()` gate opens. `env` is built at module
 * load and the object is `as const`, so reassignment requires a cast; the
 * cipher is constructed on every call (not cached), so a runtime patch is
 * honored by the request. Restored in `finally` so it cannot leak to siblings.
 */
function withCredentialKeyring<T>(fn: () => Promise<T>): Promise<T> {
  const target = env as unknown as {
    CHANNEL_CREDENTIAL_ENCRYPTION_KEYS: string;
    CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION: string;
  };
  const originalKeys = target.CHANNEL_CREDENTIAL_ENCRYPTION_KEYS;
  const originalVersion = target.CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION;
  const key = `v1:${randomBytes(32).toString("base64")}`;
  target.CHANNEL_CREDENTIAL_ENCRYPTION_KEYS = key;
  target.CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION = "v1";
  return fn().finally(() => {
    target.CHANNEL_CREDENTIAL_ENCRYPTION_KEYS = originalKeys;
    target.CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION = originalVersion;
  });
}

async function loginAndGetHeaders(
  email: string,
  password: string,
  companyId: string,
): Promise<Record<string, string>> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

interface Workspace {
  companyId: string;
  schemaName: string;
  ownerId: string;
  headers: Record<string, string>;
  tenantDb: Kysely<TenantDatabase>;
}

/**
 * Provision an owner-authenticated workspace whose Telegram connect path is
 * open: neutral write authority with `telegram_bot` enabled, channel-spine
 * concurrency indexes built (so `isChannelSpineTenantReady` is true), and a
 * channel-credential keyring configured (so `canStoreChannelCredentials` is
 * true). `maxConnections` sets the plan ceiling the route enforces.
 */
async function withWorkspace(
  maxConnections: number,
  run: (ws: Workspace) => Promise<void>,
): Promise<void> {
  await withCredentialKeyring(async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const ownerId = crypto.randomUUID();
    const ownerEmail = `quota-${ownerId}@example.com`;
    try {
      await db
        .insertInto("users")
        .values({
          id: ownerId,
          email: ownerEmail,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Telegram quota race",
          schema_name: schemaName,
          status: "active",
          max_whatsapp_connections: maxConnections,
        })
        .execute();
      await db
        .insertInto("company_members")
        .values({ company_id: companyId, user_id: ownerId, role: "owner" })
        .execute();
      // The flip the connect route requires: WhatsApp is enabled under neutral
      // authority, and Telegram is an enabled provider.
      await db
        .insertInto("channel_spine_workspace_flags")
        .values({
          company_id: companyId,
          dual_write_enabled: false,
          neutral_reads_enabled: false,
          shadow_normalization_enabled: false,
          write_authority: "neutral",
          write_authority_revision: "test",
          enabled_providers: sql<string[]>`ARRAY['telegram_bot']::text[]`,
          provider_enable_revision: "test",
          revision: "1",
          created_by: ownerId,
          updated_by: ownerId,
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const headers = await loginAndGetHeaders(ownerEmail, PASSWORD, companyId);
      await run({
        companyId,
        schemaName,
        ownerId,
        headers,
        tenantDb: getTenantConnection(companyId),
      });
    } finally {
      await clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db
        .deleteFrom("channel_spine_workspace_flags")
        .where("company_id", "=", companyId)
        .execute();
      await db
        .deleteFrom("company_members")
        .where("company_id", "=", companyId)
        .execute();
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
      await db.deleteFrom("users").where("id", "=", ownerId).execute();
    }
  });
}

/** A token that passes the route's `botToken` regex and yields a distinct id. */
function makeBotToken(numericPrefix: string): string {
  return `${numericPrefix}:${randomBytes(27).toString("base64url")}`;
}

async function connectTelegramBot(
  headers: Record<string, string>,
  botToken: string,
): Promise<Response> {
  return app.request("/api/channel-accounts/telegram-bot", {
    method: "POST",
    headers,
    body: JSON.stringify({ botToken }),
  });
}

describe("POST /channel-accounts/telegram-bot connection quota", () => {
  integration(
    "concurrent connects with distinct tokens never exceed the plan slot limit",
    async () => {
      webhookConfigCalls.length = 0;
      await withWorkspace(1, async (ws) => {
        // The slot is empty, so one of two racing connects should win it.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(0);

        const tokenA = makeBotToken("1000000001");
        const tokenB = makeBotToken("2000000002");
        const results = await Promise.allSettled([
          connectTelegramBot(ws.headers, tokenA),
          connectTelegramBot(ws.headers, tokenB),
        ]);

        // The advisory lock serializes count+insert, so both requests resolve
        // to Responses (no unhandled rejections) and the slot is taken exactly
        // once. Without the lock both would read 0, both would pass, and both
        // would commit - the bug.
        for (const result of results) {
          expect(result.status).toBe("fulfilled");
        }
        const responses = (results as PromiseFulfilledResult<Response>[]).map(
          (r) => r.value,
        );
        const winner = responses.find((r) => r.status === 201);
        const loser = responses.find((r) => r.status === 402);

        expect(winner).toBeDefined();
        expect(loser).toBeDefined();
        expect(responses).toHaveLength(2);
        const loserBody = (await loser!.json()) as {
          error: string;
          code: string;
          used: number;
          max: number;
        };
        expect(loserBody).toEqual({
          error: "Connection limit reached for this plan",
          code: "MAX_CONNECTIONS_EXCEEDED",
          used: 1,
          max: 1,
        });

        // The workspace ends exactly at its ceiling - never above - and exactly
        // one account row was committed and reached "connected".
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);
        const rows = await ws.tenantDb
          .selectFrom("channel_accounts")
          .select(["status", "external_account_id"])
          .where("archived_at", "is", null)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("connected");
        // Only the winner configured its webhook; the loser's transaction
        // rolled back before the webhook step.
        expect(webhookConfigCalls).toHaveLength(1);
      });
    },
    60_000,
  );

  integration(
    "a connect under the limit succeeds, and a connect at the limit is rejected with the 402 contract",
    async () => {
      webhookConfigCalls.length = 0;
      await withWorkspace(1, async (ws) => {
        // One free slot: the first connect takes it and reaches "connected".
        const first = await connectTelegramBot(
          ws.headers,
          makeBotToken("1000000001"),
        );
        expect(first.status).toBe(201);
        const firstBody = (await first.json()) as {
          data: {
            id: string;
            channel: string;
            provider: string;
            status: string;
          };
        };
        expect(firstBody.data).toMatchObject({
          channel: "telegram",
          provider: "telegram_bot",
          status: "connected",
        });
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);

        // The slot is now full: a second connect (distinct token, so no
        // existing-account dedup) is rejected under the advisory lock with the
        // route's existing 402 contract - not the 429 the raw
        // MaxConnectionsExceededError would produce through app.onError.
        const second = await connectTelegramBot(
          ws.headers,
          makeBotToken("2000000002"),
        );
        expect(second.status).toBe(402);
        const secondBody = (await second.json()) as {
          error: string;
          code: string;
          used: number;
          max: number;
        };
        expect(secondBody).toEqual({
          error: "Connection limit reached for this plan",
          code: "MAX_CONNECTIONS_EXCEEDED",
          used: 1,
          max: 1,
        });

        // Rejection did not persist a row or configure a webhook.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);
        expect(webhookConfigCalls).toHaveLength(1);
      });
    },
    60_000,
  );

  integration(
    "a concurrent Telegram connect and WhatsApp spawn share the same advisory lock and never exceed the limit",
    async () => {
      webhookConfigCalls.length = 0;
      await withWorkspace(1, async (ws) => {
        // Cross-channel: the WhatsApp path locks `hashtextextended(companyId,
        // 0)` inside its transaction; the fix makes the Telegram path take the
        // SAME key. Advisory locks are cluster-global, so two different pools
        // (the central `db` the route uses vs the tenant pool `spawnConnection`
        // uses) still serialize on it. Exactly one channel claims the single
        // slot; the loser is rejected by the count under the same lock.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(0);

        const results = await Promise.allSettled([
          connectTelegramBot(ws.headers, makeBotToken("1000000001")),
          spawnConnection(ws.tenantDb, ws.companyId, ws.ownerId),
        ]);

        const telegramResult = results[0];
        const whatsappResult = results[1];

        // Exactly one slot was claimed - never two.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);

        // One side won (claimed the slot), the other was rejected by the quota
        // gate. The Telegram winner returns 201; the WhatsApp winner resolves
        // with { connectionId }. The Telegram loser returns 402; the WhatsApp
        // loser rejects with MaxConnectionsExceededError. Count the successful
        // claims and assert exactly one.
        const telegramClaimed =
          telegramResult.status === "fulfilled" &&
          telegramResult.value.status === 201;
        const whatsappClaimed = whatsappResult.status === "fulfilled";
        expect(telegramClaimed || whatsappClaimed).toBe(true);
        expect((telegramClaimed ? 1 : 0) + (whatsappClaimed ? 1 : 0)).toBe(1);

        if (
          telegramResult.status === "fulfilled" &&
          telegramResult.value.status === 201
        ) {
          // The winner was the Telegram connect; the WhatsApp spawn was
          // rejected by the quota gate.
          expect(whatsappResult.status).toBe("rejected");
        } else if (whatsappResult.status === "fulfilled") {
          // The winner was the WhatsApp spawn; the Telegram connect got the
          // 402 contract (not a raw 429).
          if (telegramResult.status !== "fulfilled") {
            throw new Error("telegram result should have been fulfilled 402");
          }
          expect(telegramResult.value.status).toBe(402);
          const body = (await telegramResult.value.json()) as {
            code: string;
            max: number;
          };
          expect(body).toMatchObject({
            code: "MAX_CONNECTIONS_EXCEEDED",
            max: 1,
          });
        } else {
          throw new Error("expected exactly one channel to claim the slot");
        }
      });
    },
    60_000,
  );

  integration(
    "reconnecting an existing error account does not consume a new slot",
    async () => {
      webhookConfigCalls.length = 0;
      await withWorkspace(1, async (ws) => {
        // An account in `error` already occupies the one paid slot (status !=
        // "archived" counts, see countUsedConnectionSlots). Reconnecting the
        // SAME bot must UPDATE that row, skip the quota check (the
        // existingAccount branch the fix leaves untouched), and NOT insert a
        // new row - so the slot count stays at 1 even though the route never
        // re-checks the ceiling for an existing account.
        const externalAccountId = "1000000001";
        const existingId = crypto.randomUUID();
        await ws.tenantDb
          .insertInto("channel_accounts")
          .values({
            id: existingId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Old bot",
            external_account_id: externalAccountId,
            external_scope_id: "telegram-bot",
            status: "error",
            provider_status: "webhook_configuration_failed",
          })
          .execute();
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);

        const res = await connectTelegramBot(
          ws.headers,
          makeBotToken(externalAccountId),
        );
        expect(res.status).toBe(201);

        // Same row (not a new one), now connected, slot count unchanged.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);
        const rows = await ws.tenantDb
          .selectFrom("channel_accounts")
          .select(["id", "status"])
          .where("archived_at", "is", null)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(existingId);
        expect(rows[0].status).toBe("connected");
        expect(webhookConfigCalls).toHaveLength(1);
      });
    },
    60_000,
  );

  integration(
    "a webhook configuration failure leaves a counted error row (slot semantics unchanged)",
    async () => {
      webhookShouldFail = true;
      webhookConfigCalls.length = 0;
      try {
        await withWorkspace(1, async (ws) => {
          // The row is committed with status "connecting" BEFORE the webhook
          // call; when the webhook fails the route sets status "error" and
          // returns 502. countUsedConnectionSlots counts status != "archived",
          // so the failed account still occupies its slot - matching the
          // pre-fix behavior and the WhatsApp analogue. The fix must not
          // change this.
          expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(0);
          const res = await connectTelegramBot(
            ws.headers,
            makeBotToken("1000000001"),
          );
          expect(res.status).toBe(502);
          const body = (await res.json()) as {
            error: string;
            accountId: string;
          };
          expect(body.error).toBe("Telegram webhook configuration failed");
          expect(body.accountId).toBeTruthy();

          // The failed row persists and still counts toward the quota.
          expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);
          const row = await ws.tenantDb
            .selectFrom("channel_accounts")
            .select(["status", "provider_status"])
            .where("id", "=", body.accountId)
            .executeTakeFirstOrThrow();
          expect(row.status).toBe("error");
          expect(row.provider_status).toBe("webhook_configuration_failed");
        });
      } finally {
        webhookShouldFail = false;
      }
    },
    60_000,
  );

  integration(
    "a same-token double submit is caught by the unique index, not swallowed as 402",
    async () => {
      webhookConfigCalls.length = 0;
      await withWorkspace(2, async (ws) => {
        // max = 2 so the quota gate does NOT reject the second request; both
        // pass the count check under the advisory lock, then the second INSERT
        // hits the `ca_external_uidx` unique violation (23505). The new `catch`
        // only translates MaxConnectionsExceededError, so the 23505 re-throws
        // through app.onError as a 500 - proving non-quota errors are unchanged.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(0);
        const sameToken = makeBotToken("1000000001");

        const results = await Promise.allSettled([
          connectTelegramBot(ws.headers, sameToken),
          connectTelegramBot(ws.headers, sameToken),
        ]);

        // Both resolve (Hono turns the thrown error into a Response); the loser
        // is a 500-shaped unique violation, NOT a 402 quota rejection.
        for (const r of results) expect(r.status).toBe("fulfilled");
        const responses = (results as PromiseFulfilledResult<Response>[]).map(
          (r) => r.value,
        );
        const ok = responses.filter((r) => r.status === 201);
        const quotaRejected = responses.filter((r) => r.status === 402);
        const otherFailure = responses.filter(
          (r) => r.status !== 201 && r.status !== 402,
        );
        expect(ok).toHaveLength(1);
        expect(quotaRejected).toHaveLength(0);
        expect(otherFailure).toHaveLength(1);
        // The unique violation surfaces as a 500 through app.onError.
        expect(otherFailure[0].status).toBe(500);

        // Exactly one row committed; the loser's transaction rolled back.
        expect(await countUsedConnectionSlots(ws.tenantDb)).toBe(1);
        expect(webhookConfigCalls).toHaveLength(1);
      });
    },
    60_000,
  );
});
