import { useMutation, useQuery } from "@tanstack/react-query";
import type { CreateSlaPolicyInput } from "@wateaminbox/shared";
import {
  createSlaPolicy,
  getCurrentSlaPolicy,
  getSlaPolicyHistory,
} from "@/lib/api";
import { useInvalidateMultiple } from "./query";
import { queryKeys } from "./query-keys";

/** The SLA policy currently in effect. Any workspace member can read it. */
export function useCurrentSlaPolicy(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.slaPolicy.current(companyId),
    queryFn: () => {
      if (!companyId) throw new Error("No company ID provided");
      return getCurrentSlaPolicy(companyId);
    },
    enabled: !!companyId,
  });
}

/** Full immutable version history, most recent first. */
export function useSlaPolicyHistory(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.slaPolicy.history(companyId),
    queryFn: () => {
      if (!companyId) throw new Error("No company ID provided");
      return getSlaPolicyHistory(companyId);
    },
    enabled: !!companyId,
  });
}

/**
 * Creates a new (immediately-active) SLA policy version. The API enforces
 * admin/owner-only access. Never mutates a prior version - this always
 * appends to history.
 */
export function useCreateSlaPolicy(companyId: string) {
  // Invalidate the policy itself plus every response-time/SLA analytics
  // query for this company - a new policy version changes both the
  // "current target" label and (for future episodes) the compliance
  // math, so the dashboard must refetch immediately rather than show
  // stale numbers for up to its 5-minute staleTime.
  const invalidate = useInvalidateMultiple([
    [...queryKeys.slaPolicy.current(companyId)],
    [...queryKeys.slaPolicy.history(companyId)],
    [...queryKeys.analytics.responseTimeStats(companyId)],
    [...queryKeys.analytics.responseTimeTrend(companyId)],
    [...queryKeys.analytics.responseTimeTeam(companyId)],
    [...queryKeys.analytics.slaBreaches(companyId)],
    [...queryKeys.analytics.resolution(companyId)],
    [...queryKeys.analytics.resolutionTrend(companyId)],
    [...queryKeys.analytics.resolutionTeam(companyId)],
    [...queryKeys.analytics.resolutionOverdue(companyId)],
  ]);

  return useMutation({
    mutationFn: async (input: CreateSlaPolicyInput) =>
      createSlaPolicy(companyId, input),
    onSuccess: invalidate,
  });
}
