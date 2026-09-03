import { beforeEach, describe, expect, test } from "bun:test";

process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";
process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ??=
  "test-centrifugo-secret-at-least-32-chars";

const connectedEvents: Array<{ type: string; sessionId?: string }> = [];
const disconnectedEvents: Array<{ type: string; sessionId?: string }> = [];
let sessionStatus = "connected";

const { handleWhatsAppEvent } = await import("./message-handler.js");
type FakeDb = Parameters<typeof handleWhatsAppEvent>[1];

function connectionEvent(
  type: "paired" | "connected" | "disconnected" | "logged_out",
) {
  return {
    contractVersion: 1 as const,
    type,
    companyId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    payload: {
      phoneNumber:
        type === "paired" || type === "connected" ? "15551234567" : "",
      jid:
        type === "paired" || type === "connected"
          ? "15551234567@s.whatsapp.net"
          : "",
      reason: type === "logged_out" ? "403: device logged out" : "",
    },
    timestamp: new Date().toISOString(),
  };
}

function handleConnectionEvent(
  type: "paired" | "connected" | "disconnected" | "logged_out",
) {
  return handleWhatsAppEvent(connectionEvent(type), {} as FakeDb, {
    resolveSession: () =>
      Promise.resolve({
        sessionId: "22222222-2222-4222-8222-222222222222",
        connectionId: "33333333-3333-4333-8333-333333333333",
        status: sessionStatus,
      }),
    handleConnected: (event) => {
      connectedEvents.push(event);
      return Promise.resolve();
    },
    handleDisconnected: (event) => {
      disconnectedEvents.push(event);
      return Promise.resolve();
    },
  });
}

describe("worker connection lifecycle routing", () => {
  beforeEach(() => {
    connectedEvents.length = 0;
    disconnectedEvents.length = 0;
    sessionStatus = "connected";
  });

  test.each(["paired", "connected"] as const)(
    "routes %s through the connected identity claim",
    async (type) => {
      await handleConnectionEvent(type);

      expect(connectedEvents).toHaveLength(1);
      expect(connectedEvents[0]).toMatchObject({
        type,
        sessionId: "22222222-2222-4222-8222-222222222222",
      });
      expect(disconnectedEvents).toHaveLength(0);
    },
  );

  test.each(["disconnected", "logged_out"] as const)(
    "routes %s through disconnect persistence",
    async (type) => {
      await handleConnectionEvent(type);

      expect(disconnectedEvents).toHaveLength(1);
      expect(disconnectedEvents[0]).toMatchObject({
        type,
        sessionId: "22222222-2222-4222-8222-222222222222",
      });
      expect(connectedEvents).toHaveLength(0);
    },
  );

  test("does not drop logged_out for an already-ended session", async () => {
    sessionStatus = "ended";

    await handleConnectionEvent("logged_out");

    expect(disconnectedEvents).toHaveLength(1);
  });
});
