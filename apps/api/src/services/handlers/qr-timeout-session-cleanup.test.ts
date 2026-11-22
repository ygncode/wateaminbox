import { describe, expect, test } from "bun:test";
import type { ConnectionEvent } from "../../lib/nats/index.js";
import {
  handleDisconnectedEvent,
  PAIRED_SESSION_STOP_POLICIES,
  type PairedSessionStopInput,
} from "./connection-handlers.js";

/**
 * A QR that expires unscanned ends a setup attempt, and before this nothing
 * acted on it: the worker stayed alive with no paired device, holding a
 * connection slot against the fleet cap, and the session row kept `ended_at`
 * null so it still read as the connection's active session. One was found in
 * production sitting idle for hours.
 *
 * The stop path is injected rather than mocked. `mock.module` swaps a module
 * for the whole test run, and the sibling suites in this directory document
 * how stubbing `tenant.service` or `whatsapp.service` globally breaks the
 * tenant-isolation and worker-stop suites.
 */

type FakeDb = Parameters<typeof handleDisconnectedEvent>[1];
type StopInput = PairedSessionStopInput;

function fakeTenantDb(
  session: {
    connected_at: Date | null;
    ended_at: Date | null;
    status?: string;
  } | null,
  connection: {
    status?: string;
    logged_out_at?: Date | null;
    archived_at?: Date | null;
  } = {},
) {
  return {
    selectFrom(table: string) {
      return {
        select() {
          return this;
        },
        where() {
          return this;
        },
        executeTakeFirst: () =>
          Promise.resolve(
            table === "whatsapp_connection_sessions"
              ? session && {
                  status: "disconnected",
                  whatsapp_connection_id: "connection-1",
                  ...session,
                }
              : {
                  id: "connection-1",
                  sync_status: "completed",
                  status: "disconnected",
                  logged_out_at: null,
                  archived_at: null,
                  ...connection,
                },
          ),
      };
    },
    updateTable() {
      return {
        set() {
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

function disconnectEvent(reason: string): ConnectionEvent {
  return {
    contractVersion: 1,
    type: "disconnected",
    companyId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { reason },
  } as ConnectionEvent;
}

function recorder() {
  const calls: StopInput[] = [];
  return {
    calls,
    stop: (input: StopInput) => {
      calls.push(input);
      return Promise.resolve();
    },
  };
}

describe("a pairing session whose QR expired unscanned", () => {
  test("is ended and its worker stopped, without unlinking or archiving", async () => {
    const stop = recorder();
    const event = disconnectEvent("qr_timeout");

    await handleDisconnectedEvent(
      event,
      fakeTenantDb({ connected_at: null, ended_at: null }),
      stop.stop,
    );

    expect(stop.calls).toHaveLength(1);
    const [input] = stop.calls;
    expect(input.sessionId).toBe(event.sessionId as string);
    expect(input.connectionId).toBe(event.connectionId);
    expect(input.policy).toBe(PAIRED_SESSION_STOP_POLICIES.qrExpired);
    // Nothing paired, so there is nothing to log out of and no account to
    // archive -- only the session is closed.
    expect(input.policy.unlink).toBe(false);
    expect(input.policy.archive).toBe(false);
    expect(input.policy.endSession).toBe(true);
  });

  test("is left alone once the session has already connected", async () => {
    const stop = recorder();

    await handleDisconnectedEvent(
      disconnectEvent("qr_timeout"),
      fakeTenantDb({ connected_at: new Date(), ended_at: null }),
      stop.stop,
    );

    // A session holding real credentials must survive a late or replayed
    // timeout; it takes the ordinary disconnect path instead.
    expect(stop.calls).toHaveLength(0);
  });

  test("is not stopped twice when the event is redelivered", async () => {
    const stop = recorder();

    await handleDisconnectedEvent(
      disconnectEvent("qr_timeout"),
      fakeTenantDb({ connected_at: null, ended_at: new Date() }),
      stop.stop,
    );

    expect(stop.calls).toHaveLength(0);
  });

  test("is ignored when the session row has gone", async () => {
    const stop = recorder();

    await handleDisconnectedEvent(
      disconnectEvent("qr_timeout"),
      fakeTenantDb(null),
      stop.stop,
    );

    expect(stop.calls).toHaveLength(0);
  });
});

describe("a re-pair whose QR expired after WhatsApp logged the number out", () => {
  // Reconnect reuses the logged-out session row, so `connected_at` is set from
  // the first pairing even though whatsmeow deleted the credentials. Without
  // this, the worker sat showing QR codes to nobody, holding a slot, for weeks.
  const once = new Date("2026-10-29T06:35:42Z");
  const loggedOut = new Date("2026-10-29T06:31:00Z");

  test("is ended and its worker stopped, without unlinking or archiving", async () => {
    const stop = recorder();
    const event = disconnectEvent("qr_timeout");

    await handleDisconnectedEvent(
      event,
      fakeTenantDb(
        { connected_at: once, ended_at: null },
        { logged_out_at: loggedOut },
      ),
      stop.stop,
    );

    expect(stop.calls).toHaveLength(1);
    const [input] = stop.calls;
    expect(input.sessionId).toBe(event.sessionId as string);
    expect(input.policy).toBe(PAIRED_SESSION_STOP_POLICIES.qrExpired);
    expect(input.policy.unlink).toBe(false);
    expect(input.policy.archive).toBe(false);
    expect(input.title).toBe("WhatsApp re-link expired");
  });

  test("is left alone while the session or the account is connected", async () => {
    for (const [session, connection] of [
      [
        { connected_at: once, ended_at: null, status: "connected" },
        { logged_out_at: loggedOut },
      ],
      [
        { connected_at: once, ended_at: null },
        { logged_out_at: loggedOut, status: "connected" },
      ],
    ] as const) {
      const stop = recorder();
      await handleDisconnectedEvent(
        disconnectEvent("qr_timeout"),
        fakeTenantDb(session, connection),
        stop.stop,
      );
      expect(stop.calls).toHaveLength(0);
    }
  });

  test("leaves a session that merely dropped (no logout) to recover", async () => {
    const stop = recorder();
    await handleDisconnectedEvent(
      disconnectEvent("qr_timeout"),
      fakeTenantDb(
        { connected_at: once, ended_at: null },
        { logged_out_at: null },
      ),
      stop.stop,
    );
    expect(stop.calls).toHaveLength(0);
  });

  test("leaves an archived account alone", async () => {
    const stop = recorder();
    await handleDisconnectedEvent(
      disconnectEvent("qr_timeout"),
      fakeTenantDb(
        { connected_at: once, ended_at: null },
        { logged_out_at: loggedOut, archived_at: new Date() },
      ),
      stop.stop,
    );
    expect(stop.calls).toHaveLength(0);
  });
});

describe("every other disconnect", () => {
  test("keeps taking the ordinary path", async () => {
    const stop = recorder();

    await handleDisconnectedEvent(
      disconnectEvent("401 unauthorized"),
      fakeTenantDb({ connected_at: null, ended_at: null }),
      stop.stop,
    );

    expect(stop.calls).toHaveLength(0);
  });

  test("keeps taking the ordinary path for a terminal logout", async () => {
    const stop = recorder();
    const event = {
      ...disconnectEvent("qr_timeout"),
      type: "logged_out",
    } as ConnectionEvent;

    // A logged-out device had credentials. Even carrying this reason it must
    // reach the logout branch, which stamps `logged_out_at`.
    await handleDisconnectedEvent(
      event,
      fakeTenantDb({ connected_at: null, ended_at: null }),
      stop.stop,
    );

    expect(stop.calls).toHaveLength(0);
  });
});
