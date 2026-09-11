import type { MemberPermissions } from "@wateaminbox/shared";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../../contexts/auth-context";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  resolveWorkspaceAccessRedirect,
  type WorkspaceAccessMode,
} from "../../lib/workspace-access";
import { workspacePath } from "../../lib/workspace-routes";
import { PageSkeleton, workspaceLoadingVariant } from "../ui";
import {
  OnboardingErrorScreen,
  OnboardingLoadingScreen,
} from "../ui/onboarding-state";

interface ProtectedRouteProps {
  children: React.ReactNode;
  workspaceMode?: WorkspaceAccessMode;
  requiredPermission?: keyof MemberPermissions;
  requiredAnyPermission?: Array<keyof MemberPermissions>;
}

export function ProtectedRoute({
  children,
  workspaceMode = "required",
  requiredPermission,
  requiredAnyPermission,
}: ProtectedRouteProps) {
  const { t } = useTranslation();

  const { isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();
  const {
    memberships,
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    error: workspaceError,
    refreshWorkspaces,
    can,
    canAny,
  } = useWorkspace();
  const location = useLocation();

  if (isAuthLoading || (isAuthenticated && isWorkspaceLoading)) {
    if (workspaceMode === "required") {
      return (
        <PageSkeleton
          variant={workspaceLoadingVariant(location.pathname)}
          withShell
        />
      );
    }
    return (
      <OnboardingLoadingScreen
        message={
          location.pathname === "/company-setup"
            ? t("auth.restoringSetup", "Restoring workspace setup…")
            : t("auth.loadingWorkspaces", "Loading your workspaces…")
        }
      />
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (workspaceError && memberships.length === 0) {
    return (
      <OnboardingErrorScreen
        message={workspaceError}
        onRetry={() => void refreshWorkspaces().catch(() => undefined)}
        onSignOut={() => void logout()}
      />
    );
  }

  const workspaceRedirect = resolveWorkspaceAccessRedirect({
    mode: workspaceMode,
    membershipCount: memberships.length,
    activeWorkspaceId,
  });
  if (workspaceRedirect) {
    return <Navigate to={workspaceRedirect} replace />;
  }

  const forbidden =
    (requiredPermission && !can(requiredPermission)) ||
    (requiredAnyPermission && !canAny(requiredAnyPermission));
  if (forbidden && activeWorkspaceId) {
    return <Navigate to={workspacePath(activeWorkspaceId)} replace />;
  }

  return <>{children}</>;
}
