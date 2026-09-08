import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  handleConnectedEvent,
  PAIRED_SESSION_STOP_POLICIES,
  type PairedSessionStopInput,
} from "./handlers/connection-handlers.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

// A real-DB counterpart to the isolation fakes in connection-identity-policy.test.ts.
// Provisions a tenant schema, inserts connection + session rows modeling each
// state, and runs handleConnectedEvent against the live Kysely builder to
// confirm the SELECT returns the two new columns and the predicate gates the
// bypass exactly as the fix intends. admitConnectedPhone / stopPairedSession
// are injected so no control-plane or NATS infra is contacted; the realtime
// broadcast is swallowed by broadcastToCompany, so Centrifugo is not required
// either.
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

type Admissions = Array<{ companyId: string; phoneNumber: string }>;

describe("connection admission bypass (real tenant DB)", () => {
  integrationTest(
    "G9: the prior SELECT returns session.connected_at and connection.logged_out_at",
    async () => {
      await withTenant(async (tenantDb) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const connectedAt = new Date();
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
            status: "connected",
            connected_at: connectedAt,
            started_at: new Date(),
          })
          .execute();

        const prior = await tenantDb
          .selectFrom("whatsapp_connection_sessions as session")
          .innerJoin(
            "whatsapp_connections as connection",
            "connection.id",
            "session.whatsapp_connection_id",
          )
          .select([
            "session.ended_at as session_ended_at",
            "session.connected_at as session_connected_at",
            "session.whatsapp_connection_id as stable_connection_id",
            "connection.phone_number as established_phone_number",
            "connection.archived_at as connection_archived_at",
            "connection.logged_out_at as connection_logged_out_at",
          ])
          .where("session.id", "=", sessionId)
          .executeTakeFirstOrThrow();

        expect(prior.session_connected_at).toEqual(connectedAt);
        expect(prior.connection_logged_out_at).toBeNull();
        expect(prior.established_phone_number).toBe("6584042683");
      });
    },
    30_000,
  );

  integrationTest(
    "G1: a credential-intact resume bypasses admission against the live DB",
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
            // status is "disconnected" after a worker crash; connected_at is retained.
            status: "disconnected",
            connected_at: new Date("2026-09-01T10:00:00Z"),
            started_at: new Date(),
          })
          .execute();

        const admissions: Admissions = [];
        const stops: PairedSessionStopInput[] = [];
        await handleConnectedEvent(
          connectedEvent(companyId, connectionId, sessionId) as never,
          {
            admitConnectedPhone: (async (input: { companyId: string; phoneNumber: string }) => {
              admissions.push(input);
              return { allowed: true };
            }) as never,
            stopPairedSession: (async (input: PairedSessionStopInput) => {
              stops.push(input);
            }) as never,
          },
        );

        expect(admissions).toEqual([]);
        expect(stops).toEqual([]);
        const session = await tenantDb
          .selectFrom("whatsapp_connection_sessions")
          .select(["status", "connected_at"])
          .where("id", "=", sessionId)
          .executeTakeFirstOrThrow();
        expect(session.status).toBe("connected");
      });
    },
    30_000,
  );

  integrationTest(
    "G2: a logged-out reconnect routes through admission against the live DB",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const loggedOutAt = new Date("2026-09-05T09:00:00Z");
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "n",
            status: "disconnected",
            phone_number: "6584042683",
            logged_out_at: loggedOutAt,
          })
          .execute();
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            id: sessionId,
            whatsapp_connection_id: connectionId,
            // ended_at stays null on logout; connected_at retained from prior connect.
            status: "disconnected",
            connected_at: new Date("2026-09-01T10:00:00Z"),
            started_at: new Date(),
          })
          .execute();

        const admissions: Admissions = [];
        const stops: PairedSessionStopInput[] = [];
        await handleConnectedEvent(
          connectedEvent(companyId, connectionId, sessionId) as never,
          {
            admitConnectedPhone: (async (input: { companyId: string; phoneNumber: string }) => {
              admissions.push(input);
              return {
                allowed: false,
                code: "payment_required",
                message: "Upgrade required",
                paymentRequired: true,
              };
            }) as never,
            stopPairedSession: (async (input: PairedSessionStopInput) => {
              stops.push(input);
            }) as never,
          },
        );

        expect(admissions).toEqual([{ companyId, phoneNumber: "6584042683" }]);
        expect(stops).toHaveLength(1);
        expect(stops[0]?.policy).toBe(
          PAIRED_SESSION_STOP_POLICIES.admissionRejected,
        );
        expect(stops[0]?.code).toBe("payment_required");
      });
    },
    30_000,
  );

  integrationTest(
    "G3: an archived relink routes through admission against the live DB",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        // relinkArchivedConnection nulls archived_at and creates a NEW session
        // (connected_at null) while phone_number is preserved.
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
            // brand-new relink session: no connected_at yet.
            started_at: new Date(),
          })
          .execute();

        const admissions: Admissions = [];
        const stops: PairedSessionStopInput[] = [];
        await handleConnectedEvent(
          connectedEvent(companyId, connectionId, sessionId) as never,
          {
            admitConnectedPhone: (async (input: { companyId: string; phoneNumber: string }) => {
              admissions.push(input);
              return {
                allowed: false,
                code: "payment_required",
                message: "Upgrade required",
                paymentRequired: true,
              };
            }) as never,
            stopPairedSession: (async (input: PairedSessionStopInput) => {
              stops.push(input);
            }) as never,
          },
        );

        expect(admissions).toEqual([{ companyId, phoneNumber: "6584042683" }]);
        expect(stops).toHaveLength(1);
        expect(stops[0]?.policy).toBe(
          PAIRED_SESSION_STOP_POLICIES.admissionRejected,
        );
      });
    },
    30_000,
  );

  integrationTest(
    "G4: a first-ever fresh pairing routes through admission against the live DB",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({ id: connectionId, name: "n", status: "pending" })
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

        const admissions: Admissions = [];
        const stops: PairedSessionStopInput[] = [];
        await handleConnectedEvent(
          connectedEvent(companyId, connectionId, sessionId) as never,
          {
            admitConnectedPhone: (async (input: { companyId: string; phoneNumber: string }) => {
              admissions.push(input);
              return { allowed: true };
            }) as never,
            stopPairedSession: (async (input: PairedSessionStopInput) => {
              stops.push(input);
            }) as never,
          },
        );

        expect(admissions).toEqual([{ companyId, phoneNumber: "6584042683" }]);
        expect(stops).toEqual([]);
      });
    },
    30_000,
  );

  integrationTest(
    "G8: an admission outage on a fresh pairing selects the non-unlinking stop policy against the live DB",
    async () => {
      await withTenant(async (tenantDb, companyId) => {
        const connectionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({ id: connectionId, name: "n", status: "pending" })
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

        const stops: PairedSessionStopInput[] = [];
        await handleConnectedEvent(
          connectedEvent(companyId, connectionId, sessionId) as never,
          {
            admitConnectedPhone: (async () => {
              throw new Error("simulated control-plane timeout");
            }) as never,
            stopPairedSession: (async (input: PairedSessionStopInput) => {
              stops.push(input);
            }) as never,
          },
        );

        expect(stops).toHaveLength(1);
        expect(stops[0]?.policy).toBe(
          PAIRED_SESSION_STOP_POLICIES.admissionUnavailable,
        );
        expect(stops[0]?.policy.unlink).toBe(false);
        expect(stops[0]?.policy.endSession).toBe(false);
      });
    },
    30_000,
  );
});
