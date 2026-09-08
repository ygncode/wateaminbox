import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { env } from "../lib/env.js";
import { handleConnectedEvent } from "./handlers/connection-handlers.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const SIGNATURE_VERSION = "wateaminbox-connection-admission-v1";

// `env` is built at module load, so the mock URL (a random free port) cannot
// be supplied via process.env before import. Instead patch the live `env`
// object's CONNECTION_ADMISSION_URL field around each call. Runtime it is a
// plain writable object; the `as const` makes the property type readonly,
// so a cast is required to reassign it for the duration of the call.
function withAdmissionUrl<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const target = env as unknown as { CONNECTION_ADMISSION_URL: string };
  const original = target.CONNECTION_ADMISSION_URL;
  target.CONNECTION_ADMISSION_URL = url;
  return fn().finally(() => {
    target.CONNECTION_ADMISSION_URL = original;
  });
}

// Starts a local control-plane mock on a free port that records the signed
// admission POST and responds with the configured decision. Returns the
// recorded requests so the test can assert the HMAC envelope and body.
async function startMockAdmission(respond: (req: Request) => Response) {
  const requests: Array<{
    body: string;
    timestamp: string | null;
    signature: string | null;
    parsed: { companyId: string; phoneNumber: string };
  }> = [];
  const listener = Bun.serve({
    port: 0,
    fetch(req) {
      const body = req.text();
      return body.then((b) => {
        requests.push({
          body: b,
          timestamp: req.headers.get("x-wateaminbox-timestamp"),
          signature: req.headers.get("x-wateaminbox-signature"),
          parsed: JSON.parse(b),
        });
        return respond(req);
      });
    },
  });
  return { listener, requests, url: `http://localhost:${listener.port}` };
}

function connectedEvent(
  companyId: string,
  connectionId: string,
  sessionId: string,
  phone = "6584042683",
) {
  return {
    contractVersion: 1,
    type: "connected",
    companyId,
    connectionId,
    sessionId,
    timestamp: new Date().toISOString(),
    payload: { phoneNumber: phone, jid: `${phone}@s.whatsapp.net` },
  } as const;
}

async function withTenant(
  fn: (
    tenantDb: ReturnType<typeof getTenantConnection>,
    companyId: string,
  ) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  await createTenantSchema(companyId);
  const tenantDb = getTenantConnection(companyId);
  try {
    await fn(tenantDb, companyId);
  } finally {
    await clearTenantConnection(companyId);
    await sql
      .raw(`DROP SCHEMA IF EXISTS "${getSchemaName(companyId)}" CASCADE`)
      .execute(db);
  }
}

describe("connection admission signature (live control-plane mock)", () => {
  integrationTest(
    "G2/G7: a logged-out reconnect sends the signed admission POST and is denied",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "n",
            status: "disconnected",
            phone_number: "6584042683",
            logged_out_at: new Date("2026-09-05T09:00:00Z"),
          })
          .execute();
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            id: sessionId,
            whatsapp_connection_id: connectionId,
            status: "disconnected",
            connected_at: new Date("2026-09-01T10:00:00Z"),
            started_at: new Date(),
          })
          .execute();

        const mock = await startMockAdmission(
          () =>
            new Response(
              JSON.stringify({
                allowed: false,
                code: "payment_required",
                message: "Upgrade required",
                paymentRequired: true,
              }),
              { status: 402, headers: { "content-type": "application/json" } },
            ),
        );

        try {
          await withAdmissionUrl(mock.url, () =>
            handleConnectedEvent(
              connectedEvent(companyId, connectionId, sessionId) as never,
              {},
            ),
          );
        } finally {
          mock.listener.stop();
        }

        expect(mock.requests).toHaveLength(1);
        const r = mock.requests[0];
        expect(r.parsed).toEqual({ companyId, phoneNumber: "6584042683" });
        expect(r.timestamp).toBeTruthy();
        expect(r.signature).toBeTruthy();
        // Recompute the HMAC with the same secret/version and assert equality.
        const expected = createHmac("sha256", env.JWT_SECRET)
          .update(`${SIGNATURE_VERSION}\n${r.timestamp}\n${r.body}`)
          .digest("hex");
        expect(r.signature).toBe(expected);
      });
    },
    30_000,
  );

  integrationTest(
    "G3/G7: an archived relink sends the signed admission POST",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "n",
            status: "pending",
            phone_number: "6584042683",
            archived_at: null,
          })
          .execute();
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            id: sessionId,
            whatsapp_connection_id: connectionId,
            status: "pending",
            started_at: new Date(),
          })
          .execute();

        const mock = await startMockAdmission(() =>
          Response.json({ allowed: true }),
        );

        try {
          await withAdmissionUrl(mock.url, () =>
            handleConnectedEvent(
              connectedEvent(companyId, connectionId, sessionId) as never,
              {},
            ),
          );
        } finally {
          mock.listener.stop();
        }

        expect(mock.requests).toHaveLength(1);
        const r = mock.requests[0];
        expect(r.parsed).toEqual({ companyId, phoneNumber: "6584042683" });
        const expected = createHmac("sha256", env.JWT_SECRET)
          .update(`${SIGNATURE_VERSION}\n${r.timestamp}\n${r.body}`)
          .digest("hex");
        expect(r.signature).toBe(expected);
      });
    },
    30_000,
  );

  integrationTest(
    "G1/G7: a credential-intact resume sends NO admission POST",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "n",
            status: "connected",
            phone_number: "6584042683",
          })
          .execute();
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            id: sessionId,
            whatsapp_connection_id: connectionId,
            status: "disconnected",
            connected_at: new Date("2026-09-01T10:00:00Z"),
            started_at: new Date(),
          })
          .execute();

        const mock = await startMockAdmission(() =>
          Response.json({ allowed: true }),
        );

        try {
          await withAdmissionUrl(mock.url, () =>
            handleConnectedEvent(
              connectedEvent(companyId, connectionId, sessionId) as never,
              {},
            ),
          );
        } finally {
          mock.listener.stop();
        }

        expect(mock.requests).toEqual([]);
      });
    },
    30_000,
  );
});
