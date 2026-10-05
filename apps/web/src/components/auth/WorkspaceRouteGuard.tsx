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
    // While a switch is in flight the route still names the previous
    // workspace. Following it here would undo the switch midway.
    if (
      isLoading ||
      isSwitching ||
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
    isSwitching,
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
