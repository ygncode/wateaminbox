import { describe, expect, test } from "bun:test";
import { NatsCommandPublisher } from "../../lib/nats/command-builder.js";
import type { NatsCommand } from "../../lib/nats/types/index.js";
import type { enqueueSessionCommand } from "../command-outbox.service.js";
import {
  enqueuePairedSessionStop,
  handleConnectedEvent,
  isEstablishedReconnect,
  PAIRED_SESSION_STOP_POLICIES,
  type PairedSessionStopInput,
} from "../handlers/connection-handlers.js";
import { normalizeWhatsAppPhone } from "./status.js";

// Builds the chainable fake the `prior` lookup in `handleConnectedEvent` drives.
// `prior` is the row the SELECT returns; `undefined` simulates no session found.
function buildPriorLookup(prior: Record<string, unknown> | undefined) {
  const select = {
    innerJoin: () => select,
    select: () => select,
    where: () => select,
    executeTakeFirst: async () => prior,
  };
  return (() => ({ selectFrom: () => select })) as never;
}

function connectedEvent(payloadPhoneNumber = "6584042683") {
  return {
    contractVersion: 1,
    type: "connected",
    companyId: "company-1",
    connectionId: "connection-1",
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    payload: {
      phoneNumber: payloadPhoneNumber,
      jid: `${payloadPhoneNumber}@s.whatsapp.net`,
    },
  } as const;
}

// A tenant-database fake that supports the bypass branch of `handleConnectedEvent`
// end-to-end: the `prior` SELECT, `updateSessionStatus`'s update, and
// `updateConnectionStatus`'s connected+phone transaction (advisory lock,
// duplicate scan, update). `broadcastToCompany` swallows its Centrifugo errors,
// so the trailing realtime publish resolves without infra. The real Kysely
// interaction — including this transaction — is exercised by the integration
// suites; this isolation fake only asserts the bypass branch is reached and
// admission is not.
function makeBypassFakeDb(prior: Record<string, unknown> | undefined) {
  const selectChain = {
    innerJoin: () => selectChain,
    select: () => selectChain,
    where: () => selectChain,
    executeTakeFirst: async () => prior,
  };
  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    execute: async () => [],
  };
  // The transaction body uses the real `sql` tag for the advisory lock, which
  // calls `executorProvider.getExecutor().executeQuery(...)`, then drives
  // `trx.selectFrom`/`trx.updateTable` for the duplicate scan and the write.
  const trxSelectChain = {
    select: () => trxSelectChain,
    where: () => trxSelectChain,
    executeTakeFirst: async () => undefined, // no duplicate phone in workspace
  };
  const trx = {
    getExecutor: () => ({
      // The real `sql` tag compiles then executes via these three methods.
      transformQuery: (node: unknown) => node,
      compileQuery: (node: unknown) => ({
        sql: "",
        parameters: [],
        query: node,
      }),
      executeQuery: async () => ({ rows: [] }),
    }),
    selectFrom: () => trxSelectChain,
    updateTable: () => updateChain,
  };
  return (() => ({
    selectFrom: () => selectChain,
    updateTable: () => updateChain,
    transaction: () => ({
      execute: async (fn: (t: typeof trx) => Promise<unknown>) => fn(trx),
    }),
  })) as never;
}

