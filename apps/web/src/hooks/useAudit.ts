import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "./query-keys";

/**
 * Audit log action types
 */
export type AuditAction =
  | "user.login"
  | "user.logout"
  | "invitation.sent"
  | "invitation.accepted"
  | "invitation.cancelled"
  | "invitation.resent"
  | "member.role_changed"
  | "member.removed"
  | "contact.created"
  | "contact.updated"
  | "contact.assigned"
  | "contact.unassigned"
  | "message.sent"
  | "message.deleted"
  | "tag.created"
  | "tag.deleted"
  | "company.updated";

/**
 * Audit log entry
 */
export interface AuditLog {
  id: string;
  userId: string | null;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

/**
 * Query parameters for audit logs
 */
export interface AuditLogsParams {
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Hook to fetch audit logs
 */
export function useAuditLogs(
  companyId: string | null,
  params: AuditLogsParams = {},
) {
  const queryParams = new URLSearchParams();
  if (params.userId) queryParams.set("userId", params.userId);
  if (params.action) queryParams.set("action", params.action);
  if (params.entityType) queryParams.set("entityType", params.entityType);
  if (params.entityId) queryParams.set("entityId", params.entityId);
  if (params.startDate) queryParams.set("startDate", params.startDate);
  if (params.endDate) queryParams.set("endDate", params.endDate);
  if (params.limit) queryParams.set("limit", String(params.limit));
  if (params.offset) queryParams.set("offset", String(params.offset));

  const queryString = queryParams.toString();

  return useQuery({
    queryKey: queryKeys.audit.logs(companyId, params),
    queryFn: async () => {
      if (!companyId) throw new Error("No company ID provided");
      const url = `/audit${queryString ? `?${queryString}` : ""}`;
      const response = await api.get<{
        data: AuditLog[];
        pagination: {
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
      }>(url);
      return response;
    },
    enabled: !!companyId,
    staleTime: 30_000,
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Hook to fetch available action types
 */
export function useAuditActions() {
  return useQuery({
    queryKey: queryKeys.audit.actions(),
    queryFn: async () => {
      const response = await api.get<{
        data: Array<{ value: AuditAction; label: string }>;
      }>("/audit/actions");
      return response.data;
    },
    staleTime: 300_000, // 5 minutes
    gcTime: 600_000, // 10 minutes
  });
}

/**
 * Get export URL for audit logs
 */
export function getAuditExportUrl(
  startDate?: string,
  endDate?: string,
): string {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();
  return `/api/audit/export${queryString ? `?${queryString}` : ""}`;
}

/**
 * Format action for display
 */
export function formatAuditAction(action: AuditAction): string {
  return action
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" - ");
}

/**
 * Get action category for grouping/filtering
 */
export function getActionCategory(action: AuditAction): string {
  return action.split(".")[0];
}
