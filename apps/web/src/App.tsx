import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import {
  LegacyWorkspaceRedirect,
  ProtectedRoute,
  WorkspaceRouteGuard,
} from "./components/auth";
import { ProtectedAppLayout } from "./components/layout/ProtectedAppLayout";
import { KeyboardShortcutsModal } from "./components/settings";
import { PageSkeleton } from "./components/ui";
import { OnboardingLoadingScreen } from "./components/ui/onboarding-state";

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
const WorkspaceChooserPage = lazy(() =>
  import("./pages/WorkspaceChooserPage").then((m) => ({
    default: m.WorkspaceChooserPage,
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
const BroadcastsPage = lazy(() =>
  import("./pages/BroadcastsPage").then((m) => ({ default: m.BroadcastsPage })),
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

function LazyPage({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "auth" | "chat" | "team" | "settings" | "dashboard" | "default";
}) {
  return (
    <Suspense
      fallback={
        variant === "auth" ? (
          <OnboardingLoadingScreen />
        ) : (
          <PageSkeleton variant={variant} />
        )
      }
    >
      {children}
    </Suspense>
  );
}

function App() {
  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <LazyPage variant="auth">
              <LoginPage />
            </LazyPage>
          }
        />
        <Route
          path="/register"
          element={
            <LazyPage variant="auth">
              <RegisterPage />
            </LazyPage>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <LazyPage variant="auth">
              <ForgotPasswordPage />
            </LazyPage>
          }
        />
        <Route
          path="/reset-password"
          element={
            <LazyPage variant="auth">
              <ResetPasswordPage />
            </LazyPage>
          }
        />
        <Route
          path="/verify-email"
          element={
            <LazyPage variant="auth">
              <VerifyEmailPage />
            </LazyPage>
          }
        />

        <Route
          path="/company-setup"
          element={
            <ProtectedRoute workspaceMode="setup">
              <LazyPage variant="auth">
                <CompanySetupPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspaces"
          element={
            <ProtectedRoute workspaceMode="chooser">
              <LazyPage>
                <WorkspaceChooserPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <WorkspaceRouteGuard />
            </ProtectedRoute>
          }
        >
          <Route path="/w/:workspaceId" element={<ProtectedAppLayout />}>
            <Route
              path="chat"
              element={
                <LazyPage variant="chat">
                  <ChatPage />
                </LazyPage>
              }
            />
            <Route
              path="chat/:contactId"
              element={
                <LazyPage variant="chat">
                  <ChatPage />
                </LazyPage>
              }
            />
            <Route
              path="team"
              element={
                <ProtectedRoute
                  requiredAnyPermission={["can_manage_team", "can_invite"]}
                >
                  <LazyPage variant="team">
                    <TeamPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="settings/:section?"
              element={
                <LazyPage variant="settings">
                  <SettingsPage />
                </LazyPage>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute requiredPermission="can_view_audit">
                  <LazyPage>
                    <AuditPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute requiredPermission="can_view_dashboard">
                  <LazyPage variant="dashboard">
                    <DashboardPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="broadcasts"
              element={
                <ProtectedRoute requiredPermission="can_send_bulk_messages">
                  <LazyPage>
                    <BroadcastsPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="broadcasts/:jobId"
              element={
                <ProtectedRoute requiredPermission="can_send_bulk_messages">
                  <LazyPage>
                    <BroadcastsPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="notifications"
              element={
                <LazyPage>
                  <NotificationsPage />
                </LazyPage>
              }
            />
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="*" element={<Navigate to="chat" replace />} />
          </Route>
        </Route>

        {[
          "/chat",
          "/chat/:contactId",
          "/settings",
          "/settings/:section",
          "/dashboard",
          "/broadcasts",
          "/team",
          "/audit",
          "/notifications",
        ].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <ProtectedRoute>
                <LegacyWorkspaceRedirect />
              </ProtectedRoute>
            }
          />
        ))}

        <Route
          path="/invite/:token"
          element={
            <LazyPage>
              <AcceptInvitationPage />
            </LazyPage>
          }
        />
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
      <KeyboardShortcutsModal />
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;
