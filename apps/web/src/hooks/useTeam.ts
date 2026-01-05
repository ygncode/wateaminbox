import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Company member types
 */
export interface CompanyMember {
  id: string
  userId: string
  companyId: string
  role: 'owner' | 'admin' | 'member'
  email: string
  joinedAt: string
  invitedBy: string | null
}

/**
 * Invitation types
 */
export interface Invitation {
  id: string
  companyId: string
  email: string
  token: string
  invitedBy: string
  expiresAt: string
  createdAt: string
}

/**
 * Hook to fetch company members
 */
export function useCompanyMembers(companyId: string | null) {
  return useQuery({
    queryKey: ['company', companyId, 'members'],
    queryFn: async () => {
      if (!companyId) throw new Error('No company ID provided')
      return api.get<CompanyMember[]>(`/companies/${companyId}/members`)
    },
    enabled: !!companyId,
    staleTime: 30_000,
  })
}

/**
 * Hook to fetch pending invitations
 */
export function usePendingInvitations(companyId: string | null) {
  return useQuery({
    queryKey: ['company', companyId, 'invitations'],
    queryFn: async () => {
      if (!companyId) throw new Error('No company ID provided')
      return api.get<Invitation[]>(`/companies/${companyId}/invitations`)
    },
    enabled: !!companyId,
    staleTime: 30_000,
  })
}

/**
 * Hook to invite a new member
 */
export function useInviteMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      companyId,
      email,
      role = 'member',
    }: {
      companyId: string
      email: string
      role?: 'admin' | 'member'
    }) => {
      const response = await api.post<{ success: boolean; data: Invitation }>(
        `/companies/${companyId}/invitations`,
        { email, role }
      )
      return response.data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['company', variables.companyId, 'invitations'],
      })
    },
  })
}

/**
 * Hook to cancel an invitation
 */
export function useCancelInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      companyId,
      invitationId,
    }: {
      companyId: string
      invitationId: string
    }) => {
      await api.delete(`/companies/${companyId}/invitations/${invitationId}`)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['company', variables.companyId, 'invitations'],
      })
    },
  })
}

/**
 * Hook to resend an invitation
 */
export function useResendInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      companyId,
      invitationId,
    }: {
      companyId: string
      invitationId: string
    }) => {
      const response = await api.post<{ success: boolean; data: Invitation }>(
        `/companies/${companyId}/invitations/${invitationId}/resend`,
        {}
      )
      return response.data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['company', variables.companyId, 'invitations'],
      })
    },
  })
}

/**
 * Hook to update a member's role
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      companyId,
      userId,
      role,
    }: {
      companyId: string
      userId: string
      role: 'admin' | 'member'
    }) => {
      const response = await api.patch<{
        success: boolean
        data: CompanyMember
      }>(`/companies/${companyId}/members/${userId}`, { role })
      return response.data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['company', variables.companyId, 'members'],
      })
    },
  })
}

/**
 * Hook to remove a member from the company
 */
export function useRemoveMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ companyId, userId }: { companyId: string; userId: string }) => {
      await api.delete(`/companies/${companyId}/members/${userId}`)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['company', variables.companyId, 'members'],
      })
    },
  })
}

/**
 * Hook to get invitation details by token
 */
export function useInvitationByToken(token: string | null) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => {
      if (!token) throw new Error('No token provided')
      const response = await api.get<{
        success: boolean
        data: {
          id: string
          email: string
          companyName: string
          invitedBy: string
          expiresAt: string
          createdAt: string
        }
      }>(`/invitations/${token}`)
      return response.data
    },
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Hook to accept an invitation
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (token: string) => {
      const response = await api.post<{
        success: boolean
        data: {
          company: { id: string; name: string }
          member: CompanyMember
        }
      }>(`/invitations/${token}/accept`, {})
      return response.data
    },
    onSuccess: () => {
      // Invalidate user companies list
      queryClient.invalidateQueries({ queryKey: ['companies'] })
    },
  })
}
