import { ArrowLeft, LayoutDashboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { Dashboard } from '../components/dashboard/Dashboard'
import { AppLayout } from '../components/layout/app-layout'
import { useAuth } from '../contexts/auth-context'

/**
 * Dashboard page
 * Shows analytics and statistics for the company
 */
interface LocationState {
  from?: string
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { currentCompanyId, companies } = useAuth()
  const location = useLocation()
  const locationState = location.state as LocationState | null

  // Determine back navigation based on where user came from
  const backTo = locationState?.from === 'settings' ? '/settings' : '/chat'
  const backLabel =
    locationState?.from === 'settings'
      ? t('common.backToSettings', 'Back to Settings')
      : t('common.backToChat', 'Back to Chat')

  const companyId = currentCompanyId || companies?.[0]?.id
  const currentCompany = companies?.find((c) => c.id === companyId)
  const isAdmin = currentCompany?.role === 'admin' || currentCompany?.role === 'owner'

  return (
    <AppLayout>
      <div className="flex h-full w-full flex-col bg-gray-50 dark:bg-dark-primary">
        {/* Unified Dashboard Header */}
        <header className="relative bg-white dark:bg-dark-secondary border-b border-gray-200 dark:border-dark-border">
          {/* Subtle accent line */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#25D366] via-[#128C7E] to-[#075E54]" />

          <div className="flex items-center justify-between px-6 py-4">
            {/* Left: Back navigation */}
            <Link
              to={backTo}
              className="group flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary transition-all duration-200"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 dark:bg-dark-tertiary group-hover:bg-[#25D366]/10 transition-colors">
                <ArrowLeft className="h-4 w-4 group-hover:text-[#25D366] transition-colors" />
              </span>
              <span className="hidden sm:inline font-medium">{backLabel}</span>
            </Link>

            {/* Center: Title with icon */}
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] shadow-sm">
                <LayoutDashboard className="h-5 w-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary tracking-tight">
                  {t('dashboard.title', 'Dashboard')}
                </h1>
                <p className="text-xs text-gray-500 dark:text-dark-text-secondary -mt-0.5">
                  {t('dashboard.subtitle', 'Analytics & Insights')}
                </p>
              </div>
            </div>

            {/* Right: Placeholder for future actions (keeps layout balanced) */}
            <div className="w-8 sm:w-24" />
          </div>
        </header>

        {/* Dashboard content */}
        <div className="flex-1 overflow-auto">
          {companyId ? (
            <Dashboard companyId={companyId} isAdmin={isAdmin} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 dark:text-dark-text-secondary">
                {t('dashboard.noCompany', 'Please select a company to view dashboard')}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
