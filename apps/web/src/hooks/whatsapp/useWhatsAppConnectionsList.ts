import { useQuery } from "@tanstack/react-query";
import { listWhatsAppConnections, type WhatsAppConnection } from "@/lib/api";
import { queryKeys } from "../query-keys";

/**
 * Hook for querying the list of WhatsApp connections
 */
export function useWhatsAppConnectionsList() {
  return useQuery({
    queryKey: queryKeys.whatsapp.lists(),
    queryFn: listWhatsAppConnections,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}

export type { WhatsAppConnection };
