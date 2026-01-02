import { useAuth } from "../contexts/auth-context";
import { AppLayout } from "../components/layout/app-layout";
import { TeamManagement } from "../components/team";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Team Management page
 * Provides interface for managing company members and invitations
 */
export function TeamPage() {
  const { user, currentCompanyId, companies } = useAuth();

  // Find the current company to get the user's role
  const currentCompany = companies.find((c) => c.id === currentCompanyId);
  const currentUserRole = currentCompany?.role || "member";

  if (!currentCompanyId || !user) {
    return (
      <AppLayout>
        <div className="flex h-full w-full items-center justify-center bg-white">
          <p className="text-gray-500">No company selected</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex h-full w-full flex-col bg-white">
        {/* Navigation header */}
        <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-3">
          <Link
            to="/chat"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Chat
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
