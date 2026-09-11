import * as React from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router";
import { useWorkspace } from "../../contexts/workspace-context";
import { workspacePath } from "../../lib/workspace-routes";
import { PageSkeleton, workspaceLoadingVariant } from "../ui";

export function WorkspaceRouteGuard() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const location = useLocation();
  const {
    memberships,
    activeWorkspaceId,
    isLoading,
    isSwitching,
    switchWorkspace,
  } = useWorkspace();
  const [activationFailed, setActivationFailed] = React.useState(false);

  const hasMembership = memberships.some(
    (workspace) => workspace.id === workspaceId,
  );

  React.useEffect(() => {
    if (
      isLoading ||
      !workspaceId ||
      !hasMembership ||
      activeWorkspaceId === workspaceId
    ) {
      return;
    }
    setActivationFailed(false);
    void switchWorkspace(workspaceId).catch(() => setActivationFailed(true));
  }, [
    activeWorkspaceId,
    hasMembership,
    isLoading,
    switchWorkspace,
    workspaceId,
  ]);

  if (isLoading || isSwitching || activeWorkspaceId !== workspaceId) {
    if (!isLoading && (!hasMembership || activationFailed)) {
      return activeWorkspaceId ? (
        <Navigate to={workspacePath(activeWorkspaceId)} replace />
      ) : (
        <Navigate to="/workspaces" replace />
      );
    }
    return (
      <PageSkeleton
        variant={workspaceLoadingVariant(location.pathname)}
        withShell
      />
    );
  }

  return <Outlet />;
}
