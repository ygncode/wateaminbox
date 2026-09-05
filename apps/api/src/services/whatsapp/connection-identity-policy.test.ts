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

describe("WhatsApp connection identity policy", () => {
  test("normalizes formatting variants to one phone identity", () => {
    expect(normalizeWhatsAppPhone("+1 (415) 555-0199")).toBe("14155550199");
    expect(normalizeWhatsAppPhone("1-415-555-0199")).toBe("14155550199");
    expect(normalizeWhatsAppPhone(" 14155550199 ")).toBe("14155550199");
  });

  test("retains a stable fallback for a non-numeric identity", () => {
    expect(normalizeWhatsAppPhone(" Business-Line ")).toBe("business-line");
  });

  test("established accounts bypass admission regardless of transient session status", () => {
    const prior = {
      session_ended_at: null,
      stable_connection_id: "connection-1",
      established_phone_number: "+65 8404 2683",
      connection_archived_at: null,
    };
    expect(isEstablishedReconnect(prior, "connection-1", "6584042683")).toBe(
      true,
    );
    expect(isEstablishedReconnect(prior, "connection-2", "6584042683")).toBe(
      false,
    );
    expect(
      isEstablishedReconnect(
        { ...prior, session_ended_at: new Date() },
        "connection-1",
        "6584042683",
      ),
    ).toBe(false);
    expect(isEstablishedReconnect(prior, "connection-1", "6584000000")).toBe(
      false,
    );
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
        stable_connection_id: "connection-1",
        established_phone_number: null,
        connection_archived_at: null,
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
