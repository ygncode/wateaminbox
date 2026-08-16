import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError } from "@/lib/api/client";
import {
  listArchivedWhatsAppConnections,
  purgeArchivedWhatsAppConnection,
  relinkArchivedWhatsAppConnection,
} from "@/lib/api/whatsapp";
import { queryKeys } from "../query-keys";

const archivedConnectionsKey = () =>
  queryKeys.whatsapp.list({ lifecycle: "archived" });

/**
 * What to tell the operator when a permanent delete fails. The API states the
 * actionable cases itself ("archive this connection first", "not found"), so
 * its message is preferred over anything invented here.
 */
export function resolvePurgeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not permanently delete this connection";
}

/**
 * A 404/409 means the archived list no longer matches the server - the account
 * was linked again, or someone else already purged it. Refetching stops the row
 * from offering an action the server just rejected.
 */
export function purgeErrorNeedsRefetch(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.statusCode === 404 || error.statusCode === 409)
  );
}

export function useArchivedWhatsAppConnections() {
  const queryClient = useQueryClient();
  const archivedQuery = useQuery({
    queryKey: archivedConnectionsKey(),
    queryFn: listArchivedWhatsAppConnections,
    staleTime: 30_000,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.all });
  };

  const relinkMutation = useMutation({
    mutationFn: relinkArchivedWhatsAppConnection,
    onSuccess: invalidate,
  });
  // A permanent delete is irreversible and can fail for reasons the operator
  // can act on (the account was linked again from another tab, someone else
  // already purged it), so the outcome is always stated rather than left to
  // the row quietly staying put.
  const purgeMutation = useMutation({
    mutationFn: purgeArchivedWhatsAppConnection,
    onSuccess: async () => {
      await invalidate();
      toast.success("Connection and its inbox data were permanently deleted");
    },
    onError: async (error) => {
      if (purgeErrorNeedsRefetch(error)) await invalidate();
      toast.error(resolvePurgeErrorMessage(error));
    },
  });

  return {
    archivedConnections: archivedQuery.data ?? [],
    isLoadingArchived: archivedQuery.isLoading,
    relinkArchived: relinkMutation.mutateAsync,
    purgeArchived: purgeMutation.mutateAsync,
    relinkingId: relinkMutation.isPending
      ? relinkMutation.variables
      : undefined,
    purgingId: purgeMutation.isPending ? purgeMutation.variables : undefined,
  };
}
