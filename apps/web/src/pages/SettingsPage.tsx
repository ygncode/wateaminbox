import {
  ArrowLeft,
  Bell,
  ChevronRight,
  FileText,
  Globe,
  Keyboard,
  LayoutDashboard,
  LogOut,
  ShoppingBag,
  Smartphone,
  Tag,
  Upload,
  User,
  Users,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ContactImport } from '../components/contacts'
import { AppLayout } from '../components/layout/app-layout'
import {
  CatalogManager,
  KeyboardShortcutsModal,
  LabelSyncManager,
  LanguageSwitcher,
  NotificationSettings,
  QuickRepliesManager,
} from '../components/settings'
import { Button } from '../components/ui'
import { WhatsAppConnectionPanel } from '../components/whatsapp'
import { useAuth } from '../contexts/auth-context'

/**
 * Settings page
 * Modern, well-organized settings interface with user profile
 */
export function SettingsPage() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showContactImport, setShowContactImport] = useState(false)

  const handleLogout = async () => {
    await logout()
  }

  return (
    <AppLayout>
      <div className="flex h-full w-full flex-col bg-gradient-to-br from-gray-50 to-gray-100 dark:from-dark-primary dark:to-dark-secondary">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-10 bg-white/80 dark:bg-dark-secondary/80 backdrop-blur-sm border-b border-gray-200 dark:border-dark-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <Link
                to="/chat"
                className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary transition-colors group"
              >
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                <span>Back to Chat</span>
              </Link>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
                {t('settings.title', 'Settings')}
              </h1>
              <div className="w-24" /> {/* Spacer for centering */}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* User Profile Card */}
            <div className="mb-8">
              <div className="bg-white dark:bg-dark-elevated rounded-2xl shadow-sm border border-gray-200 dark:border-dark-border overflow-hidden">
                <div className="bg-gradient-to-r from-[#25D366] to-[#128C7E] px-6 py-5">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border-2 border-white/30">
                      <User className="w-8 h-8 text-white" />
                    </div>
                    <div className="flex-1">
                      <h2 className="text-xl font-bold text-white">{user?.name || 'User'}</h2>
                      <p className="text-sm text-white/80">{user?.email}</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleLogout}
                      className="gap-2 bg-white/10 border-white/30 text-white hover:bg-white/20 hover:border-white/50"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Settings Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-6">
                {/* WhatsApp Connection */}
                <SettingsCard
                  icon={<Smartphone className="h-5 w-5" />}
                  title={t('settings.whatsappConnections', 'WhatsApp Connections')}
                  iconBg="bg-[#25D366]/10"
                  iconColor="text-[#25D366]"
                  noPadding
                >
                  <WhatsAppConnectionPanel multiConnection hideHeader />
                </SettingsCard>

                {/* Notifications */}
                <SettingsCard
                  icon={<Bell className="h-5 w-5" />}
                  title={t('settings.notifications', 'Notifications')}
                  iconBg="bg-amber-100"
                  iconColor="text-amber-600"
                >
                  <NotificationSettings />
                </SettingsCard>

                {/* Quick Replies */}
                <SettingsCard
                  icon={<Zap className="h-5 w-5" />}
                  title={t('settings.quickReplies', 'Quick Replies')}
                  iconBg="bg-cyan-100"
                  iconColor="text-cyan-600"
                >
                  <QuickRepliesManager />
                </SettingsCard>

                {/* WhatsApp Labels Sync */}
                <SettingsCard
                  icon={<Tag className="h-5 w-5" />}
                  title={t('settings.labelSync', 'WhatsApp Labels')}
                  iconBg="bg-indigo-100"
                  iconColor="text-indigo-600"
                >
                  <LabelSyncManager />
                </SettingsCard>

                {/* WhatsApp Catalogs */}
                <SettingsCard
                  icon={<ShoppingBag className="h-5 w-5" />}
                  title={t('settings.catalogs', 'Product Catalogs')}
                  iconBg="bg-orange-100"
                  iconColor="text-orange-600"
                >
                  <CatalogManager />
                </SettingsCard>

                {/* Contact Import */}
                <SettingsCard
                  icon={<Upload className="h-5 w-5" />}
                  title={t('settings.contactImport', 'Contact Import')}
                  iconBg="bg-blue-100"
                  iconColor="text-blue-600"
                >
                  <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-4">
                    {t(
                      'settings.contactImportDescription',
                      'Import contacts from a CSV file to quickly add multiple contacts at once.'
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setShowContactImport(true)}
                    className="gap-2 hover:border-[#25D366] hover:text-[#25D366]"
                  >
                    <Upload className="h-4 w-4" />
                    {t('settings.importContacts', 'Import Contacts')}
                  </Button>
                </SettingsCard>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                {/* Language */}
                <SettingsCard
                  icon={<Globe className="h-5 w-5" />}
                  title={t('settings.language', 'Language')}
                  iconBg="bg-purple-100"
                  iconColor="text-purple-600"
                >
                  <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-4">
                    {t(
                      'settings.languageDescription',
                      'Choose your preferred language for the application interface.'
                    )}
                  </p>
                  <LanguageSwitcher showLabel={false} />
                </SettingsCard>

                {/* Keyboard Shortcuts */}
                <SettingsCard
                  icon={<Keyboard className="h-5 w-5" />}
                  title={t('settings.keyboardShortcuts', 'Keyboard Shortcuts')}
                  iconBg="bg-gray-100"
                  iconColor="text-gray-600"
                >
                  <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-4">
                    {t(
                      'settings.keyboardShortcutsDescription',
                      'View all available keyboard shortcuts to navigate the app faster.'
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setShowKeyboardShortcuts(true)}
                    className="gap-2 hover:border-[#25D366] hover:text-[#25D366]"
                  >
                    <Keyboard className="h-4 w-4" />
                    {t('settings.viewShortcuts', 'View Shortcuts')}
                  </Button>
                </SettingsCard>

                {/* Quick Links */}
                <SettingsCard title={t('settings.quickLinks', 'Quick Links')} noPadding>
                  <div className="divide-y divide-gray-100 dark:divide-dark-border">
                    <QuickLink
                      to="/dashboard"
                      state={{ from: 'settings' }}
                      icon={<LayoutDashboard className="h-5 w-5" />}
                      iconBg="bg-emerald-100"
                      iconColor="text-emerald-600"
                      title={t('settings.dashboard', 'Dashboard')}
                      description={t(
                        'settings.dashboardDescription',
                        'View analytics and statistics'
                      )}
                    />
                    <QuickLink
                      to="/team"
                      state={{ from: 'settings' }}
                      icon={<Users className="h-5 w-5" />}
                      iconBg="bg-blue-100"
                      iconColor="text-blue-600"
                      title={t('settings.teamManagement', 'Team Management')}
                      description={t(
                        'settings.teamManagementDescription',
                        'Manage team members and invitations'
                      )}
                    />
                    <QuickLink
                      to="/audit"
                      icon={<FileText className="h-5 w-5" />}
                      iconBg="bg-orange-100"
                      iconColor="text-orange-600"
                      title={t('settings.auditLog', 'Audit Log')}
                      description={t(
                        'settings.auditLogDescription',
                        'View activity and security logs'
                      )}
                    />
                  </div>
                </SettingsCard>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 text-center">
              <p className="text-xs text-gray-400 dark:text-dark-text-tertiary">
                WhatsApp Web &middot; Built with care
              </p>
            </div>
          </div>
        </main>

        {/* Modals */}
        <KeyboardShortcutsModal
          open={showKeyboardShortcuts}
          onOpenChange={setShowKeyboardShortcuts}
        />

        {showContactImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <ContactImport
              onClose={() => setShowContactImport(false)}
              onImportComplete={() => {
                setShowContactImport(false)
              }}
            />
          </div>
        )}
      </div>
    </AppLayout>
  )
}

