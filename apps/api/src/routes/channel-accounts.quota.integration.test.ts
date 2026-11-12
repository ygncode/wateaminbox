import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { app } from "../app.js";
import { MaxConnectionsExceededError } from "../lib/errors.js";
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

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Quota-race-123!";
const realFetch = globalThis.fetch;

/**
 * Stands in for the Telegram Bot API at the network edge, so the real adapter
 * runs. getMe derives the bot id from the token prefix: distinct tokens are
 * distinct bots, which the external-account unique index cannot collapse, and
 * so only the quota can stop the second insert. `getMe` is held until every
 * racer has asked for it, which lines the requests up at the quota check.
 */
function stubTelegram(racers: number) {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  const webhooks: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const match = /^https:\/\/api\.telegram\.org\/bot(\d+):[^/]+\/(\w+)$/.exec(
      url,
    );
    if (!match) return realFetch(input, init);
    const [, botId, method] = match;
    if (method === "getMe") {
      arrived += 1;
      if (arrived >= racers) release();
      await allArrived;
      return Response.json({
        ok: true,
        result: { id: Number(botId), first_name: `Bot ${botId}` },
      });
    }
    if (method === "setWebhook") {
      webhooks.push(botId as string);
      return Response.json({ ok: true, result: true });
    }
    return Response.json({ ok: true, result: true });
  }) as typeof fetch;
  return { webhooks };
}

function botToken(id: number): string {
  return `${id}:${"A".repeat(35)}`;
}

async function withWorkspace(
  maxConnections: number,
  run: (ctx: {
    companyId: string;
    userId: string;
    headers: Record<string, string>;
    tenantDb: Kysely<TenantDatabase>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const email = `quota-race-${userId}@example.com`;
  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email,
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
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();
    await db
      .insertInto("channel_spine_workspace_flags")
      .values({
        company_id: companyId,
        write_authority: "neutral",
        write_authority_revision: "quota-test",
        enabled_providers: sql<string[]>`ARRAY['telegram_bot']::text[]`,
        provider_enable_revision: "quota-test",
        revision: "1",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await createTenantSchema(companyId);
    await reconcileChannelSpineConcurrentIndexes(db, schemaName);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    const { tokens } = (await login.json()) as {
      tokens: { accessToken: string };
    };
    await run({
      companyId,
      userId,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "x-company-id": companyId,
        "content-type": "application/json",
      },
      tenantDb: getTenantConnection(companyId),
    });
  } finally {
    await clearTenantConnection(companyId);
    await sql`DELETE FROM public.channel_ingress_routes
      WHERE company_id = ${companyId}`.execute(db);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("channel_spine_workspace_flags")
      .where("company_id", "=", companyId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

function connectTelegram(headers: Record<string, string>, id: number) {
  return app.request("/api/channel-accounts/telegram-bot", {
    method: "POST",
    headers,
    body: JSON.stringify({ botToken: botToken(id) }),
  });
}

describe("POST /api/channel-accounts/telegram-bot connection quota (#379)", () => {
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // A smoke test: without the lock this race is lost only some of the time.
  // The held-lock test below is the deterministic proof.
  integrationTest(
    "admits exactly one of two concurrent connects for the last slot",
    async () => {
      await withWorkspace(1, async ({ headers, tenantDb }) => {
        const telegram = stubTelegram(2);

        const responses = await Promise.all([
          connectTelegram(headers, 1000001),
          connectTelegram(headers, 1000002),
        ]);

        const statuses = responses.map((r) => r.status).sort();
        expect(statuses).toEqual([201, 402]);
        const rejected = responses.find((r) => r.status === 402);
        expect(await rejected?.json()).toEqual({
          error: "Connection limit reached for this plan",
          code: "MAX_CONNECTIONS_EXCEEDED",
          used: 1,
          max: 1,
        });
        expect(await countUsedConnectionSlots(tenantDb)).toBe(1);
        // The rejected bot never reached Telegram's webhook API, and left no
        // half-created account behind.
        expect(telegram.webhooks).toHaveLength(1);
        const accounts = await tenantDb
          .selectFrom("channel_accounts")
          .select("status")
          .execute();
        expect(accounts).toEqual([{ status: "connected" }]);
      });
    },
  );

  integrationTest(
    "shares the lock with a WhatsApp spawn, so the two channels cannot both take the last slot",
    async () => {
      await withWorkspace(
        1,
        async ({ companyId, userId, headers, tenantDb }) => {
          stubTelegram(1);
          // Do what spawnConnection does, but hold the transaction open: take
          // the company lock and insert the pending WhatsApp row. A Telegram
          // connect that takes the same lock must wait for this commit and then
          // see the slot as used; one that does not would insert alongside it.
          let commitSpawn!: () => void;
          const spawnMayCommit = new Promise<void>((resolve) => {
            commitSpawn = resolve;
          });
          let lockHeld!: () => void;
          const spawnHoldsLock = new Promise<void>((resolve) => {
            lockHeld = resolve;
          });
          const spawn = tenantDb.transaction().execute(async (trx) => {
            await sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId}, 0))`.execute(
              trx,
            );
            await trx
              .insertInto("whatsapp_connections")
              .values({ id: crypto.randomUUID(), status: "pending" })
              .execute();
            lockHeld();
            await spawnMayCommit;
          });
          await spawnHoldsLock;

          let settled = false;
          const telegram = Promise.resolve(
            connectTelegram(headers, 1000003),
          ).finally(() => {
            settled = true;
          });
          let settledWhileLocked: boolean;
          try {
            await Bun.sleep(500);
            settledWhileLocked = settled;
          } finally {
            // Always release, or a failed assertion leaves the lock held.
            commitSpawn();
            await spawn;
          }
          expect(settledWhileLocked).toBe(false);

          const response = await telegram;
          expect(response.status).toBe(402);
          expect(await countUsedConnectionSlots(tenantDb)).toBe(1);
          // And the other way round: a later WhatsApp spawn is refused too.
          await expect(
            spawnConnection(tenantDb, companyId, userId, "Support"),
          ).rejects.toBeInstanceOf(MaxConnectionsExceededError);
        },
      );
    },
  );

  integrationTest(
    "still lets an existing account reconnect when the plan is full",
    async () => {
      await withWorkspace(1, async ({ headers, tenantDb }) => {
        stubTelegram(1);
        expect((await connectTelegram(headers, 1000004)).status).toBe(201);
        await tenantDb
          .updateTable("channel_accounts")
          .set({ status: "error" })
          .execute();

        stubTelegram(1);
        expect((await connectTelegram(headers, 1000004)).status).toBe(201);
        expect(await countUsedConnectionSlots(tenantDb)).toBe(1);
      });
    },
  );
});
