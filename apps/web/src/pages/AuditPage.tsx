import { AuditLog } from "../components/team";
import { useWorkspace } from "../contexts/workspace-context";

/** Workspace-scoped activity and security log. */
export function AuditPage() {
  const { activeWorkspace } = useWorkspace();
  if (!activeWorkspace) return null;

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-dark-primary">
      <AuditLog
        companyId={activeWorkspace.id}
        canExport={activeWorkspace.permissions.can_export}
      />
    </div>
  );
}
