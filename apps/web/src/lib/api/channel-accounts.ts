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
