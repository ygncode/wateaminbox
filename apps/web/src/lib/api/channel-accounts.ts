import type {
  Channel,
  ChannelProvider,
  ResolvedCapabilities,
} from "@wateaminbox/shared";
import { api } from "./client";

export type ChannelAccountStatus =
  | "connecting"
  | "connected"
  | "degraded"
  | "disconnected"
  | "disabled"
  | "error"
  | "archived";

/** Channel-neutral account identity returned by GET /channel-accounts. */
export interface ChannelAccount {
  id: string;
  channel: Channel;
  provider: ChannelProvider;
  displayName: string | null;
  externalAccountId: string | null;
  status: ChannelAccountStatus;
  providerStatus: string | null;
  /**
   * False while the provider withholds ordinary group messages from this
   * account. Telegram's BotFather privacy mode does this by default.
   */
  canReadAllGroupMessages?: boolean;
  /**
   * The handle the provider knows this account by - a Telegram bot username,
   * for instance. What an operator recognises, unlike the numeric account id.
   */
  username?: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Set once the account has been disconnected. Its conversations survive
   * until it is purged, which is why a disconnected account is still listed:
   * it is the only handle on the threads it left behind.
   */
  archivedAt?: string | null;
}

export function getChannelAccounts(): Promise<ChannelAccount[]> {
  return api.get<ChannelAccount[]>("/channel-accounts");
}

export function getChannelAccountCapabilities(
  channelAccountId: string,
): Promise<ResolvedCapabilities> {
  return api.get<ResolvedCapabilities>(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}/capabilities`,
  );
}

/** What this workspace may connect right now, and why not when it may not. */
export interface ChannelProviderAvailability {
  channel: Channel;
  provider: ChannelProvider;
  available: boolean;
  unavailableReason: string | null;
}

export function getChannelProviderAvailability(): Promise<
  ChannelProviderAvailability[]
> {
  return api.get<ChannelProviderAvailability[]>("/channel-accounts/providers");
}

export function connectTelegramBot(input: {
  botToken: string;
  displayName?: string;
}): Promise<ChannelAccount> {
  return api.post<ChannelAccount>("/channel-accounts/telegram-bot", input);
}

export function renameChannelAccount(
  channelAccountId: string,
  displayName: string,
): Promise<ChannelAccount> {
  return api.patch<ChannelAccount>(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}`,
    { displayName },
  );
}

/**
 * Pause delivery, keeping the account and its stored credential.
 *
 * Distinct from `disconnectChannelAccount`, which archives and erases: this
 * one is reversible with `resumeChannelAccount`.
 */
export function pauseChannelAccount(channelAccountId: string): Promise<void> {
  return api.post(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}/disconnect`,
    {},
  );
}

export function resumeChannelAccount(channelAccountId: string): Promise<void> {
  return api.post(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}/resume`,
    {},
  );
}

export function disconnectChannelAccount(
  channelAccountId: string,
): Promise<void> {
  return api.delete(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}`,
  );
}

/**
 * Erase a disconnected account and everything it brought in.
 *
 * Disconnecting stops the account and leaves its history; this removes the
 * conversations, messages, and customers that came from it. Only an archived
 * account can be purged, and the server enforces that.
 */
export function purgeChannelAccount(channelAccountId: string): Promise<{
  contactIds: string[];
}> {
  return api.post<{ contactIds: string[] }>(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}/purge`,
    {},
  );
}
