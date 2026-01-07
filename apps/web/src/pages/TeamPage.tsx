import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { AppLayout } from "../components/layout/app-layout";
import { TeamManagement } from "../components/team";
import { useAuth } from "../contexts/auth-context";

interface LocationState {
  from?: string;
}

/**
 * Team Management page
 * Provides interface for managing company members and invitations
 */
export function TeamPage() {
  const { user, currentCompanyId, companies } = useAuth();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  // Determine back navigation based on where user came from
  const backTo = locationState?.from === "settings" ? "/settings" : "/chat";
  const backLabel =
    locationState?.from === "settings" ? "Back to Settings" : "Back to Chat";

  // Find the current company to get the user's role
  const currentCompany = companies.find((c) => c.id === currentCompanyId);
  const currentUserRole = currentCompany?.role || "member";

  if (!currentCompanyId || !user) {
    return (
      <AppLayout>
        <div className="flex h-full w-full items-center justify-center bg-white dark:bg-dark-primary">
          <p className="text-gray-500 dark:text-dark-text-secondary">
            No company selected
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex h-full w-full flex-col bg-white dark:bg-dark-primary">
        {/* Navigation header */}
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-dark-border px-4 py-3">
          <Link
            to={backTo}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>

        {/* Team Management component */}
        <div className="flex-1 overflow-hidden">
          <TeamManagement
            companyId={currentCompanyId}
            currentUserId={user.id}
            currentUserRole={currentUserRole as "owner" | "admin" | "member"}
          />
        </div>
      </div>
    </AppLayout>
  );
}
