import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type ConversationStatus = 'open' | 'pending' | 'resolved'

export interface ConversationState {
  id?: string
  contactId: string
  status: ConversationStatus
  resolvedAt: string | null
  resolvedBy: string | null
  reopenedAt: string | null
  reopenedBy: string | null
  resolutionNotes: string | null
}

/**
 * Hook to fetch conversation state for a contact
 */
export function useConversationState(contactId: string | null) {
  return useQuery({
    queryKey: ['conversation-state', contactId],
    queryFn: async () => {
      if (!contactId) throw new Error('No contact ID provided')
      const response = await api.get<ConversationState>(`/conversations/${contactId}/state`)
      return response
    },
    enabled: !!contactId,
    staleTime: 30_000, // 30 seconds
  })
}

/**
 * Hook to resolve a conversation
 */
export function useResolveConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ contactId, notes }: { contactId: string; notes?: string }) => {
      const response = await api.post<{
        success: boolean
        state: ConversationState
      }>(`/conversations/${contactId}/resolve`, { notes })
      return response
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['conversation-state', variables.contactId],
      })
      queryClient.invalidateQueries({
        queryKey: ['analytics', 'resolution'],
      })
    },
  })
}

/**
 * Hook to reopen a conversation
 */
export function useReopenConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ contactId }: { contactId: string }) => {
      const response = await api.post<{
        success: boolean
        state: ConversationState
      }>(`/conversations/${contactId}/reopen`)
      return response
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['conversation-state', variables.contactId],
      })
      queryClient.invalidateQueries({
        queryKey: ['analytics', 'resolution'],
      })
    },
  })
}

/**
 * Hook to set conversation to pending
 */
export function useSetConversationPending() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ contactId }: { contactId: string }) => {
      const response = await api.post<{
        success: boolean
        state: ConversationState
      }>(`/conversations/${contactId}/pending`)
      return response
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['conversation-state', variables.contactId],
      })
      queryClient.invalidateQueries({
        queryKey: ['analytics', 'resolution'],
      })
    },
  })
}
