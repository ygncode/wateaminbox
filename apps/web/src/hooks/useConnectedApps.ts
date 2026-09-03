import { useMutation, useQuery } from "@tanstack/react-query";
import { disconnectApp, getConnectedApps } from "@/lib/api/api-tokens";
import { useQueryInvalidation } from "./query";
import { queryKeys } from "./query-keys";

/**
 * AI clients authorized against this workspace through OAuth.
 *
 * Disconnecting revokes the whole grant rather than a single token, so the
 * client cannot mint a replacement with its refresh token. Both queries are
 * invalidated together because a grant and its tokens are the same credential
 * seen from two angles.
 */
export function useConnectedApps() {
  const { invalidate } = useQueryInvalidation();

  const {
    data: apps,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.apiTokens.connectedApps,
    queryFn: getConnectedApps,
    staleTime: 60 * 1000,
  });

  const disconnectMutation = useMutation({
    mutationFn: (grantId: string) => disconnectApp(grantId),
    onSuccess: () => {
      invalidate(queryKeys.apiTokens.all);
    },
  });

  return {
    apps: apps ?? [],
    isLoading,
    error,
    refetch,
    disconnect: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}
