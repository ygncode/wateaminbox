import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createApiToken,
  getApiTokens,
  revokeApiToken,
} from "@/lib/api/api-tokens";
import type { CreateApiTokenInput } from "@/lib/api/types";
import { useQueryInvalidation } from "./query";
import { queryKeys } from "./query-keys";

/**
 * Hook for managing personal (and, for admins, workspace-wide) API tokens
 * used by the MCP endpoint.
 */
export function useApiTokens(options: { all?: boolean } = {}) {
  const all = Boolean(options.all);
  const { invalidate } = useQueryInvalidation();

  const {
    data: tokens,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.apiTokens.list(all),
    queryFn: () => getApiTokens({ all }),
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateApiTokenInput) => createApiToken(input),
    onSuccess: () => {
      invalidate(queryKeys.apiTokens.all);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => revokeApiToken(tokenId),
    onSuccess: () => {
      invalidate(queryKeys.apiTokens.all);
    },
  });

  return {
    tokens: tokens ?? [],
    isLoading,
    error,
    refetch,
    createToken: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    revokeToken: revokeMutation.mutateAsync,
    isRevoking: revokeMutation.isPending,
  };
}
