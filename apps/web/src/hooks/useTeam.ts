import { useMutation, useQuery } from "@tanstack/react-query";
import type { CompanyMember, CompanyInvitation } from "@whatsapp-web/shared";
import { api } from "@/lib/api";
import { useInvalidate, useQueryInvalidation } from "./query";

// Re-export types for backward compatibility
export type { CompanyMember } from "@whatsapp-web/shared";

/**
 * Invitation types - alias for backward compatibility
 */
export type Invitation = CompanyInvitation;

/**
 * Hook to fetch company members
 */
export function useCompanyMembers(companyId: string | null) {
  return useQuery({
    queryKey: ["company", companyId, "members"],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<CompanyMember[]>(`/companies/${companyId}/members`);
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

/**
 * Hook to fetch pending invitations
 */
export function usePendingInvitations(companyId: string | null) {
  return useQuery({
    queryKey: ["company", companyId, "invitations"],
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      return api.get<Invitation[]>(`/companies/${companyId}/invitations`);
    },
    enabled: !!companyId,
    staleTime: 30_000,
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
      return api.post<Invitation>(`/companies/${companyId}/invitations`, {
        email,
        role,
      });
    },
    onSuccess: (_, variables) => {
      invalidate(["company", variables.companyId, "invitations"]);
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
      invalidate(["company", variables.companyId, "invitations"]);
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
      return api.post<Invitation>(
        `/companies/${companyId}/invitations/${invitationId}/resend`,
        {},
      );
    },
    onSuccess: (_, variables) => {
      invalidate(["company", variables.companyId, "invitations"]);
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
      invalidate(["company", variables.companyId, "members"]);
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
      invalidate(["company", variables.companyId, "members"]);
    },
  });
}

/**
 * Hook to get invitation details by token
 */
export function useInvitationByToken(token: string | null) {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: async () => {
      if (!token) throw new Error("No token provided");
      return api.get<{
        id: string;
        email: string;
        companyName: string;
        invitedBy: string;
        expiresAt: string;
        createdAt: string;
      }>(`/invitations/${token}`);
    },
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Hook to accept an invitation
 */
export function useAcceptInvitation() {
  const invalidateCompanies = useInvalidate(["companies"]);

  return useMutation({
    mutationFn: async (token: string) => {
      return api.post<{
        company: { id: string; name: string };
        member: CompanyMember;
      }>(`/invitations/${token}/accept`, {});
    },
    onSuccess: invalidateCompanies,
  });
}
