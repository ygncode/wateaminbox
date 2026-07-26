import type { MemberPermissions } from "@wateaminbox/shared";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/auth-context";
import { useWorkspace } from "../../contexts/workspace-context";
import { workspacePath } from "../../lib/workspace-routes";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireCompany?: boolean;
  requiredPermission?: keyof MemberPermissions;
  requiredAnyPermission?: Array<keyof MemberPermissions>;
}

export function ProtectedRoute({
  children,
  requireCompany = true,
  requiredPermission,
  requiredAnyPermission,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const {
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    needsWorkspaceSetup,
    needsWorkspaceChoice,
    can,
    canAny,
  } = useWorkspace();
  const location = useLocation();

  if (isAuthLoading || (isAuthenticated && isWorkspaceLoading)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f5f7f4] dark:bg-dark-primary">
        <div className="flex flex-col items-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#0b7a55] border-t-transparent" />
          <p className="mt-4 text-sm text-[#65736d]">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (requireCompany && needsWorkspaceSetup) {
    return <Navigate to="/company-setup" replace />;
  }
  if (requireCompany && (needsWorkspaceChoice || !activeWorkspaceId)) {
    return <Navigate to="/workspaces" replace />;
  }

  const forbidden =
    (requiredPermission && !can(requiredPermission)) ||
    (requiredAnyPermission && !canAny(requiredAnyPermission));
  if (forbidden && activeWorkspaceId) {
    return <Navigate to={workspacePath(activeWorkspaceId)} replace />;
  }

  return <>{children}</>;
}
