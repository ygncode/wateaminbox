import type { ConnectionWithState } from "@/hooks/useWhatsAppConnections";

export type ConnectionSetupStage =
  | "details"
  | "preparing"
  | "qr"
  | "error"
  | "connected";

/** Derives the resumable setup dialog stage from server and realtime state. */
export function getConnectionSetupStage(
  connection: ConnectionWithState | null,
): ConnectionSetupStage {
  if (!connection) return "details";
  if (connection.status === "connected") return "connected";
  if (connection.localState.qrCode) return "qr";
  if (connection.localState.error) return "error";
  return "preparing";
}
