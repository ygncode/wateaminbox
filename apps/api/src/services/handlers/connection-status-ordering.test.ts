import { describe, expect, mock, test } from "bun:test";
import type { WorkerConnectionStatusEvent } from "../../lib/nats/index.js";

const broadcasts: Array<{ event: string; payload: Record<string, unknown> }> =
  [];

const realtime = await import("../../lib/realtime.js");
mock.module("../../lib/realtime.js", () => ({
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

const { handleWorkerConnectionStatusEvent } = await import(
  "./connection-handlers.js"
);

type FakeDb = Parameters<typeof handleWorkerConnectionStatusEvent>[1];

function fakeTenantDb(options: { connectionUpdateApplied: boolean }) {
  const whereCalls: Array<[string, string, unknown]> = [];
  const sessionUpdates: Array<Record<string, unknown>> = [];

  return {
    whereCalls,
    sessionUpdates,
    db: {
      updateTable(table: string) {
        const state = { table, values: {} as Record<string, unknown> };
        return {
          set(values: Record<string, unknown>) {
            state.values = values;
            if (table === "whatsapp_connection_sessions") {
              sessionUpdates.push(values);
            }
            return this;
          },
          where(column: string, operator: string, value: unknown) {
            whereCalls.push([column, operator, value]);
            return this;
          },
          returning() {
            return this;
          },
          execute: () => Promise.resolve([]),
          executeTakeFirst: () =>
            Promise.resolve(
              options.connectionUpdateApplied
                ? { id: "connection-1" }
                : undefined,
            ),
        };
      },
    } as unknown as FakeDb,
  };
}

function connectingEvent(): WorkerConnectionStatusEvent {
  return {
    contractVersion: 1,
    type: "connection_status",
    companyId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { status: "connecting", reason: "worker process started" },
  } as WorkerConnectionStatusEvent;
}

describe("worker connection-status ordering", () => {
  test("fences connecting updates against an already-connected session and account", async () => {
    broadcasts.length = 0;
    const fake = fakeTenantDb({ connectionUpdateApplied: false });
    await handleWorkerConnectionStatusEvent(connectingEvent(), fake.db);
    expect(fake.whereCalls).toContainEqual(["status", "!=", "connected"]);
    expect(fake.whereCalls.filter((call) => call[0] === "status")).toHaveLength(
      2,
    );
    expect(broadcasts).toEqual([]);
  });

  test("still applies and broadcasts a genuine connecting transition", async () => {
    broadcasts.length = 0;
    const fake = fakeTenantDb({ connectionUpdateApplied: true });
    await handleWorkerConnectionStatusEvent(connectingEvent(), fake.db);
    expect(fake.sessionUpdates[0]?.status).toBe("connecting");
    expect(broadcasts).toContainEqual({
      event: "connection:status",
      payload: { status: "connecting", reason: "worker process started" },
    });
  });
});
