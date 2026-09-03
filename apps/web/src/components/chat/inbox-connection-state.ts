export type InboxConnectionState =
  | "loading"
  | "unavailable"
  | "no-connections"
  | "offline"
  | "connected";

interface ConnectionStatus {
  status: string;
}

/**
 * Resolves the inbox landing state without treating a failed or pending query
 * as proof that a workspace has never linked WhatsApp.
 */
export function resolveInboxConnectionState({
  connections,
  isLoading,
  isError,
}: {
  connections: readonly ConnectionStatus[];
  isLoading: boolean;
  isError: boolean;
}): InboxConnectionState {
  if (isError) return "unavailable";
  if (isLoading) return "loading";
  if (connections.length === 0) return "no-connections";
  return connections.some((connection) => connection.status === "connected")
    ? "connected"
    : "offline";
}
