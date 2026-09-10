import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { generateAccessToken } from "../../lib/jwt.js";
import { rateLimitConfig } from "../../lib/rate-limit-store.js";
import { createApiToken } from "../../services/api-token.service.js";
import { ensureActiveCaseWithin } from "../../services/conversation-case.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

/**
 * Procedure 2.11 of the test plan: an end-to-end HTTP smoke that reproduces the
 * original exploit at the full middleware + handler layer.
 *
 * Drives the REAL mounted Hono app (`app.request`) so every middleware runs:
 * REST `POST /api/messages` passes through authMiddleware + tenantMiddleware +
 * requireMessageSendPermission + messageSendRateLimiter; MCP `POST /api/mcp`
 * passes through mcpAuthMiddleware + mcpRateLimiter (per-token) and then the
 * tool's own enforceSendRateLimit (per-user). Both send paths must spend one
 * per-user `messaging-send:user:<userId>` bucket.
 *
 * Gated on BOTH `RUN_DB_INTEGRATION=1` AND `rateLimitConfig.enabled`: the CI
 * integration runner forces `RATE_LIMIT_ENABLED=false`, but this test only
 * proves anything when a real limiter is active. `SEND_CAP` is read from the
 * live tier. Precondition: Postgres up + migrated (NATS/Centrifugo optional —
 * realtime broadcasts are fire-and-forget; `app.ts` does not init background
 * services, only `index.ts` does).
 *
 *   RUN_DB_INTEGRATION=1 RATE_LIMIT_ENABLED=true \
 *   RATE_LIMIT_MESSAGING_SEND_REQUESTS=3 RATE_LIMIT_GLOBAL_REQUESTS=10000 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:4447/wateaminbox \
 *   bun test src/routes/mcp/send-message-e2e-rate-limit.integration.test.ts
 */

const rateLimitIntegrationTest =
  process.env.RUN_DB_INTEGRATION === "1" && rateLimitConfig.enabled
    ? test
    : test.skip;

const SEND_CAP = rateLimitConfig.tiers.messaging.send.requests;
const TEST_TIMEOUT_MS = 30_000;

/** A self-contained workspace: user + session + company + connection + contact
 * with an open case, plus a personal API token for the MCP side and a JWT for
 * the REST side. */
async function withWorkspace(
  run: (ctx: {
    userId: string;
    companyId: string;
    contactId: string;
    apiToken: string;
    jwt: string;
    tenantDb: ReturnType<typeof getTenantConnection>;
  }) => Promise<void>,
): Promise<void> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const connectionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `e2e-${userId}@example.com`,
        password_hash: "x",
        name: "E2E User",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("user_sessions")
      .values({
        id: sessionId,
        user_id: userId,
        refresh_token: `rt-${sessionId}`,
        expires_at: new Date(Date.now() + 3_600_000),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "e2e rate-limit test",
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
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: "6589001305@s.whatsapp.net",
        phone_number: "6589001305",
      })
      .execute();
    // REST send requires an active case (requireActiveCaseForSend throws
    // otherwise); open one the same way queueTextMessage does.
    await tenantDb.transaction().execute(async (trx) => {
      await ensureActiveCaseWithin(
        trx,
        { id: contactId, isGroup: false },
        {
          companyId,
          openedBy: userId,
          reason: "E2E setup",
        },
      );
    });

    const { token: apiToken } = await createApiToken({
      userId,
      companyId,
      name: "e2e",
      scopes: ["read", "write"],
    });
    const jwt = await generateAccessToken(userId, sessionId);

    await run({
      userId,
      companyId,
      contactId,
      apiToken,
      jwt,
      tenantDb,
    });
  } finally {
    await db.deleteFrom("api_tokens").where("user_id", "=", userId).execute();
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
    await db
      .deleteFrom("user_sessions")
      .where("user_id", "=", userId)
      .execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

async function restSend(jwt: string, companyId: string, contactId: string) {
  return app.request("http://localhost/api/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
      "x-company-id": companyId,
    },
    body: JSON.stringify({
      contactId,
      content: "hi",
      messageType: "text",
    }),
  });
}

async function mcpSend(apiToken: string, contactId: string) {
  return app.request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "send_message",
        arguments: { contactId, content: "hi" },
      },
    }),
  });
}