describe("WhatsApp connection identity policy", () => {
  test("normalizes formatting variants to one phone identity", () => {
    expect(normalizeWhatsAppPhone("+1 (415) 555-0199")).toBe("14155550199");
    expect(normalizeWhatsAppPhone("1-415-555-0199")).toBe("14155550199");
    expect(normalizeWhatsAppPhone(" 14155550199 ")).toBe("14155550199");
  });

  test("retains a stable fallback for a non-numeric identity", () => {
    expect(normalizeWhatsAppPhone(" Business-Line ")).toBe("business-line");
  });

  test("a credential-intact resume bypasses admission (process restart, no new entitlement)", () => {
    // A worker-process restart reuses the still-linked session. `connected_at`
    // was set on the original `"connected"` transition and survives every
    // `updateSessionStatus("disconnected"/"connecting")` write, and the device
    // was never logged out, so this is the intended bypass.
    const resume = {
      session_ended_at: null,
      session_connected_at: new Date("2026-09-01T10:00:00Z"),
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
      connection_logged_out_at: null,
    };
    expect(isEstablishedReconnect(resume, "connection-1", "6584042683")).toBe(
      true,
    );
    expect(
      isEstablishedReconnect(
        { ...resume, session_ended_at: new Date() },
        "connection-1",
        "6584042683",
      ),
    ).toBe(false);
    expect(isEstablishedReconnect(resume, "connection-2", "6584042683")).toBe(
      false,
    );
    expect(isEstablishedReconnect(resume, "connection-1", "6584000000")).toBe(
      false,
    );
  });

  test("a logged-out reconnect is admitted even though phone_number survives the logout", () => {
    // `handleDisconnectedEvent` (loggedOut) sets `logged_out_at` but leaves
    // `session.ended_at` null and never clears `connection.phone_number`. The
    // reconnect therefore re-scans a QR for the same phone — a fresh pairing
    // that must run through the control plane instead of being bypassed.
    const loggedOutReconnect = {
      session_ended_at: null,
      session_connected_at: new Date("2026-09-01T10:00:00Z"),
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
      connection_logged_out_at: new Date("2026-09-05T09:00:00Z"),
    };
    expect(
      isEstablishedReconnect(loggedOutReconnect, "connection-1", "6584042683"),
    ).toBe(false);
  });

  test("an archived relink is admitted even though archived_at is cleared before the event", () => {
    // `relinkArchivedConnection` nulls `archived_at` and creates a brand-new
    // session with no `connected_at` before spawning. The expected phone is
    // enforced at claim time, so the re-paired phone equals the preserved
    // `phone_number` — but the fresh session distinguishes this from a resume.
    const archivedRelink = {
      session_ended_at: null,
      session_connected_at: null,
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
      connection_logged_out_at: null,
    };
    expect(
      isEstablishedReconnect(archivedRelink, "connection-1", "6584042683"),
    ).toBe(false);
  });

  test("a first-ever fresh pairing is admitted (no prior phone identity)", () => {
    const fresh = {
      session_ended_at: null,
      session_connected_at: null,
      stable_connection_id: "connection-1",
      established_phone_number: null,
      connection_archived_at: null,
      connection_logged_out_at: null,
    };
    expect(isEstablishedReconnect(fresh, "connection-1", "6584042683")).toBe(
      false,
    );
  });

  test("undefined prior is admitted (no row found for the session)", () => {
    expect(
      isEstablishedReconnect(undefined, "connection-1", "6584042683"),
    ).toBe(false);
  });

  test("admission outages queue a non-unlinking stop while explicit denials unlink", async () => {
    const commands: NatsCommand[] = [];
    const fakeEnqueue = (async (
      _executor: unknown,
      companyId: string,
      sessionId: string,
      build: (publisher: NatsCommandPublisher) => Promise<void>,
    ) => {
      await build(
        new NatsCommandPublisher(
          companyId,
          sessionId,
          async (_subject, command) => {
            commands.push(command);
          },
          () => "TEST.commands",
        ),
      );
    }) as typeof enqueueSessionCommand;

    await enqueuePairedSessionStop(
      {} as never,
      "company-1",
      "session-1",
      "admission unavailable",
      PAIRED_SESSION_STOP_POLICIES.admissionUnavailable,
      fakeEnqueue,
    );
    await enqueuePairedSessionStop(
      {} as never,
      "company-1",
      "session-2",
      "admission rejected",
      PAIRED_SESSION_STOP_POLICIES.admissionRejected,
      fakeEnqueue,
    );

    expect(commands).toEqual([
      expect.objectContaining({
        type: "kill",
        connection_id: "session-1",
        unlink: false,
      }),
      expect.objectContaining({
        type: "kill",
        connection_id: "session-2",
        unlink: true,
      }),
    ]);
    expect(PAIRED_SESSION_STOP_POLICIES.admissionUnavailable.endSession).toBe(
      false,
    );
    expect(PAIRED_SESSION_STOP_POLICIES.admissionRejected.endSession).toBe(
      true,
    );
  });

  test("the connected-event failure path selects the recoverable non-unlink policy", async () => {
    const event = {
      contractVersion: 1,
      type: "connected",
      companyId: "company-1",
      connectionId: "connection-1",
      sessionId: "session-1",
      timestamp: new Date().toISOString(),
      payload: { phoneNumber: "6584042683", jid: "6584042683@s.whatsapp.net" },
    } as const;
    const select = {
      innerJoin: () => select,
      select: () => select,
      where: () => select,
      executeTakeFirst: async () => ({
        session_ended_at: null,
        session_connected_at: null,
        stable_connection_id: "connection-1",
        established_phone_number: null,
        connection_archived_at: null,
        connection_logged_out_at: null,
      }),
    };
    const stops: Array<{ policy: { unlink: boolean; endSession: boolean } }> =
      [];

    await handleConnectedEvent(event as never, {
      getTenantConnection: (() => ({ selectFrom: () => select })) as never,
      admitConnectedPhone: async () => {
        throw new Error("simulated control-plane timeout");
      },
      stopPairedSession: (async (input: PairedSessionStopInput) => {
        stops.push(input);
      }) as never,
    });

    expect(stops).toHaveLength(1);
    expect(stops[0]?.policy).toMatchObject({
      unlink: false,
      endSession: false,
    });
  });

  test("a logged-out reconnect routes through admission instead of bypassing it", async () => {
    // phone_number survives the logout and the session is reused (ended_at
    // null, connected_at set); only logged_out_at distinguishes this fresh QR
    // re-pair from a credential-intact resume. Admission must be consulted.
    const prior = {
      session_ended_at: null,
      session_connected_at: new Date("2026-09-01T10:00:00Z"),
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
      connection_logged_out_at: new Date("2026-09-05T09:00:00Z"),
    };
    const admissions: Array<{ companyId: string; phoneNumber: string }> = [];
    const stops: PairedSessionStopInput[] = [];

    await handleConnectedEvent(connectedEvent() as never, {
      getTenantConnection: buildPriorLookup(prior) as never,
      admitConnectedPhone: (async (input: {
        companyId: string;
        phoneNumber: string;
      }) => {
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
    });

    expect(admissions).toEqual([
      { companyId: "company-1", phoneNumber: "6584042683" },
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.policy).toBe(
      PAIRED_SESSION_STOP_POLICIES.admissionRejected,
    );
    expect(stops[0]?.code).toBe("payment_required");
  });

  test("an archived relink routes through admission instead of bypassing it", async () => {
    // relinkArchivedConnection nulls archived_at and spawns a brand-new session
    // (connected_at null) while preserving phone_number. The fresh pair's
    // Connected event carries the preserved phone, but the new session with no
    // connected_at must be admitted.
    const prior = {
      session_ended_at: null,
      session_connected_at: null,
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
      connection_logged_out_at: null,
    };
    const admissions: Array<{ companyId: string; phoneNumber: string }> = [];
    const stops: PairedSessionStopInput[] = [];

    await handleConnectedEvent(connectedEvent() as never, {
      getTenantConnection: buildPriorLookup(prior) as never,
      admitConnectedPhone: (async (input: {
        companyId: string;
        phoneNumber: string;
      }) => {
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
    });

    expect(admissions).toEqual([
      { companyId: "company-1", phoneNumber: "6584042683" },
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.policy).toBe(
      PAIRED_SESSION_STOP_POLICIES.admissionRejected,
    );
  });

  test("a credential-intact resume still bypasses admission (no regression in the intended bypass)", async () => {
    // The same phone, an un-ended, un-archived, un-logged-out session that was
    // previously connected: this is the worker-restart resume the bypass exists
    // for. Admission must NOT be consulted, and no paired-session stop runs.
    const prior = {
      session_ended_at: null,
      session_connected_at: new Date("2026-09-01T10:00:00Z"),
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
      connection_logged_out_at: null,
    };
    const admissions: Array<{ companyId: string; phoneNumber: string }> = [];
    const stops: PairedSessionStopInput[] = [];

    const result = handleConnectedEvent(connectedEvent() as never, {
      getTenantConnection: makeBypassFakeDb(prior),
      admitConnectedPhone: (async (input: {
        companyId: string;
        phoneNumber: string;
      }) => {
        admissions.push(input);
        return { allowed: true };
      }) as never,
      stopPairedSession: (async (input: PairedSessionStopInput) => {
        stops.push(input);
      }) as never,
    });

    await expect(result).resolves.toBeUndefined();
    expect(admissions).toEqual([]);
    expect(stops).toEqual([]);
  });

  test("the database migration enforces one non-null phone per workspace", async () => {
    const migration = await Bun.file(
      new URL(
        "../../../../../packages/database/src/migrations/046_unique_whatsapp_phone_connections.ts",
        import.meta.url,
      ),
    ).text();
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(migration).toContain("(phone_number)");
    expect(migration).toContain("WHERE phone_number IS NOT NULL");
  });

  test("stable inbox identities are separated from replaceable sessions", async () => {
    const migration = await Bun.file(
      new URL(
        "../../../../../packages/database/src/migrations/052_separate_whatsapp_accounts_and_sessions.ts",
        import.meta.url,
      ),
    ).text();
    expect(migration).toContain("whatsapp_connection_sessions");
    expect(migration).toContain("whatsapp_connection_id UUID NOT NULL");
    expect(migration).toContain("WHERE ended_at IS NULL");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS archived_at");
  });
});
