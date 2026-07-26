import { Navigate, useLocation } from "react-router-dom";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  getWorkspaceDestination,
  workspacePath,
} from "../../lib/workspace-routes";
import { PageSkeleton } from "../ui";

export function LegacyWorkspaceRedirect() {
  const { pathname } = useLocation();
  const {
    activeWorkspaceId,
    isLoading,
    needsWorkspaceChoice,
    needsWorkspaceSetup,
  } = useWorkspace();

  if (isLoading) return <PageSkeleton variant="default" />;
  if (needsWorkspaceSetup) return <Navigate to="/company-setup" replace />;
  if (needsWorkspaceChoice || !activeWorkspaceId) {
    return <Navigate to="/workspaces" replace />;
  }

  const { destination, suffix } = getWorkspaceDestination(pathname);
  return (
    <Navigate
      to={workspacePath(activeWorkspaceId, destination, suffix)}
      replace
    />
  );
}
