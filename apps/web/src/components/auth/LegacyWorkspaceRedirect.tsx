import { Navigate, useLocation } from "react-router";
import { useWorkspace } from "../../contexts/workspace-context";
import {
  getWorkspaceDestination,
  workspacePath,
} from "../../lib/workspace-routes";
import { PageSkeleton, workspaceLoadingVariant } from "../ui";

export function LegacyWorkspaceRedirect() {
  const { pathname } = useLocation();
  const {
    activeWorkspaceId,
    isLoading,
    needsWorkspaceChoice,
    needsWorkspaceSetup,
  } = useWorkspace();

  // These legacy paths (/chat, /settings, …) live outside the /w/:workspaceId
  // subtree, so visiting one unmounts the app shell and redirects back into it.
  // `<Navigate>` renders null, so the frame where the legacy path is the active
  // route paints nothing - the blank flash users saw on /chat -> /w/<id>/chat.
  // Render the SAME app-shell skeleton the destination shows, both while the
  // workspace resolves and alongside the redirect, so the shell stays on screen
  // continuously across the two routes.
  const shellSkeleton = (
    <PageSkeleton variant={workspaceLoadingVariant(pathname)} withShell />
  );

  if (isLoading) return shellSkeleton;
  if (needsWorkspaceSetup) return <Navigate to="/company-setup" replace />;
  if (needsWorkspaceChoice || !activeWorkspaceId) {
    return <Navigate to="/workspaces" replace />;
  }

  const { destination, suffix } = getWorkspaceDestination(pathname);
  return (
    <>
      {shellSkeleton}
      <Navigate
        to={workspacePath(activeWorkspaceId, destination, suffix)}
        replace
      />
    </>
  );
}
