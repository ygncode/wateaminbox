import { afterEach, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { EmailOptions } from "../lib/email.js";
import { telegramIngressUrlPrefix } from "../lib/channel-ingress-url.js";
import { storeChannelCredential } from "./channel-credential.service.js";
import type { CreateNotificationInput } from "./notification-history.service.js";
import {
  checkTelegramWebhooks,
  classifyTelegramWebhook,
} from "./telegram-webhook-watch.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const realFetch = globalThis.fetch;
const BOT_TOKEN = `7654321:${"B".repeat(35)}`;

/** Answer getWebhookInfo with `url` (or fail), and count the calls. */
function stubWebhookInfo(url: string | Error) {
  const calls = { count: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input instanceof Request ? input.url : input);
    if (!target.startsWith("https://api.telegram.org/")) {
      return realFetch(input, init);
    }
    calls.count += 1;
    if (url instanceof Error) throw url;
    return Response.json({
      ok: true,
      result: { url, pending_update_count: 0 },
    });
  }) as typeof fetch;
  return calls;
}

function recorders() {
  const emails: EmailOptions[] = [];
  const notifications: CreateNotificationInput[] = [];
  return {
    emails,
    notifications,
    options: {
      sender: async (email: EmailOptions) => {
        emails.push(email);
        return { success: true };
      },
      notify: (async (
        _companyId: string,
        inputs: CreateNotificationInput[],
      ) => {
        notifications.push(...inputs);
        return [];
      }) as never,
    },
  };
}

async function withTelegramBot(
  run: (ctx: {
    companyId: string;
    accountId: string;
    tenantDb: Kysely<TenantDatabase>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  try {
    await db
      .insertInto("users")
      .values([
        {
          id: ownerId,
          email: `webhook-watch-owner-${ownerId}@example.com`,
          password_hash: "test",
          email_verified_at: new Date(),
        },
        {
          id: memberId,
          email: `webhook-watch-member-${memberId}@example.com`,
          password_hash: "test",
          email_verified_at: new Date(),
        },
      ])
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Webhook watch",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values([
        { user_id: ownerId, company_id: companyId, role: "owner" },
        { user_id: memberId, company_id: companyId, role: "member" },
      ])
      .execute();
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("channel_accounts")
      .values({
        id: accountId,
        channel: "telegram",
        provider: "telegram_bot",
        display_name: "Support bot",
        external_account_id: "7654321",
        external_scope_id: "telegram-bot",
        status: "connected",
        connected_at: new Date("2026-11-01T00:00:00Z"),
      })
      .execute();
    await storeChannelCredential(
      tenantDb,
      companyId,
      accountId,
      "telegram_bot_token",
      BOT_TOKEN,
    );
    await run({ companyId, accountId, tenantDb });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db
      .deleteFrom("users")
      .where("id", "in", [ownerId, memberId])
      .execute();
  }
}

async function accountState(
  tenantDb: Kysely<TenantDatabase>,
  accountId: string,
) {
  return tenantDb
    .selectFrom("channel_accounts")
    .select(["status", "provider_status"])
    .where("id", "=", accountId)
    .executeTakeFirstOrThrow();
}

describe("classifyTelegramWebhook", () => {
  const prefix = "https://app.example.com/api/channel-ingress/telegram_bot/";
  test("accepts our ingress route", () => {
    expect(classifyTelegramWebhook(`${prefix}abc`, prefix)).toBeNull();
  });
  test("flags another app's webhook", () => {
    expect(
      classifyTelegramWebhook(
        "https://other.example.com/api/telegram/webhook",
        prefix,
      ),
    ).toBe("webhook_taken_over");
  });
  test("flags a lookalike host", () => {
    expect(
      classifyTelegramWebhook(
        "https://app.example.com.evil.test/api/channel-ingress/telegram_bot/abc",
        prefix,
      ),
    ).toBe("webhook_taken_over");
  });
  test("flags a removed webhook", () => {
    expect(classifyTelegramWebhook("", prefix)).toBe("webhook_missing");
  });
});

