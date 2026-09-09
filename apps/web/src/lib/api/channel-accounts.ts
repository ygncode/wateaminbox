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
  connectedAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export function disconnectChannelAccount(
  channelAccountId: string,
): Promise<void> {
  return api.delete(
    `/channel-accounts/${encodeURIComponent(channelAccountId)}`,
  );
}
