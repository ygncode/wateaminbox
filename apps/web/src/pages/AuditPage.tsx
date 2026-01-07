import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { AppLayout } from "../components/layout/app-layout";
import { AuditLog } from "../components/team";
import { useAuth } from "../contexts/auth-context";

/**
 * Audit Log page
 * Displays company activity and security logs
 */
export function AuditPage() {
  const { currentCompanyId } = useAuth();

  if (!currentCompanyId) {
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

        {/* Audit Log component */}
        <div className="flex-1 overflow-hidden">
          <AuditLog companyId={currentCompanyId} />
        </div>
      </div>
    </AppLayout>
  );
}
