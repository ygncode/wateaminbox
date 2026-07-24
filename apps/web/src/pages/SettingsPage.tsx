import {
  ArrowLeft,
  Bell,
  ChevronRight,
  FileText,
  Globe2,
  Keyboard,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Package,
  ShieldCheck,
  Smartphone,
  Tag,
  Upload,
  UserRound,
  Users,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { preloadRoute, type RouteName } from "@/lib/route-preload";
import { ContactImport } from "../components/contacts";
import { AppLayout } from "../components/layout/app-layout";
import {
  CatalogManager,
  KeyboardShortcutsModal,
  LabelSyncManager,
  LanguageSwitcher,
  NotificationSettings,
  QuickRepliesManager,
} from "../components/settings";
import { Button } from "../components/ui";
import { WhatsAppConnectionPanel } from "../components/whatsapp";
import { useAuth } from "../contexts/auth-context";

export function SettingsPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showContactImport, setShowContactImport] = useState(false);

  return (
    <AppLayout>
      <div className="settings-workspace flex h-full w-full flex-col overflow-hidden bg-[#f4f7f5] text-slate-900 dark:bg-[#0b1418] dark:text-[#edf5f1]">
        <header className="shrink-0 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0d181c]/90">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link
              to="/chat"
              className="group inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-950 dark:text-[#91a29e] dark:hover:text-white"
              onMouseEnter={() => preloadRoute("chat")}
              onFocus={() => preloadRoute("chat")}
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              Back to inbox
            </Link>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,.9)]" />
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-[#778984]">
                Workspace settings
              </span>
            </div>
            <Button
              variant="ghost"
              onClick={() => void logout()}
              className="h-9 gap-2 px-3 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-[#9bacA7] dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
            <section className="relative mb-8 overflow-hidden rounded-2xl border border-emerald-950/10 bg-[#e5f2ea] px-5 py-6 sm:px-7 dark:border-emerald-300/[0.10] dark:bg-[#10251f]">
              <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-400/10" />
              <div className="pointer-events-none absolute bottom-0 right-0 h-px w-2/3 bg-gradient-to-l from-emerald-400/50 to-transparent" />
              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#0c5c47] text-white shadow-lg shadow-emerald-950/20">
                    <UserRound className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800/70 dark:text-emerald-300/65">
                      Your workspace
                    </p>
                    <h1 className="font-serif text-2xl font-semibold tracking-tight text-[#17382f] dark:text-[#f0faf5]">
                      {t("settings.title", "Settings")}
                    </h1>
                    <p className="mt-1 text-sm text-[#477164] dark:text-[#9dbbb0]">
                      {user?.name || "User"}{" "}
                      <span className="mx-1.5 text-emerald-700/40 dark:text-emerald-300/30">
                        /
                      </span>{" "}
                      {user?.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white/60 px-3 py-2 text-xs font-medium text-[#27624e] dark:border-emerald-200/10 dark:bg-black/15 dark:text-emerald-200">
                  <ShieldCheck className="h-4 w-4" />
                  Secure workspace controls
                </div>
              </div>
            </section>

            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
                  Configuration
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  Run your inbox your way
                </h2>
              </div>
              <p className="hidden max-w-xs text-right text-sm text-slate-500 dark:text-[#8fa29c] md:block">
                Connections, communication preferences, and team tools in one
                place.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
              <div className="space-y-5 xl:col-span-7">
                <SettingsCard
                  eyebrow="CHANNELS"
                  icon={<Smartphone />}
                  title={t(
                    "settings.whatsappConnections",
                    "WhatsApp Connections",
                  )}
                  tone="emerald"
                  noPadding
                >
                  <WhatsAppConnectionPanel multiConnection hideHeader />
                </SettingsCard>
                <SettingsCard
                  eyebrow="ATTENTION"
                  icon={<Bell />}
                  title={t("settings.notifications", "Notifications")}
                  tone="amber"
                >
                  <NotificationSettings />
                </SettingsCard>
                <SettingsCard
                  eyebrow="SPEED"
                  icon={<Zap />}
                  title={t("settings.quickReplies", "Quick Replies")}
                  tone="sky"
                >
                  <QuickRepliesManager />
                </SettingsCard>
                <SettingsCard
                  eyebrow="SYNC"
                  icon={<Tag />}
                  title={t("settings.labelSync", "WhatsApp Labels")}
                  tone="violet"
                >
                  <LabelSyncManager />
                </SettingsCard>
                <SettingsCard
                  eyebrow="CATALOG"
                  icon={<Package />}
                  title={t("settings.catalogs", "Product Catalogs")}
                  tone="orange"
                >
                  <CatalogManager />
                </SettingsCard>
              </div>

              <aside className="space-y-5 xl:col-span-5">
                <SettingsCard
                  eyebrow="PREFERENCES"
                  icon={<Globe2 />}
                  title={t("settings.language", "Language")}
                  tone="cyan"
                >
                  <p className="mb-5 max-w-md text-sm leading-6 text-slate-500 dark:text-[#9baea8]">
                    {t(
                      "settings.languageDescription",
                      "Choose your preferred language for the application interface.",
                    )}
                  </p>
                  <LanguageSwitcher showLabel={false} />
                </SettingsCard>
                <SettingsCard
                  eyebrow="TOOLS"
                  icon={<Keyboard />}
                  title={t("settings.keyboardShortcuts", "Keyboard Shortcuts")}
                  tone="slate"
                >
                  <p className="mb-5 text-sm leading-6 text-slate-500 dark:text-[#9baea8]">
                    {t(
                      "settings.keyboardShortcutsDescription",
                      "View all available keyboard shortcuts to navigate the app faster.",
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setShowKeyboardShortcuts(true)}
                    className="gap-2 border-slate-200 bg-white hover:border-emerald-500 hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/50 dark:hover:text-emerald-300"
                  >
                    <Keyboard className="h-4 w-4" />
                    {t("settings.viewShortcuts", "View Shortcuts")}
                  </Button>
                </SettingsCard>
                <SettingsCard
                  eyebrow="DATA"
                  icon={<Upload />}
                  title={t("settings.contactImport", "Contact Import")}
                  tone="blue"
                >
                  <p className="mb-5 text-sm leading-6 text-slate-500 dark:text-[#9baea8]">
                    {t(
                      "settings.contactImportDescription",
                      "Import contacts from a CSV file to quickly add multiple contacts at once.",
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setShowContactImport(true)}
                    className="gap-2 border-slate-200 bg-white hover:border-emerald-500 hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-emerald-400/50 dark:hover:text-emerald-300"
                  >
                    <Upload className="h-4 w-4" />
                    {t("settings.importContacts", "Import Contacts")}
                  </Button>
                </SettingsCard>
                <SettingsCard
                  eyebrow="WORKSPACE"
                  icon={<MessageSquareText />}
                  title={t("settings.quickLinks", "Quick Links")}
                  tone="slate"
                  noPadding
                >
                  <div className="divide-y divide-slate-100 dark:divide-white/[0.07]">
                    <QuickLink
                      to="/dashboard"
                      state={{ from: "settings" }}
                      icon={<LayoutDashboard />}
                      title={t("settings.dashboard", "Dashboard")}
                      description={t(
                        "settings.dashboardDescription",
                        "View analytics and statistics",
                      )}
                      preloadRouteName="dashboard"
                    />
                    <QuickLink
                      to="/team"
                      state={{ from: "settings" }}
                      icon={<Users />}
                      title={t("settings.teamManagement", "Team Management")}
                      description={t(
                        "settings.teamManagementDescription",
                        "Manage team members and invitations",
                      )}
                      preloadRouteName="team"
                    />
                    <QuickLink
                      to="/audit"
                      icon={<FileText />}
                      title={t("settings.auditLog", "Audit Log")}
                      description={t(
                        "settings.auditLogDescription",
                        "View activity and security logs",
                      )}
                      preloadRouteName="audit"
                    />
                  </div>
                </SettingsCard>
              </aside>
            </div>
            <p className="mt-8 pb-3 text-center text-xs font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-[#657872]">
              WATeamInbox · workspace control centre
            </p>
          </div>
        </main>

        <KeyboardShortcutsModal
          open={showKeyboardShortcuts}
          onOpenChange={setShowKeyboardShortcuts}
        />
        {showContactImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <ContactImport
              onClose={() => setShowContactImport(false)}
              onImportComplete={() => setShowContactImport(false)}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}

const tones = {
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
  orange:
    "bg-orange-100 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-[#b8c8c2]",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
};

function SettingsCard({
  eyebrow,
  icon,
  title,
  tone,
  children,
  noPadding = false,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  tone: keyof typeof tones;
  children: ReactNode;
  noPadding?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_1px_rgba(15,23,42,.02),0_10px_30px_rgba(15,23,42,.035)] transition-shadow hover:shadow-[0_12px_36px_rgba(15,23,42,.07)] dark:border-white/[0.08] dark:bg-[#132126] dark:shadow-none">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/[0.07]">
        <div
          className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.16em] text-slate-400 dark:text-[#778a83]">
            {eyebrow}
          </p>
          <h3 className="mt-0.5 font-semibold tracking-tight text-slate-900 dark:text-[#eff7f3]">
            {title}
          </h3>
        </div>
      </div>
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </section>
  );
}

function QuickLink({
  to,
  icon,
  title,
  description,
  state,
  preloadRouteName,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  state?: Record<string, unknown>;
  preloadRouteName?: RouteName;
}) {
  const prefetch = preloadRouteName
    ? () => preloadRoute(preloadRouteName)
    : undefined;
  return (
    <Link
      to={to}
      state={state}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-emerald-50/60 dark:hover:bg-white/[0.035]"
    >
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500 transition-colors group-hover:bg-emerald-100 group-hover:text-emerald-700 dark:bg-white/[0.06] dark:text-[#9fb2ab] dark:group-hover:bg-emerald-400/10 dark:group-hover:text-emerald-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-[#e8f2ed]">
          {title}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-[#91a49d]">
          {description}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600 dark:text-[#61746d] dark:group-hover:text-emerald-300" />
    </Link>
  );
}
