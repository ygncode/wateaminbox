import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import type { Context } from "hono";
import { sql } from "kysely";
import { rateLimitConfig } from "../../lib/rate-limit-store.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";
import { writeTools } from "./tools/write.js";

/**
 * Extension coverage for procedure 2.8 of the test plan: the MCP
 * `start_conversation` tool reuses `queueTextMessage`, so its send leg must be
 * throttled by `enforceSendRateLimit` against the shared per-user
 * `messaging-send` bucket once the cap is reached.
 *
 * Gated on BOTH `RUN_DB_INTEGRATION=1` AND `rateLimitConfig.enabled`: the CI
 * integration runner forces `RATE_LIMIT_ENABLED=false` (its limiters must be
 * inert for the rest of the suite), and this test only means something when a
 * real limiter is active. `SEND_CAP` is read from the live tier so the test
 * tracks whatever request cap the environment configured (set
 * `RATE_LIMIT_MESSAGING_SEND_REQUESTS=3` for a fast run). The rejected send
 * must insert no message row and enqueue no outbox command; the pre-limiter
 * `findOrCreateContactByPhone` may still run by design (it reuses the existing
 * contact), which is why we send to the same number every time and count rows.
 */

const rateLimitIntegrationTest =
  process.env.RUN_DB_INTEGRATION === "1" && rateLimitConfig.enabled
    ? test
    : test.skip;

const SEND_CAP = rateLimitConfig.tiers.messaging.send.requests;

const startConversation = writeTools.find(
  (tool) => tool.name === "start_conversation",
);
if (!startConversation) throw new Error("start_conversation tool not found");

function fakeContext(values: Record<string, unknown>): Context {
  return {
    get: (key: string) => values[key],
    req: { header: () => undefined },
  } as unknown as Context;
}

async function withWorkspace(
  run: (ctx: {
    tenantDb: ReturnType<typeof getTenantConnection>;
    c: Context;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `start-conv-rl-${userId}@example.com`,
        password_hash: "x",
        name: "Outreach User",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "start_conversation rate-limit test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: companyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: userId,
      })
      .execute();
    await createTenantSchema(companyId);

    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        jid: "15550009999@s.whatsapp.net",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("whatsapp_connection_sessions")
      .values({
        whatsapp_connection_id: connectionId,
        status: "connected",
        started_at: new Date(),
        connected_at: new Date(),
      })
      .execute();

    const c = fakeContext({
      tenantDb,
      companyId,
      user: {
        id: userId,
        email: `start-conv-rl-${userId}@example.com`,
        name: "Outreach User",
      },
      companyPermissions: {
        can_send_messages: true,
        can_view_all_chats: true,
      },
      companyRole: "owner",
      apiToken: { id: crypto.randomUUID() },
    });

    await run({ tenantDb, c });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("sla_policies")
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

describe("start_conversation send-rate limit", () => {
  rateLimitIntegrationTest(
    "rejects the send once the per-user messaging-send bucket is full and writes nothing",
    () =>
      withWorkspace(async ({ tenantDb, c }) => {
        const args = { phoneNumber: "6589001305", content: "Hi" };

        // The first SEND_CAP sends fit the per-user budget and queue a message
        // plus an outbox command each.
        for (let i = 0; i < SEND_CAP; i++) {
          const result = (await startConversation.handler(args, c)) as {
            status: string;
          };
          expect(result.status).toBe("queued");
        }

        const messagesBefore = await tenantDb
          .selectFrom("messages")
          .select("id")
          .execute();
        const outboxBefore = await tenantDb
          .selectFrom("nats_outbox")
          .select("id")
          .execute();
        const casesBefore = await tenantDb
          .selectFrom("conversation_cases")
          .select("id")
          .execute();
        expect(messagesBefore).toHaveLength(SEND_CAP);
        expect(outboxBefore).toHaveLength(SEND_CAP);
        expect(casesBefore).toHaveLength(1);

        // The next send exceeds the per-user budget; queueTextMessage rejects
        // before inserting a message row or enqueuing an outbox command.
        await expect(startConversation.handler(args, c)).rejects.toThrow(
          "Send rate limit exceeded",
        );

        const messagesAfter = await tenantDb
          .selectFrom("messages")
          .select("id")
          .execute();
        const outboxAfter = await tenantDb
          .selectFrom("nats_outbox")
          .select("id")
          .execute();
        expect(messagesAfter).toHaveLength(SEND_CAP);
        expect(outboxAfter).toHaveLength(SEND_CAP);
      }),
    30_000,
  );
});
