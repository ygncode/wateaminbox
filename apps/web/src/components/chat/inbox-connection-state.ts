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
 * Resolves the inbox landing state across every provider without treating a
 * failed or pending query as proof that a workspace has never linked a channel.
 */
export function resolveInboxConnectionState({
  connections,
  channelAccounts = [],
  isLoading,
  isError,
}: {
  connections: readonly ConnectionStatus[];
  channelAccounts?: readonly ConnectionStatus[];
  isLoading: boolean;
  isError: boolean;
}): InboxConnectionState {
  // A known account wins over another provider source that is still loading
  // or unavailable. Otherwise a connected Telegram bot plus an empty or
  // failed WhatsApp query can incorrectly reopen first-run onboarding.
  const accounts = [...connections, ...channelAccounts];
  if (accounts.length > 0) {
    return accounts.some((connection) => connection.status === "connected")
      ? "connected"
      : "offline";
  }
  if (isError) return "unavailable";
  if (isLoading) return "loading";
  return "no-connections";
}
