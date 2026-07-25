import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { ProtectedRoute } from "./components/auth";
import { ProtectedAppLayout } from "./components/layout/ProtectedAppLayout";
import { KeyboardShortcutsModal } from "./components/settings";
import { PageSkeleton } from "./components/ui";

// Lazy load all page components for code splitting
// Each page becomes a separate chunk, loaded only when navigating to that route
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("./pages/ForgotPasswordPage").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("./pages/ResetPasswordPage").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import("./pages/VerifyEmailPage").then((m) => ({
    default: m.VerifyEmailPage,
  })),
);
const CompanySetupPage = lazy(() =>
  import("./pages/CompanySetupPage").then((m) => ({
    default: m.CompanySetupPage,
  })),
);
const ChatPage = lazy(() =>
  import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })),
);
const TeamPage = lazy(() =>
  import("./pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const AcceptInvitationPage = lazy(() =>
  import("./pages/AcceptInvitationPage").then((m) => ({
    default: m.AcceptInvitationPage,
  })),
);

function App() {
  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageSkeleton variant="auth" />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path="/register"
          element={
            <Suspense fallback={<PageSkeleton variant="auth" />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <Suspense fallback={<PageSkeleton variant="auth" />}>
              <ForgotPasswordPage />
            </Suspense>
          }
        />
        <Route
          path="/reset-password"
          element={
            <Suspense fallback={<PageSkeleton variant="auth" />}>
              <ResetPasswordPage />
            </Suspense>
          }
        />
        <Route
          path="/verify-email"
          element={
            <Suspense fallback={<PageSkeleton variant="auth" />}>
              <VerifyEmailPage />
            </Suspense>
          }
        />

        {/* Company setup (protected but doesn't require company) */}
        <Route
          path="/company-setup"
          element={
            <ProtectedRoute requireCompany={false}>
              <Suspense fallback={<PageSkeleton variant="auth" />}>
                <CompanySetupPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        {/* Protected company application shell: one global notification center. */}
        <Route
          element={
            <ProtectedRoute>
              <ProtectedAppLayout />
            </ProtectedRoute>
          }
        >
          <Route
            path="/chat"
            element={
              <Suspense fallback={<PageSkeleton variant="chat" />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="/chat/:contactId"
            element={
              <Suspense fallback={<PageSkeleton variant="chat" />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="/team"
            element={
              <Suspense fallback={<PageSkeleton variant="team" />}>
                <TeamPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<PageSkeleton variant="settings" />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route
            path="/audit"
            element={
              <Suspense fallback={<PageSkeleton variant="default" />}>
                <AuditPage />
              </Suspense>
            }
          />
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<PageSkeleton variant="dashboard" />}>
                <DashboardPage />
              </Suspense>
            }
          />
          <Route
            path="/notifications"
            element={
              <Suspense fallback={<PageSkeleton variant="default" />}>
                <NotificationsPage />
              </Suspense>
            }
          />
        </Route>

        {/* Accept invitation (protected but doesn't require company) */}
        <Route
          path="/invite/:token"
          element={
            <ProtectedRoute requireCompany={false}>
              <Suspense fallback={<PageSkeleton variant="default" />}>
                <AcceptInvitationPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
      {/* Global keyboard shortcuts modal */}
      <KeyboardShortcutsModal />
      {/* Toast notifications */}
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;
