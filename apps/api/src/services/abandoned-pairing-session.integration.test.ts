import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { reapAbandonedPairingSessions } from "./abandoned-pairing-session.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "./tenant.service.js";
import type { Kysely } from "kysely";

/**
 * The sweep's selection is SQL, so it is pinned against a real tenant schema:
 * which pairing attempts it closes, and which live or recoverable accounts it
 * must never touch.
 */
const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const companyId = crypto.randomUUID();
const userId = crypto.randomUUID();
let tenantDb: Kysely<TenantDatabase>;

const LONG_AGO = new Date(Date.now() - 2 * 60 * 60_000);

async function seed(input: {
  sessionStatus: "pending" | "connecting" | "connected" | "disconnected";
  connectedAt: Date | null;
  sessionUpdatedAt: Date;
  connectionStatus: "connected" | "pending" | "disconnected";
  loggedOutAt: Date | null;
  archivedAt?: Date | null;
}): Promise<string> {
  const connectionId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      status: input.connectionStatus,
      logged_out_at: input.loggedOutAt,
      archived_at: input.archivedAt ?? null,
      connected_by: userId,
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_connection_sessions")
    .values({
      id: sessionId,
      whatsapp_connection_id: connectionId,
      status: input.sessionStatus,
      created_by: userId,
      started_at: LONG_AGO,
      connected_at: input.connectedAt,
      updated_at: input.sessionUpdatedAt,
    })
    .execute();
  return sessionId;
}

async function ended(sessionId: string): Promise<boolean> {
  const row = await tenantDb
    .selectFrom("whatsapp_connection_sessions")
    .select("ended_at")
    .where("id", "=", sessionId)
    .executeTakeFirstOrThrow();
  return row.ended_at !== null;
}

beforeAll(async () => {
  if (process.env.RUN_DB_INTEGRATION !== "1") return;
  await db
    .insertInto("users")
    .values({
      id: userId,
      email: `reap-${userId}@example.com`,
      password_hash: "x",
    })
    .execute();
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: "Abandoned pairing sweep test",
      schema_name: getSchemaName(companyId),
      status: "active",
    })
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
  tenantDb = getTenantConnection(companyId);
});

afterAll(async () => {
  if (process.env.RUN_DB_INTEGRATION !== "1") return;
  await clearTenantConnection(companyId);
  await sql
    .raw(`DROP SCHEMA IF EXISTS "${getSchemaName(companyId)}" CASCADE`)
    .execute(db);
  await db.deleteFrom("companies").where("id", "=", companyId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
});

describe("abandoned pairing sweep selection", () => {
  integrationTest(
    "closes stale unscanned setups and stale re-pairs after a logout, and nothing live or recoverable",
    async () => {
      const loggedOut = new Date(Date.now() - 30 * 24 * 60 * 60_000);
      const once = new Date(Date.now() - 31 * 24 * 60 * 60_000);

      const unscanned = await seed({
        sessionStatus: "pending",
        connectedAt: null,
        sessionUpdatedAt: LONG_AGO,
        connectionStatus: "pending",
        loggedOutAt: null,
      });
      // The production shape: connected once, logged out, reconnect reused
      // the row, and the worker shows QR codes to nobody.
      const afterLogout = await seed({
        sessionStatus: "disconnected",
        connectedAt: once,
        sessionUpdatedAt: LONG_AGO,
        connectionStatus: "disconnected",
        loggedOutAt: loggedOut,
      });
      // Someone pressed Reconnect a minute ago and is scanning now.
      const repairInProgress = await seed({
        sessionStatus: "connecting",
        connectedAt: once,
        sessionUpdatedAt: new Date(),
        connectionStatus: "pending",
        loggedOutAt: loggedOut,
      });
      // Dropped but never logged out: still owns credentials.
      const droppedOnly = await seed({
        sessionStatus: "disconnected",
        connectedAt: once,
        sessionUpdatedAt: LONG_AGO,
        connectionStatus: "disconnected",
        loggedOutAt: null,
      });
      const live = await seed({
        sessionStatus: "connected",
        connectedAt: once,
        sessionUpdatedAt: LONG_AGO,
        connectionStatus: "connected",
        loggedOutAt: null,
      });
      const archived = await seed({
        sessionStatus: "disconnected",
        connectedAt: once,
        sessionUpdatedAt: LONG_AGO,
        connectionStatus: "disconnected",
        loggedOutAt: loggedOut,
        archivedAt: new Date(),
      });

      const reaped = await reapAbandonedPairingSessions(tenantDb, companyId);

      expect(reaped).toBe(2);
      expect(await ended(unscanned)).toBe(true);
      expect(await ended(afterLogout)).toBe(true);
      expect(await ended(repairInProgress)).toBe(false);
      expect(await ended(droppedOnly)).toBe(false);
      expect(await ended(live)).toBe(false);
      expect(await ended(archived)).toBe(false);

      // Each reaped attempt queued exactly one stop, without unlinking, on
      // its own session's subject.
      const kills = await tenantDb
        .selectFrom("nats_outbox")
        .select(["subject", "payload"])
        .execute();
      expect(kills).toHaveLength(2);
      for (const { payload } of kills) {
        expect(payload.type).toBe("kill");
        expect(payload.unlink).toBe(false);
      }
      const subjects = kills.map((k) => k.subject).join(" ");
      expect(subjects).toContain(unscanned);
      expect(subjects).toContain(afterLogout);

      // A second cycle finds nothing: ended rows are never claimed again.
      expect(await reapAbandonedPairingSessions(tenantDb, companyId)).toBe(0);
    },
  );
});
