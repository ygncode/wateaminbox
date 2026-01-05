import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ProtectedRoute } from './components/auth'
import { KeyboardShortcutsModal } from './components/settings'
import {
  AcceptInvitationPage,
  AuditPage,
  ChatPage,
  CompanySetupPage,
  DashboardPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  SettingsPage,
  TeamPage,
} from './pages'

function App() {
  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Company setup (protected but doesn't require company) */}
        <Route
          path="/company-setup"
          element={
            <ProtectedRoute requireCompany={false}>
              <CompanySetupPage />
            </ProtectedRoute>
          }
        />

        {/* Protected routes (require company) */}
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:contactId"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute>
              <TeamPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute>
              <AuditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Accept invitation (protected but doesn't require company) */}
        <Route
          path="/invite/:token"
          element={
            <ProtectedRoute requireCompany={false}>
              <AcceptInvitationPage />
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
  )
}

export default App
