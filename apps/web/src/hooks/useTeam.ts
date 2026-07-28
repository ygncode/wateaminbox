import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  Company,
  CompanyInvitation,
  CompanyMember,
  CreateCompanyInput,
  MemberPermissions,
  UpdateCompanyInput,
} from "@wateaminbox/shared";
import { api } from "@/lib/api/client";
import { useInvalidate, useQueryInvalidation } from "./query";
import { queryKeys } from "./query-keys";

// Re-export types for backward compatibility
export type { CompanyMember } from "@wateaminbox/shared";

/**
 * Invitation types - alias for backward compatibility
 */
export type Invitation = CompanyInvitation;

/**
 * Hook to fetch company members
 */
export function useCompanyMembers(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.team.members(companyId),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<CompanyMember[]>(`/companies/${companyId}/members`);
    },
    enabled: !!companyId,
    staleTime: 30_000,
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch pending invitations
 */
export function usePendingInvitations(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.team.invitations(companyId),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<Invitation[]>(`/companies/${companyId}/invitations`);
    },
    enabled: !!companyId,
    staleTime: 30_000,
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to invite a new member
 */
export function useInviteMember() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      email,
      role = "member",
    }: {
      companyId: string;
      email: string;
      role?: "admin" | "member";
    }) => {
      const response = await api.post<{ invitation: Invitation }>(
        `/companies/${companyId}/invitations`,
        { email, role },
      );
      return response.invitation;
    },
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.invitations(variables.companyId));
    },
  });
}

/**
 * Hook to cancel an invitation
 */
export function useCancelInvitation() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      invitationId,
    }: {
      companyId: string;
      invitationId: string;
    }) => {
      await api.delete(`/companies/${companyId}/invitations/${invitationId}`);
    },
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.invitations(variables.companyId));
    },
  });
}

/**
 * Hook to resend an invitation
 */
export function useResendInvitation() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      invitationId,
    }: {
      companyId: string;
      invitationId: string;
    }) => {
      const response = await api.post<{ invitation: Invitation }>(
        `/companies/${companyId}/invitations/${invitationId}/resend`,
        {},
      );
      return response.invitation;
    },
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.invitations(variables.companyId));
    },
  });
}

/**
 * Hook to update a member's role
 */
export function useUpdateMemberRole() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      userId,
      role,
    }: {
      companyId: string;
      userId: string;
      role: "admin" | "member";
    }) => {
      return api.patch<CompanyMember>(
        `/companies/${companyId}/members/${userId}`,
        { role },
      );
    },
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.members(variables.companyId));
    },
  });
}

/** Update per-member permission overrides. */
export function useUpdateMemberPermissions() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      userId,
      permissions,
    }: {
      companyId: string;
      userId: string;
      permissions: Partial<MemberPermissions>;
    }) =>
      api.patch<{ effectivePermissions: MemberPermissions }>(
        `/companies/${companyId}/members/${userId}/permissions`,
        permissions,
      ),
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.members(variables.companyId));
    },
  });
}

/** Reset a member to the defaults for their assigned role. */
export function useResetMemberPermissions() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      userId,
    }: {
      companyId: string;
      userId: string;
    }) =>
      api.post<{ effectivePermissions: MemberPermissions }>(
        `/companies/${companyId}/members/${userId}/permissions/reset`,
        {},
      ),
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.members(variables.companyId));
    },
  });
}

/**
 * Hook to remove a member from the company
 */
export function useRemoveMember() {
  const { invalidate } = useQueryInvalidation();

  return useMutation({
    mutationFn: async ({
      companyId,
      userId,
    }: {
      companyId: string;
      userId: string;
    }) => {
      await api.delete(`/companies/${companyId}/members/${userId}`);
    },
    onSuccess: (_, variables) => {
      invalidate(queryKeys.team.members(variables.companyId));
    },
  });
}

/**
 * Hook to get invitation details by token
 */
export function useInvitationByToken(token: string | null) {
  return useQuery({
    queryKey: queryKeys.team.invitation(token),
    queryFn: async () => {
      if (!token) throw new Error("No token provided");
      return api.get<{
        id: string;
        email: string;
        companyName: string;
        invitedBy: string;
        role: "admin" | "member";
        expiresAt: string;
        createdAt: string;
      }>(`/invitations/${token}`);
    },
    enabled: !!token,
    staleTime: 60_000,
    gcTime: 300_000, // 5 minutes
    retry: false,
  });
}

/**
 * Hook to accept an invitation
 */
export function useAcceptInvitation() {
  const invalidateCompanies = useInvalidate(queryKeys.team.companies());

  return useMutation({
    mutationFn: async (token: string) => {
      return api.post<{
        message: string;
        company: { id: string; name: string };
        member: CompanyMember;
      }>(`/invitations/${token}/accept`, {});
    },
    onSuccess: invalidateCompanies,
  });
}

/**
 * Hook to create a new company
 */
export function useCreateCompany() {
  const invalidateCompanies = useInvalidate(queryKeys.team.companies());

  return useMutation({
    mutationFn: async (input: CreateCompanyInput) => {
      return api.post<Company>("/companies", input);
    },
    onSuccess: invalidateCompanies,
  });
}

/** Transfer workspace ownership to another member. */
export function useTransferOwnership() {
  const invalidateCompanies = useInvalidate(queryKeys.team.companies());
  const { invalidate } = useQueryInvalidation();
  return useMutation({
    mutationFn: async ({
      companyId,
      userId,
    }: {
      companyId: string;
      userId: string;
    }) => api.post(`/companies/${companyId}/transfer-ownership`, { userId }),
    onSuccess: (_, variables) => {
      invalidateCompanies();
      invalidate(queryKeys.team.members(variables.companyId));
    },
  });
}

/** Leave a workspace after ownership policy is satisfied. */
export function useLeaveCompany() {
  const invalidateCompanies = useInvalidate(queryKeys.team.companies());
  return useMutation({
    mutationFn: async (companyId: string) =>
      api.post(`/companies/${companyId}/leave`, {}),
    onSuccess: invalidateCompanies,
  });
}

/** Delete a workspace. The API restricts this to its owner. */
export function useDeleteCompany() {
  const invalidateCompanies = useInvalidate(queryKeys.team.companies());
  return useMutation({
    mutationFn: async (companyId: string) =>
      api.delete(`/companies/${companyId}`),
    onSuccess: invalidateCompanies,
  });
}

/** Update workspace details. The API enforces the membership hierarchy. */
export function useUpdateCompany(companyId: string) {
  const invalidateCompanies = useInvalidate(queryKeys.team.companies());

  return useMutation({
    mutationFn: async (input: UpdateCompanyInput) =>
      api.patch<Company>(`/companies/${companyId}`, input),
    onSuccess: invalidateCompanies,
  });
}
