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
    // Realtime may be unavailable locally; poll rapidly only while a QR
    // pairing is pending so the pairing code appears without a manual refresh.
    refetchInterval: (query) =>
      query.state.data?.some((connection) => connection.status === "pending")
        ? 3000
        : 60000,
  });
}

export type { WhatsAppConnection };
