import { describe, expect, mock, test } from "bun:test";
import type { ConnectionEvent } from "../../lib/nats/index.js";

/**
 * `logged_out` and `disconnected` share one handler, and should: both end with
 * the connection unusable and `status = 'disconnected'`.
 *
 * What must not collapse is whether the state can recover. The orchestrator
 * retries an ordinary drop with backoff and it usually heals with nobody
 * watching, so alerting on it would train people to ignore the alerts. A
 * logout means whatsmeow hit terminal 401/403 session loss and deleted its
 * credentials: no retry restores it, and reconnecting needs a person holding
 * the phone. These tests pin the difference — the stamp and the toast happen
 * for one and not the other.
 *
 * `mock.module` swaps a module for every test file in the run, so this suite
 * avoids it wherever it can. The tenant database is passed in through the
 * handler's injected parameter rather than mocked: stubbing `tenant.service`
 * globally broke the tenant-isolation suite, which needs the real Kysely
 * builder, and stubbing `whatsapp.service` broke the connection-archive and
 * worker-stop suites. Only `realtime` is mocked, to capture broadcasts, which
 * is the pattern the existing command-outcome suite already uses.
 */

const broadcasts: Array<{ event: string; payload: Record<string, unknown> }> =
  [];
const updates: Array<Record<string, unknown>> = [];

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

// Imported after the mock above so the handler binds the stubbed broadcaster.
const { handleDisconnectedEvent } = await import("./connection-handlers.js");

type FakeDb = Parameters<typeof handleDisconnectedEvent>[1];

function fakeTenantDb() {
  return {
    selectFrom() {
      return {
        select() {
          return this;
        },
        where() {
          return this;
        },
        // Serves both readers: the handler's sync check and the real
        // updateConnectionStatus looking the row up by id. Never mid-sync, so
        // the sync:interrupted branch stays out of the way.
        executeTakeFirst: () =>
          Promise.resolve({ id: "connection-1", sync_status: "completed" }),
      };
    },
    updateTable(_table: string) {
      return {
        set(values: Record<string, unknown>) {
          updates.push(values);
          return this;
        },
        where() {
          return this;
        },
        execute: () => Promise.resolve([]),
      };
    },
  } as unknown as FakeDb;
}

function connectionEvent(type: "logged_out" | "disconnected"): ConnectionEvent {
  return {
    contractVersion: 1,
    type,
    companyId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { reason: "401 unauthorized" },
  } as ConnectionEvent;
}

function reset() {
  updates.length = 0;
  broadcasts.length = 0;
}

describe("terminal logout versus ordinary disconnect", () => {
  test("a logout is stamped and clears the QR that can no longer pair", async () => {
    reset();
    await handleDisconnectedEvent(
      connectionEvent("logged_out"),
      fakeTenantDb(),
    );

    const stamped = updates.find((u) => "logged_out_at" in u);
    expect(stamped).toBeDefined();
    expect(stamped?.logged_out_at).not.toBeNull();
    expect(stamped?.qr_code).toBeNull();
    expect(stamped?.qr_expires_at).toBeNull();
  });

  test("a logout raises a toast and marks the broadcast permanent", async () => {
    reset();
    await handleDisconnectedEvent(
      connectionEvent("logged_out"),
      fakeTenantDb(),
    );

    const disconnected = broadcasts.find((b) => b.event === "disconnected");
    expect(disconnected?.payload.code).toBe("logged_out");

    const toast = broadcasts.find((b) => b.event === "notification:toast");
    expect(toast).toBeDefined();
    expect(toast?.payload.type).toBe("error");
    expect(String(toast?.payload.message)).toContain("QR");
  });

  test("an ordinary disconnect stays silent and unstamped", async () => {
    reset();
    await handleDisconnectedEvent(
      connectionEvent("disconnected"),
      fakeTenantDb(),
    );

    // Nothing here may imply permanence: this one is expected to heal.
    expect(updates.find((u) => "logged_out_at" in u)).toBeUndefined();
    expect(
      broadcasts.find((b) => b.event === "notification:toast"),
    ).toBeUndefined();

    const disconnected = broadcasts.find((b) => b.event === "disconnected");
    expect(disconnected).toBeDefined();
    expect(disconnected?.payload.code).toBeUndefined();
  });
});
