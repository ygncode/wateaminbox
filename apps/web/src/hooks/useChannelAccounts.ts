import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  connectTelegramBot,
  disconnectChannelAccount,
  getChannelAccountCapabilities,
  getChannelAccounts,
  getChannelProviderAvailability,
} from "@/lib/api/channel-accounts";
import { queryKeys } from "./query-keys";

export function useChannelAccounts() {
  return useQuery({
    queryKey: queryKeys.channelAccounts.lists(),
    queryFn: async () => {
      try {
        return await getChannelAccounts();
      } catch (error) {
        // The route 404s for a workspace that has not enabled neutral reads.
        // That is "no channel accounts yet", not a page-level failure: the
        // Connections page must still render its WhatsApp connections.
        if (isNotFound(error)) return [];
        throw error;
      }
    },
    staleTime: 30_000,
  });
}

/**
 * Which providers this workspace may connect. Failing closed on an error
 * keeps the picker from offering a provider whose connect call would be
 * rejected anyway.
 */
export function useChannelProviderAvailability() {
  return useQuery({
    queryKey: queryKeys.channelAccounts.list({ view: "providers" }),
    queryFn: getChannelProviderAvailability,
    staleTime: 30_000,
  });
}

export function useConnectTelegramBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: connectTelegramBot,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelAccounts.all,
      });
    },
  });
}

export function useDisconnectChannelAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectChannelAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelAccounts.all,
      });
    },
  });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 404
  );
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
