import { useQuery } from "@tanstack/react-query";
import {
  getChannelAccountCapabilities,
  getChannelAccounts,
} from "@/lib/api/channel-accounts";
import { queryKeys } from "./query-keys";

export function useChannelAccounts() {
  return useQuery({
    queryKey: queryKeys.channelAccounts.lists(),
    queryFn: getChannelAccounts,
    staleTime: 30_000,
  });
}

export function useChannelAccountCapabilities(
  channelAccountId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.channelAccountCapabilities.detail(
      channelAccountId ?? "",
    ),
    queryFn: () => getChannelAccountCapabilities(channelAccountId!),
    enabled: Boolean(channelAccountId),
    staleTime: 30_000,
  });
}
