import { TeamManagement } from "../components/team";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";

/** Workspace-scoped team and invitation management. */
export function TeamPage() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  if (!activeWorkspace || !user) return null;

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-dark-primary">
      <TeamManagement
        companyId={activeWorkspace.id}
        currentUserId={user.id}
        currentUserRole={activeWorkspace.role}
        canManageTeam={activeWorkspace.permissions.can_manage_team}
        canInvite={activeWorkspace.permissions.can_invite}
      />
    </div>
  );
}
