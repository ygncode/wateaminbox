import { useTranslation } from "react-i18next";
import { AppLayout } from "../components/layout/app-layout";
import { Dashboard } from "../components/dashboard/Dashboard";
import { useAuth } from "../contexts/auth-context";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Dashboard page
 * Shows analytics and statistics for the company
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { currentCompanyId, companies } = useAuth();

  const companyId = currentCompanyId || companies?.[0]?.id;
  const currentCompany = companies?.find((c) => c.id === companyId);
  const isAdmin =
    currentCompany?.role === "admin" || currentCompany?.role === "owner";

  return (
    <AppLayout>
      <div className="flex h-full w-full flex-col bg-gray-50">
        {/* Navigation header */}
        <div className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3">
          <Link
            to="/chat"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.backToChat", "Back to Chat")}
          </Link>
        </div>

        {/* Page header */}
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-4">
          <LayoutDashboard className="h-6 w-6 text-gray-700" />
          <h1 className="text-xl font-semibold text-gray-900">
            {t("dashboard.title", "Dashboard")}
          </h1>
        </div>

        {/* Dashboard content */}
        <div className="flex-1 overflow-auto">
          {companyId ? (
            <Dashboard companyId={companyId} isAdmin={isAdmin} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500">
                {t(
                  "dashboard.noCompany",
                  "Please select a company to view dashboard",
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
