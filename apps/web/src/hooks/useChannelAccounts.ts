import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  connectTelegramBot,
  disconnectChannelAccount,
  purgeChannelAccount,
  getChannelAccountCapabilities,
  getChannelAccounts,
  getChannelProviderAvailability,
  pauseChannelAccount,
  renameChannelAccount,
  resumeChannelAccount,
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

export function useRenameChannelAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      channelAccountId,
      displayName,
    }: {
      channelAccountId: string;
      displayName: string;
    }) => renameChannelAccount(channelAccountId, displayName),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelAccounts.all,
      });
    },
    onError: (error: unknown) => {
      toast.error(mutationErrorMessage(error, "Could not rename this account"));
    },
  });
}

export function usePauseChannelAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: pauseChannelAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelAccounts.all,
      });
    },
    onError: (error: unknown) => {
      toast.error(
        mutationErrorMessage(error, "Could not disconnect this account"),
      );
    },
  });
}

export function useResumeChannelAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resumeChannelAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelAccounts.all,
      });
    },
    onError: (error: unknown) => {
      toast.error(mutationErrorMessage(error, "Could not resume this account"));
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
    /**
     * Unlinking fails for reasons only the server can see - a webhook the
     * provider refused to drop, a credential this process cannot decrypt -
     * and every one of them used to land as silence: the row stayed put and
     * the click looked ignored. Say what happened instead, and keep the
     * server's own wording when it sent one.
     */
    onError: (error: unknown) => {
      toast.error(mutationErrorMessage(error, "Could not unlink this account"));
    },
  });
}

/**
 * Erase a disconnected account and the history it brought in.
 *
 * Separate from disconnecting: that stops the account and keeps its threads,
 * which is why a disconnected Telegram bot leaves conversations in the inbox.
 * This is the only way to clear them, and the customers it created go too.
 */
export function usePurgeChannelAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: purgeChannelAccount,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelAccounts.all,
      });
      // The threads and customers it owned are gone, so every list that drew
      // them is stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.channelConversations.lists(),
      });
      toast.success(
        result.contactIds.length > 0
          ? `Deleted the account and ${result.contactIds.length} customer(s) it created`
          : "Deleted the account",
      );
    },
    onError: (error: unknown) => {
      toast.error(mutationErrorMessage(error, "Could not delete this account"));
    },
  });
}

/**
 * Keep the server's own wording when it sent one.
 *
 * These mutations fail for reasons only the server can see - a webhook the
 * provider refused to drop, a credential this process cannot decrypt - and
 * every one of them used to land as silence: the row stayed put and the click
 * looked ignored.
 */
function mutationErrorMessage(error: unknown, fallback: string): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message.trim()
    ? `${fallback}: ${message}`
    : `${fallback}. Please try again.`;
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