describe("checkTelegramWebhooks", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  integrationTest(
    "leaves a bot alone while its webhook points at this server",
    async () => {
      await withTelegramBot(async ({ companyId, accountId, tenantDb }) => {
        const calls = stubWebhookInfo(`${telegramIngressUrlPrefix()}route-key`);
        const { emails, notifications, options } = recorders();
        expect(await checkTelegramWebhooks(tenantDb, companyId, options)).toBe(
          0,
        );
        expect(calls.count).toBe(1);
        expect(await accountState(tenantDb, accountId)).toEqual({
          status: "connected",
          provider_status: null,
        });
        expect(emails).toEqual([]);
        expect(notifications).toEqual([]);
      });
    },
  );

  integrationTest(
    "marks a taken-over bot and alerts owners and admins once",
    async () => {
      await withTelegramBot(async ({ companyId, accountId, tenantDb }) => {
        stubWebhookInfo("https://operateservers.example/api/telegram/webhook");
        const { emails, notifications, options } = recorders();
        expect(await checkTelegramWebhooks(tenantDb, companyId, options)).toBe(
          1,
        );
        expect(await accountState(tenantDb, accountId)).toEqual({
          status: "error",
          provider_status: "webhook_taken_over",
        });
        // The owner only: members cannot reconnect, so they are not told.
        expect(notifications).toHaveLength(1);
        expect(notifications[0]).toMatchObject({
          notificationType: "system",
          actionUrl: `/w/${companyId}/settings/connections`,
          metadata: {
            channelAccountId: accountId,
            providerStatus: "webhook_taken_over",
          },
        });
        expect(emails).toHaveLength(1);
        expect(emails[0]?.to).toContain("webhook-watch-owner-");
        expect(emails[0]?.subject).toContain("Telegram bot not delivering");

        // The account is no longer connected, so the next cycle neither
        // asks Telegram again nor repeats the alert.
        const calls = stubWebhookInfo("https://operateservers.example/hook");
        expect(await checkTelegramWebhooks(tenantDb, companyId, options)).toBe(
          0,
        );
        expect(calls.count).toBe(0);
        expect(emails).toHaveLength(1);
      });
    },
  );

  integrationTest("marks a bot whose webhook was removed", async () => {
    await withTelegramBot(async ({ companyId, accountId, tenantDb }) => {
      stubWebhookInfo("");
      const { options } = recorders();
      expect(await checkTelegramWebhooks(tenantDb, companyId, options)).toBe(1);
      expect(await accountState(tenantDb, accountId)).toEqual({
        status: "error",
        provider_status: "webhook_missing",
      });
    });
  });

  integrationTest(
    "changes nothing when Telegram cannot be reached",
    async () => {
      await withTelegramBot(async ({ companyId, accountId, tenantDb }) => {
        stubWebhookInfo(new Error("network down"));
        const { emails, options } = recorders();
        expect(await checkTelegramWebhooks(tenantDb, companyId, options)).toBe(
          0,
        );
        expect(await accountState(tenantDb, accountId)).toEqual({
          status: "connected",
          provider_status: null,
        });
        expect(emails).toEqual([]);
      });
    },
  );

  integrationTest(
    "does not overwrite a reconnect that lands during the check",
    async () => {
      await withTelegramBot(async ({ companyId, accountId, tenantDb }) => {
        // Telegram answers with the old, foreign URL - but before the answer
        // is acted on, the operator reconnects and our webhook is registered
        // again with a new connected_at.
        globalThis.fetch = (async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => {
          const target = String(input instanceof Request ? input.url : input);
          if (!target.startsWith("https://api.telegram.org/")) {
            return realFetch(input, init);
          }
          await tenantDb
            .updateTable("channel_accounts")
            .set({ connected_at: new Date("2026-11-26T00:00:00Z") })
            .where("id", "=", accountId)
            .execute();
          return Response.json({
            ok: true,
            result: { url: "https://operateservers.example/hook" },
          });
        }) as typeof fetch;
        const { emails, options } = recorders();
        expect(await checkTelegramWebhooks(tenantDb, companyId, options)).toBe(
          0,
        );
        expect(await accountState(tenantDb, accountId)).toEqual({
          status: "connected",
          provider_status: null,
        });
        expect(emails).toEqual([]);
      });
    },
  );
});
