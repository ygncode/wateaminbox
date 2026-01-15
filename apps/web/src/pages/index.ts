/**
 * @deprecated This barrel export is deprecated. Import pages directly instead.
 *
 * With route-based code splitting in App.tsx, pages are now lazy-loaded
 * directly from their individual files to ensure proper chunk separation.
 *
 * Instead of:
 *   import { ChatPage } from './pages'
 *
 * Use:
 *   const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })))
 *
 * Or for non-lazy imports:
 *   import { ChatPage } from './pages/ChatPage'
 */

export { AcceptInvitationPage } from "./AcceptInvitationPage";
export { AuditPage } from "./AuditPage";
export { ChatPage } from "./ChatPage";
export { CompanySetupPage } from "./CompanySetupPage";
export { DashboardPage } from "./DashboardPage";
export { ForgotPasswordPage } from "./ForgotPasswordPage";
export { LoginPage } from "./LoginPage";
export { RegisterPage } from "./RegisterPage";
export { SettingsPage } from "./SettingsPage";
export { TeamPage } from "./TeamPage";
