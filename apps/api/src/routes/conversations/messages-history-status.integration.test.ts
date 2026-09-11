import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { REMOTE_HISTORY_RESPONSE_TIMEOUT_MS } from "@wateaminbox/shared";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "../../services/tenant.service.js";
import { failStaleRemoteHistoryRequest } from "./messages.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

/** Comfortably past `REMOTE_HISTORY_RESPONSE_TIMEOUT_MS`. */
const staleRequestAt = () =>
  new Date(Date.now() - REMOTE_HISTORY_RESPONSE_TIMEOUT_MS * 2);

async function loginAndGetHeaders(
  email: string,
  password: string,
  companyId: string,
) {
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

async function withWorkspace(
  run: (ctx: {
    companyId: string;
    schemaName: string;
    headers: Record<string, string>;
    tenantDb: Kysely<TenantDatabase>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner-${ownerId}@example.com`;

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
        name: "Remote history race test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);

    const headers = await loginAndGetHeaders(ownerEmail, PASSWORD, companyId);
    await run({
      companyId,
      schemaName,
      headers,
      tenantDb: getTenantConnection(companyId),
    });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

async function insertContact(
  tenantDb: Kysely<TenantDatabase>,
  status: "requesting",
  updatedAt: Date,
) {
  const contactId = crypto.randomUUID();
  await tenantDb
    .insertInto("contacts")
    .values({
      id: contactId,
      jid: `1555${Math.floor(Math.random() * 1e7)
        .toString()
        .padStart(7, "0")}@s.whatsapp.net`,
      remote_history_status: status,
      remote_history_updated_at: updatedAt,
    })
    .execute();
  return contactId;
}

async function readRemoteHistoryStatus(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
) {
  const row = await tenantDb
    .selectFrom("contacts")
    .select(["remote_history_status", "remote_history_updated_at"])
    .where("id", "=", contactId)
    .executeTakeFirstOrThrow();
  return row;
}

/** Waits until the tenant schema has a backend blocked on a lock. */
async function waitForBlockedUpdate(
  schemaName: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await sql<{ waiting: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query LIKE ${`%${schemaName}%`}
      ) AS waiting
    `.execute(db);
    if (result.rows[0]?.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe("stale remote-history request recovery", () => {
  integrationTest(
    "fails a request that has been unanswered past the timeout",
    async () => {
      await withWorkspace(async ({ tenantDb }) => {
        const contactId = await insertContact(
          tenantDb,
          "requesting",
          staleRequestAt(),
        );

        expect(await failStaleRemoteHistoryRequest(tenantDb, contactId)).toBe(
          true,
        );
        const row = await readRemoteHistoryStatus(tenantDb, contactId);
        expect(row.remote_history_status).toBe("failed");
      });
    },
  );

  integrationTest("leaves a request that is still within the timeout alone", async () => {
    await withWorkspace(async ({ tenantDb }) => {
      const contactId = await insertContact(tenantDb, "requesting", new Date());

      expect(await failStaleRemoteHistoryRequest(tenantDb, contactId)).toBe(
        false,
      );
      const row = await readRemoteHistoryStatus(tenantDb, contactId);
      expect(row.remote_history_status).toBe("requesting");
    });
  });

  integrationTest(
    "does not clobber the retry that commits between the read and the write",
    async () => {
      await withWorkspace(async ({ headers, schemaName, tenantDb }) => {
        const contactId = await insertContact(
          tenantDb,
          "requesting",
          staleRequestAt(),
        );

        // Hold the row lock with a fresh `requesting` exactly as `POST
        // /conversations/:id/history` commits one, but leave it uncommitted so
        // the GET below still reads the stale value and decides to flip.
        let release = () => {};
        const holdRow = new Promise<void>((resolve) => {
          release = resolve;
        });
        const retry = db.transaction().execute(async (trx) => {
          await sql`
            UPDATE ${sql.id(schemaName, "contacts")}
            SET remote_history_status = 'requesting',
                remote_history_updated_at = now()
            WHERE id = ${contactId}
          `.execute(trx);
          await holdRow;
        });

        const response = app.request(
          `/api/conversations/${contactId}/messages`,
          { headers },
        );

        const blocked = await waitForBlockedUpdate(schemaName);
        release();
        await retry;

        // Without the freshness guard the GET's unconditional UPDATE won this
        // race and persisted a manufactured `failed` beside an in-flight
        // `request_history`, which is what let the UI enqueue a duplicate.
        expect(blocked).toBe(true);
        const body = (await (await response).json()) as {
          data: { remoteHistoryStatus: string };
        };
        expect(body.data.remoteHistoryStatus).toBe("requesting");

        const row = await readRemoteHistoryStatus(tenantDb, contactId);
        expect(row.remote_history_status).toBe("requesting");
      });
    },
  );

  integrationTest(
    "still reports a genuinely stale request as failed to the client",
    async () => {
      await withWorkspace(async ({ headers, tenantDb }) => {
        const contactId = await insertContact(
          tenantDb,
          "requesting",
          staleRequestAt(),
        );

        const response = await app.request(
          `/api/conversations/${contactId}/messages`,
          { headers },
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: { remoteHistoryStatus: string };
        };
        expect(body.data.remoteHistoryStatus).toBe("failed");

        const row = await readRemoteHistoryStatus(tenantDb, contactId);
        expect(row.remote_history_status).toBe("failed");
      });
    },
  );
});
