import { Dashboard } from "../components/dashboard/Dashboard";
import { useWorkspace } from "../contexts/workspace-context";

/** Workspace-scoped analytics destination. */
export function DashboardPage() {
  const { activeWorkspace } = useWorkspace();
  if (!activeWorkspace) return null;

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-dark-primary">
      <Dashboard
        companyId={activeWorkspace.id}
        workspaceName={activeWorkspace.name}
        canExport={activeWorkspace.permissions.can_export}
        isAdmin={
          activeWorkspace.role === "admin" || activeWorkspace.role === "owner"
        }
      />
    </div>
  );
}
