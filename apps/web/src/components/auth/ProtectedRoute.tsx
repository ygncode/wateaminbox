import type { MemberPermissions } from "@wateaminbox/shared";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireCompany?: boolean;
  requiredPermission?: keyof MemberPermissions;
}

export function ProtectedRoute({
  children,
  requireCompany = true,
  requiredPermission,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, needsCompanySetup, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-[#25D366] border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-gray-600">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Redirect to company setup if user has no companies
  if (requireCompany && needsCompanySetup) {
    return <Navigate to="/company-setup" replace />;
  }

  if (requiredPermission && !user?.permissions[requiredPermission]) {
    return <Navigate to="/chat" replace />;
  }

  return <>{children}</>;
}
