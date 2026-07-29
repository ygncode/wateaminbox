import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listArchivedWhatsAppConnections,
  purgeArchivedWhatsAppConnection,
  relinkArchivedWhatsAppConnection,
} from "@/lib/api/whatsapp";
import { queryKeys } from "../query-keys";

const archivedConnectionsKey = () =>
  queryKeys.whatsapp.list({ lifecycle: "archived" });

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
  const purgeMutation = useMutation({
    mutationFn: purgeArchivedWhatsAppConnection,
    onSuccess: invalidate,
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
