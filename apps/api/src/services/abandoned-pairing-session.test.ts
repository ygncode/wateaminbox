import { describe, expect, mock, test } from "bun:test";

/**
 * The worker-reported path (`qr_timeout` -> `handleDisconnectedEvent`) closes an
 * unscanned setup attempt the moment the worker says the code expired. This
 * sweep exists only for the attempts where that report never arrives, so these
 * tests pin the claim rather than the SQL: what it selects, that it ends the
 * session and enqueues the stop in the same transaction, and that it is quiet
 * when there is nothing to do.
 *
 * `mock.module` is used only for `realtime`, matching the sibling handler
 * suites, which document how stubbing `tenant.service` globally breaks the
 * tenant-isolation suite.
 */

const broadcasts: Array<{ event: string; payload: Record<string, unknown> }> =
  [];
const realtime = await import("../lib/realtime.js");
mock.module("../lib/realtime.js", () => ({
  ...realtime,
  broadcastToCompany: (
    _companyId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => {
    broadcasts.push({ event, payload });
    return Promise.resolve();
  },
}));

const { reapAbandonedPairingSessions } = await import(
  "./abandoned-pairing-session.service.js"
);

type Candidate = { id: string; whatsapp_connection_id: string } | null;

type Recorded = {
  sessionUpdates: Array<Record<string, unknown>>;
  connectionUpdates: Array<Record<string, unknown>>;
  outboxInserts: Array<Record<string, unknown>>;
  predicates: string[][];
};

/**
 * Serves candidates in order, then nothing -- the sweep stops on the first
 * empty claim, so a single-element queue is one reaped session.
 */
function fakeTenantDb(queue: Candidate[]) {
  const recorded: Recorded = {
    sessionUpdates: [],
    connectionUpdates: [],
    outboxInserts: [],
    predicates: [],
  };

  const trx = {
    isTransaction: true,
    selectFrom(table: string) {
      const columns: string[] = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        selectAll: () => builder,
        where(column: unknown) {
          if (typeof column === "string") columns.push(column);
          return builder;
        },
        whereRef: () => builder,
        orderBy: () => builder,
        forUpdate: () => builder,
        skipLocked: () => builder,
        limit: () => builder,
        exists: () => builder,
        executeTakeFirst: () => {
          if (table === "whatsapp_connection_sessions") {
            recorded.predicates.push(columns);
            return Promise.resolve(queue.shift() ?? null);
          }
          return Promise.resolve(undefined);
        },
        execute: () => Promise.resolve([]),
      };
      return builder;
    },
    updateTable(table: string) {
      const builder: Record<string, unknown> = {
        set(values: Record<string, unknown>) {
          if (table === "whatsapp_connection_sessions") {
            recorded.sessionUpdates.push(values);
          } else {
            recorded.connectionUpdates.push(values);
          }
          return builder;
        },
        where: () => builder,
        execute: () => Promise.resolve([]),
      };
      return builder;
    },
    insertInto() {
      const builder: Record<string, unknown> = {
        values(v: Record<string, unknown>) {
          recorded.outboxInserts.push(v);
          return builder;
        },
        execute: () => Promise.resolve([]),
      };
      return builder;
    },
  };

  const tenantDb = {
    isTransaction: false,
    transaction: () => ({
      execute: (fn: (t: unknown) => Promise<unknown>) => fn(trx),
    }),
  };

  return {
    recorded,
    db: tenantDb as unknown as Parameters<
      typeof reapAbandonedPairingSessions
    >[0],
  };
}

function reset() {
  broadcasts.length = 0;
}

describe("reaping an abandoned pairing session", () => {
  test("ends the session and enqueues the stop in one transaction", async () => {
    reset();
    const { db, recorded } = fakeTenantDb([
      { id: "session-1", whatsapp_connection_id: "connection-1" },
    ]);

    const reaped = await reapAbandonedPairingSessions(db, "company-1");

    expect(reaped).toBe(1);
    // Session closed with a reason rather than merely marked disconnected.
    expect(recorded.sessionUpdates).toHaveLength(1);
    expect(recorded.sessionUpdates[0].status).toBe("ended");
    expect(recorded.sessionUpdates[0].end_reason).toBe(
      "QR pairing expired without a scan",
    );
    // Stale QR cleared on the connection.
    expect(recorded.connectionUpdates).toHaveLength(1);
    expect(recorded.connectionUpdates[0].status).toBe("disconnected");
    expect(recorded.connectionUpdates[0].qr_code).toBeNull();
    // The kill rides the same transaction through the command outbox.
    expect(recorded.outboxInserts).toHaveLength(1);
    const payload = recorded.outboxInserts[0].payload as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("kill");
    expect(payload.unlink).toBe(false);
    expect(recorded.outboxInserts[0].subject).toContain("session-1");
  });

  test("claims only unscanned, unclosed, aged-out attempts", async () => {
    reset();
    const { db, recorded } = fakeTenantDb([
      { id: "session-1", whatsapp_connection_id: "connection-1" },
    ]);

    await reapAbandonedPairingSessions(db, "company-1");

    const [columns] = recorded.predicates;
    expect(columns).toContain("connected_at");
    expect(columns).toContain("ended_at");
    expect(columns).toContain("started_at");
  });

  test("refreshes an open page without raising an error toast", async () => {
    reset();
    const { db } = fakeTenantDb([
      { id: "session-1", whatsapp_connection_id: "connection-1" },
    ]);

    await reapAbandonedPairingSessions(db, "company-1");

    expect(broadcasts.map((b) => b.event)).toEqual(["disconnected"]);
    // The worker-reported path toasts someone watching their code expire. This
    // one is cleaning up an attempt abandoned a quarter of an hour ago.
    expect(broadcasts.some((b) => b.event === "notification:toast")).toBe(false);
  });

  test("does nothing, and writes nothing, when there is no candidate", async () => {
    reset();
    const { db, recorded } = fakeTenantDb([]);

    const reaped = await reapAbandonedPairingSessions(db, "company-1");

    expect(reaped).toBe(0);
    expect(recorded.sessionUpdates).toHaveLength(0);
    expect(recorded.connectionUpdates).toHaveLength(0);
    expect(recorded.outboxInserts).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  test("stops claiming as soon as a cycle is asked to stop", async () => {
    reset();
    const { db, recorded } = fakeTenantDb([
      { id: "session-1", whatsapp_connection_id: "connection-1" },
      { id: "session-2", whatsapp_connection_id: "connection-2" },
    ]);

    const reaped = await reapAbandonedPairingSessions(db, "company-1", {
      shouldStop: () => true,
    });

    expect(reaped).toBe(0);
    expect(recorded.outboxInserts).toHaveLength(0);
  });

  test("honours the per-cycle limit", async () => {
    reset();
    const { db, recorded } = fakeTenantDb([
      { id: "session-1", whatsapp_connection_id: "connection-1" },
      { id: "session-2", whatsapp_connection_id: "connection-2" },
      { id: "session-3", whatsapp_connection_id: "connection-3" },
    ]);

    const reaped = await reapAbandonedPairingSessions(db, "company-1", {
      limit: 2,
    });

    expect(reaped).toBe(2);
    expect(recorded.outboxInserts).toHaveLength(2);
  });
});
