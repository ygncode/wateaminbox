import { describe, expect, test } from "bun:test";
import type { ConnectionWithState } from "@/hooks/useWhatsAppConnections";
import { getConnectionSetupStage } from "./setup-state";

const connection = (
  status: ConnectionWithState["status"],
  qrCode: string | null = null,
  error: string | null = null,
) =>
  ({
    status,
    localState: {
      qrCode,
      qrExpiresAt: null,
      error,
      isConnecting: status === "pending",
      isDisconnecting: false,
    },
  }) as ConnectionWithState;

describe("connection setup dialog stages", () => {
  test("keeps setup in the dialog from details through QR pairing", () => {
    expect(getConnectionSetupStage(null)).toBe("details");
    expect(getConnectionSetupStage(connection("pending"))).toBe("preparing");
    expect(getConnectionSetupStage(connection("pending", "qr-code"))).toBe(
      "qr",
    );
  });

  test("supports retry errors and closes only after connected status", () => {
    expect(
      getConnectionSetupStage(connection("pending", null, "QR expired")),
    ).toBe("error");
    expect(getConnectionSetupStage(connection("connected", "stale-qr"))).toBe(
      "connected",
    );
  });
});