/* ============================================
   Sub-components
   ============================================ */

interface SettingsCardProps {
  icon?: React.ReactNode
  title: string
  iconBg?: string
  iconColor?: string
  children: React.ReactNode
  noPadding?: boolean
}

function SettingsCard({
  icon,
  title,
  iconBg = 'bg-gray-100',
  iconColor = 'text-gray-600',
  children,
  noPadding = false,
}: SettingsCardProps) {
  return (
    <div className="bg-white dark:bg-dark-elevated rounded-xl shadow-sm border border-gray-200 dark:border-dark-border overflow-visible hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-dark-border">
        {icon && (
          <div className={`p-2 rounded-lg ${iconBg} dark:bg-dark-tertiary`}>
            <span className={iconColor}>{icon}</span>
          </div>
        )}
        <h3 className="font-semibold text-gray-900 dark:text-dark-text-primary">{title}</h3>
      </div>
      <div className={noPadding ? '' : 'px-5 py-4'}>{children}</div>
    </div>
  )
}

interface QuickLinkProps {
  to: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  title: string
  description: string
  state?: Record<string, unknown>
}

function QuickLink({ to, icon, iconBg, iconColor, title, description, state }: QuickLinkProps) {
  return (
    <Link
      to={to}
      state={state}
      className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors group"
    >
      <div className={`p-2.5 rounded-lg ${iconBg} dark:bg-dark-tertiary`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-dark-text-primary group-hover:text-[#25D366] transition-colors">
          {title}
        </p>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary truncate">
          {description}
        </p>
      </div>
      <ChevronRight className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary group-hover:text-[#25D366] group-hover:translate-x-1 transition-all" />
    </Link>
  )
}