/** Extract the tool result text (or error text) from a StreamableHTTP JSON-RPC
 * response. The MCP transport returns `text/event-stream`: an `event: message`
 * line followed by a `data:` line whose payload is the JSON-RPC result. A
 * successful tool call sets `result.isError === false/absent` and
 * `result.content[0].text` is the JSON-stringified tool return; a tool error
 * sets `result.isError === true` and `result.content[0].text` is the message. */
async function readMcpText(
  res: Response,
): Promise<{ isError: boolean; text: string; status: number }> {
  const raw = await res.text();
  const dataLines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  if (dataLines.length === 0) {
    throw new Error(`MCP response had no SSE data line: ${raw}`);
  }
  const body = JSON.parse(dataLines.join("\n")) as {
    result?: { isError?: boolean; content?: Array<{ text: string }> };
    error?: { message?: string };
  };
  const result = body.result;
  const content = result?.content?.[0];
  return {
    status: res.status,
    isError: Boolean(result?.isError) || Boolean(body.error),
    text: content?.text ?? body.error?.message ?? JSON.stringify(body),
  };
}

describe("end-to-end: REST and MCP send_message share the per-user bucket", () => {
  rateLimitIntegrationTest(
    "REST exhausting the bucket denies the next MCP send_message",
    () =>
      withWorkspace(
        async ({ jwt, companyId, contactId, apiToken, tenantDb }) => {
          for (let i = 0; i < SEND_CAP; i++) {
            const res = await restSend(jwt, companyId, contactId);
            expect(res.status).toBe(200);
          }
          expect(
            await tenantDb.selectFrom("messages").select("id").execute(),
          ).toHaveLength(SEND_CAP);

          const mcpRes = await mcpSend(apiToken, contactId);
          const mcp = await readMcpText(mcpRes);
          expect(mcp.isError).toBe(true);
          expect(mcp.text).toMatch(/Send rate limit exceeded/);

          // The denied MCP send must insert no message row.
          expect(
            await tenantDb.selectFrom("messages").select("id").execute(),
          ).toHaveLength(SEND_CAP);
        },
      ),
    TEST_TIMEOUT_MS,
  );

  rateLimitIntegrationTest(
    "MCP exhausting the bucket denies the next REST send with 429",
    () =>
      withWorkspace(
        async ({ jwt, companyId, contactId, apiToken, tenantDb }) => {
          for (let i = 0; i < SEND_CAP; i++) {
            const res = await mcpSend(apiToken, contactId);
            const mcp = await readMcpText(res);
            expect(mcp.isError).toBe(false);
            expect(mcp.text).toMatch(/queued/);
          }
          expect(
            await tenantDb.selectFrom("messages").select("id").execute(),
          ).toHaveLength(SEND_CAP);

          const restRes = await restSend(jwt, companyId, contactId);
          expect(restRes.status).toBe(429);
          const body = (await restRes.json()) as Record<string, unknown>;
          expect(body.message).toMatch(/Rate limit exceeded/);
          expect(restRes.headers.get("Retry-After")).not.toBeNull();

          expect(
            await tenantDb.selectFrom("messages").select("id").execute(),
          ).toHaveLength(SEND_CAP);
        },
      ),
    TEST_TIMEOUT_MS,
  );

  rateLimitIntegrationTest(
    "a second MCP token for the same user still shares the per-user bucket",
    () =>
      withWorkspace(async ({ userId, companyId, contactId, tenantDb }) => {
        const { token: token1 } = await createApiToken({
          userId,
          companyId,
          name: "e2e-1",
          scopes: ["read", "write"],
        });
        const { token: token2 } = await createApiToken({
          userId,
          companyId,
          name: "e2e-2",
          scopes: ["read", "write"],
        });

        // Spend the per-user budget entirely through the first token.
        for (let i = 0; i < SEND_CAP; i++) {
          const res = await mcpSend(token1, contactId);
          const mcp = await readMcpText(res);
          expect(mcp.isError).toBe(false);
        }
        // The original exploit: a second token got its own per-token MCP bucket
        // and could keep sending. With the fix it shares the per-user bucket
        // and must be denied.
        const res = await mcpSend(token2, contactId);
        const mcp = await readMcpText(res);
        expect(mcp.isError).toBe(true);
        expect(mcp.text).toMatch(/Send rate limit exceeded/);
        expect(
          await tenantDb.selectFrom("messages").select("id").execute(),
        ).toHaveLength(SEND_CAP);
      }),
    TEST_TIMEOUT_MS,
  );
});
