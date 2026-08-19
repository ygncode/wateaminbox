import type { MemberPermissions } from "@wateaminbox/shared";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../../contexts/auth-context";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  type WorkspaceAccessMode,
  resolveWorkspaceAccessRedirect,
} from "../../lib/workspace-access";
import { workspacePath } from "../../lib/workspace-routes";
import { PageSkeleton, type PageSkeletonVariant } from "../ui";
import {
  OnboardingErrorScreen,
  OnboardingLoadingScreen,
} from "../ui/onboarding-state";
import { useTranslation } from "react-i18next";

interface ProtectedRouteProps {
  children: React.ReactNode;
  workspaceMode?: WorkspaceAccessMode;
  requiredPermission?: keyof MemberPermissions;
  requiredAnyPermission?: Array<keyof MemberPermissions>;
}

function workspaceLoadingVariant(pathname: string): PageSkeletonVariant {
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/settings")) return "settings";
  if (pathname.includes("/dashboard")) return "dashboard";
  if (pathname.includes("/team")) return "team";
  return "default";
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
          className="min-h-dvh"
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
