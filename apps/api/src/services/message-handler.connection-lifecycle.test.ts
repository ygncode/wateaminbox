import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";
process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ??=
  "test-centrifugo-secret-at-least-32-chars";

const connectedEvents: Array<{ type: string; sessionId?: string }> = [];
const disconnectedEvents: Array<{ type: string; sessionId?: string }> = [];
let sessionStatus = "connected";

mock.module("../lib/nats/index.js", () => ({
  natsLifecycle: {
    startEventSupervisor: () => {},
    shutdown: () => Promise.resolve(),
    isConsumerActive: () => false,
  },
}));

mock.module("./tenant.service.js", () => ({
  getTenantConnection: () => ({}),
}));

mock.module("./whatsapp/session.js", () => ({
  resolveWhatsAppSession: () =>
    Promise.resolve({
      sessionId: "22222222-2222-4222-8222-222222222222",
      connectionId: "33333333-3333-4333-8333-333333333333",
      status: sessionStatus,
    }),
}));

const noOpHandler = () => Promise.resolve();
mock.module("./handlers/index.js", () => ({
  handleCatalogProductsEvent: noOpHandler,
  handleCatalogsEvent: noOpHandler,
  handleCommandResultEvent: noOpHandler,
  handleConnectedEvent: (event: { type: string; sessionId?: string }) => {
    connectedEvents.push(event);
    return Promise.resolve();
  },
  handleContactEvent: noOpHandler,
  handleDisconnectedEvent: (event: { type: string; sessionId?: string }) => {
    disconnectedEvents.push(event);
    return Promise.resolve();
  },
  handleDownloadResponseEvent: noOpHandler,
  handleErrorEvent: noOpHandler,
  handleGroupEvent: noOpHandler,
  handleLabelsEvent: noOpHandler,
  handleHistorySyncPageEvent: noOpHandler,
  handleMessageEvent: noOpHandler,
  handleMessageRevokeEvent: noOpHandler,
  handlePresenceEvent: noOpHandler,
  handleProfilePictureEvent: noOpHandler,
  handleQREvent: noOpHandler,
  handleReactionEvent: noOpHandler,
  handleReceiptEvent: noOpHandler,
  handleSendConfirmationEvent: noOpHandler,
  handleSendFailedEvent: noOpHandler,
  handleStatusEvent: noOpHandler,
  handleSyncStatusEvent: noOpHandler,
  handleTypingEvent: noOpHandler,
  handleWorkerConnectionStatusEvent: noOpHandler,
}));

const { handleWhatsAppEvent } = await import("./message-handler.js");

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

describe("worker connection lifecycle routing", () => {
  beforeEach(() => {
    connectedEvents.length = 0;
    disconnectedEvents.length = 0;
    sessionStatus = "connected";
  });

  test.each(["paired", "connected"] as const)(
    "routes %s through the connected identity claim",
    async (type) => {
      await handleWhatsAppEvent(connectionEvent(type));

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
      await handleWhatsAppEvent(connectionEvent(type));

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

    await handleWhatsAppEvent(connectionEvent("logged_out"));

    expect(disconnectedEvents).toHaveLength(1);
  });
});
