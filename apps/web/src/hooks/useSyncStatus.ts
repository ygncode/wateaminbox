import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

interface SyncStatusResponse {
  success: boolean
  data: {
    syncing: boolean
    connections: Array<{
      id: string
      name: string | null
      phone_number: string | null
      sync_status: string | null
    }>
  }
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ['whatsapp', 'sync-status'],
    queryFn: async () => {
      const response = await api.get<SyncStatusResponse>('/whatsapp/sync-status')
      return response.data
    },
    staleTime: Infinity, // Don't refetch, only fetch once on mount
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
