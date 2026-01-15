import { useQuery } from "@tanstack/react-query";
import { listWhatsAppConnections } from "@/lib/api/whatsapp";
import type { WhatsAppConnection } from "@/lib/api/types";
import { queryKeys } from "../query-keys";

/**
 * Hook for querying the list of WhatsApp connections
 */
export function useWhatsAppConnectionsList() {
  return useQuery({
    queryKey: queryKeys.whatsapp.lists(),
    queryFn: listWhatsAppConnections,
    staleTime: 30000, // 30 seconds
    gcTime: 300000, // 5 minutes
    refetchInterval: 60000, // Refetch every minute
  });
}

export type { WhatsAppConnection };
