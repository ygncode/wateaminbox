import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { getInitialAppSidebarCollapsed } from "@/components/layout/app-shell-preferences";
import {
  isConversationDetailPath,
  resolveAppShellChrome,
} from "@/components/layout/conversation-chrome";
import { getInitialSidebarWidth } from "@/components/layout/resizable-sidebar";
import { cn } from "@/lib/utils";
import { BrandMark } from "../brand/BrandMark";
import {
  ChatListRowsSkeleton,
  ChatListToolbarSkeleton,
} from "../chat/ChatListSkeleton";
import {
  ComposerSkeleton,
  ConversationMessagesSkeleton,
  ThreadHeaderSkeleton,
} from "../chat/ConversationMessagesSkeleton";
import { NotificationListSkeleton } from "../notifications/NotificationList";
import { OnboardingLoadingScreen } from "./onboarding-state";
import { Skeleton } from "./skeleton";
import {
  PageHeaderSkeleton,
  SkeletonLine,
  TableCardSkeleton,
} from "./table-skeleton";

export type PageSkeletonVariant =
  | "default"
  | "chat"
  | "settings"
  | "dashboard"
  | "auth"
  | "team"
  | "workspace-chooser"
  | "audit"
  | "broadcasts"
  | "notifications";

/**
 * The skeleton a protected path should show while its guards resolve.
 *
 * Shared by every gate above `ProtectedAppLayout` so they all place the same
 * screen: a guard that guessed "default" while the next one guessed "chat"
 * would flash a centred spinner between two identical inboxes.
 */
export function workspaceLoadingVariant(pathname: string): PageSkeletonVariant {
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/settings")) return "settings";
  if (pathname.includes("/dashboard")) return "dashboard";
  if (pathname.includes("/team")) return "team";
  if (pathname.includes("/audit")) return "audit";
  if (pathname.includes("/broadcasts")) return "broadcasts";
  if (pathname.includes("/notifications")) return "notifications";
  return "default";
}

export interface PageSkeletonProps {
  variant?: PageSkeletonVariant;
  className?: string;
  /**
   * Draw the workspace shell around the page placeholder.
   *
   * A protected page is loaded twice over: the auth/workspace gate renders a
   * skeleton before `ProtectedAppLayout` exists, then the layout mounts and
   * the route's own lazy chunk renders a second one inside it. Without the
   * shell the first paint is a different screen from the second, and the user
   * watches the app rebuild itself. Callers above the layout pass this;
   * callers inside it must not, or the rail is drawn twice.
   */
  withShell?: boolean;
}

/**
 * Page loading skeleton component for Suspense fallbacks
 * Provides visual placeholders that match the structure of each page type
 */
export function PageSkeleton({
  variant = "default",
  className,
  withShell = false,
}: PageSkeletonProps) {
  const page = (() => {
    switch (variant) {
      case "chat":
        return <ChatPageSkeleton className={className} />;
      case "settings":
        return <SettingsPageSkeleton className={className} />;
      case "dashboard":
        return <DashboardPageSkeleton className={className} />;
      case "auth":
        // Auth routes share the onboarding frame; see AuthPageShell.
        return <OnboardingLoadingScreen />;
      case "team":
        return <TeamPageSkeleton className={className} />;
      case "workspace-chooser":
        return <WorkspaceChooserSkeleton className={className} />;
      case "audit":
      case "broadcasts":
        return <DataPageSkeleton className={className} variant={variant} />;
      case "notifications":
        return <NotificationsPageSkeleton className={className} />;
      default:
        return <DefaultPageSkeleton className={className} />;
    }
  })();

  return withShell ? <AppShellSkeleton>{page}</AppShellSkeleton> : page;
}

/**
 * The navigation rail and content column of `ProtectedAppLayout`, in grey.
 *
 * Deliberately a copy of that layout's geometry rather than a shared
 * component: the real rail needs a workspace, a user, and permissions to
 * decide what it contains, none of which have loaded at the moment this is
 * on screen. Matching its widths, radii, and dark-green ground is what makes
 * the handover invisible.
 */
function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const collapsed = getInitialAppSidebarCollapsed();
  const shellChrome = resolveAppShellChrome(pathname);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <aside
        data-sk="rail"
        className={cn(
          "relative hidden h-full shrink-0 flex-col bg-nav py-3 lg:flex",
          collapsed ? "w-[72px] px-2" : "w-[226px] px-3",
        )}
      >
        <div
          data-sk="ws-switcher"
          className={cn(
            "flex items-center rounded-xl",
            collapsed
              ? "h-11 justify-center p-1"
              : "gap-3 border border-nav-fg/10 bg-nav-hover p-2.5",
          )}
        >
          <Skeleton className="size-9 shrink-0 rounded-lg bg-nav-active" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-24 bg-nav-active" />
              <Skeleton className="mt-1.5 h-2.5 w-12 bg-nav-active" />
            </div>
          )}
        </div>

        <div data-sk="rail-nav" className="mt-5 space-y-1">
          {/* Inbox, Dashboard, Broadcasts, Team, Audit - the items every
              owner/admin sees. Members see fewer; the extra rows sit below the
              real ones and are gone before anything else moves. */}
          {[12, 20, 22, 11, 11].map((width, index) => (
            <div
              key={index}
              className={cn(
                "flex items-center rounded-xl",
                collapsed ? "h-11 justify-center" : "h-10 gap-3 px-3",
                index === 0 && "bg-nav-active",
              )}
            >
              <Skeleton className="size-[18px] shrink-0 rounded bg-nav-active" />
              {!collapsed && (
                <Skeleton
                  className="h-3 bg-nav-active"
                  style={{ width: `${width * 4}px` }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <div
            className={cn(
              "mb-2 flex h-10 items-center",
              collapsed ? "justify-center" : "gap-3 px-3",
            )}
          >
            <Skeleton className="size-[18px] shrink-0 rounded bg-nav-active" />
            {!collapsed && <Skeleton className="h-3 w-24 bg-nav-active" />}
          </div>
          <div className="space-y-1 border-t border-nav-fg/10 pt-3">
            <div
              className={cn(
                "flex h-10 items-center",
                collapsed ? "justify-center" : "gap-3 px-3",
              )}
            >
              <Skeleton className="size-[18px] shrink-0 rounded bg-nav-active" />
              {!collapsed && <Skeleton className="h-3 w-16 bg-nav-active" />}
            </div>
            <div
              className={cn(
                "flex items-center gap-1",
                collapsed ? "flex-col" : "px-1",
              )}
            >
              <Skeleton className="size-8 rounded-lg bg-nav-active" />
              <Skeleton className="size-8 rounded-lg bg-nav-active" />
            </div>
            {collapsed ? (
              <div className="mt-2 flex flex-col items-center gap-1.5">
                <Skeleton className="size-10 rounded-xl bg-nav-active" />
                <Skeleton className="size-10 rounded-xl bg-nav-active" />
              </div>
            ) : (
              <div
                data-sk="rail-user"
                className="mt-2 overflow-hidden rounded-xl border border-nav-fg/10 bg-nav-hover"
              >
                <div className="flex items-center gap-3 p-2.5">
                  <Skeleton className="size-10 shrink-0 rounded-xl bg-nav-active" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-3 w-24 bg-nav-active" />
                    <Skeleton className="mt-1.5 h-2.5 w-28 bg-nav-active" />
                  </div>
                </div>
                <div className="flex h-9 items-center gap-2 border-t border-nav-fg/10 px-3">
                  <Skeleton className="size-3.5 shrink-0 rounded bg-nav-active" />
                  <Skeleton className="h-2.5 w-14 bg-nav-active" />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div
        data-sk="frame"
        className="app-frame relative flex min-w-0 flex-1 flex-col"
      >
        <header
          data-sk="mobile-header"
          className={cn(
            "safe-area-top h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-nav-fg/10 bg-nav px-2",
            shellChrome.workspaceHeaderClass,
          )}
        >
          <div
            data-sk="ws-compact"
            className="flex h-10 w-[190px] max-w-[210px] min-w-0 items-center gap-2 px-2"
          >
            <Skeleton className="size-9 shrink-0 rounded-lg bg-nav-active" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-28 bg-nav-active" />
              <Skeleton className="mt-1.5 h-2.5 w-12 bg-nav-active" />
            </div>
            <Skeleton className="size-4 shrink-0 rounded bg-nav-active" />
          </div>
          <div className="flex gap-1">
            <Skeleton className="size-9 rounded-lg bg-nav-active" />
            <Skeleton className="size-9 rounded-lg bg-nav-active" />
          </div>
        </header>
        <main
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
            shellChrome.mainPaddingClass,
          )}
        >
          {children}
        </main>
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-30 justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.625rem)]",
            shellChrome.navClass,
          )}
        >
          <div
            data-sk="mobile-nav"
            className="flex w-full max-w-md items-stretch gap-1 rounded-[1.75rem] border border-line bg-surface p-1.5 shadow-lg"
          >
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className={cn(
                  "flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl",
                  index === 0 && "bg-muted",
                )}
              >
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-2 w-8" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Chat page skeleton - the inbox list pane and the conversation area.
 *
 * Built from the same pieces the live inbox uses while it loads
 * (ChatListSkeleton, ThreadHeaderSkeleton, ComposerSkeleton), inside the
 * same pane geometry as ChatPage's Sidebar/ChatSidebar: Chats/Groups tabs on
 * desktop only, then the toolbar, then rows.
 */
function ChatPageSkeleton({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const isConversation = isConversationDetailPath(pathname);
  const sidebarWidth = getInitialSidebarWidth();

  return (
    <div
      className={cn("flex min-h-0 flex-1 overflow-hidden bg-page", className)}
    >
      <div
        className={cn(
          "h-full w-full shrink-0 flex-col border-e border-line bg-panel md:flex md:w-[320px] lg:w-[var(--chat-skeleton-width)]",
          isConversation ? "hidden" : "flex",
        )}
        style={
          {
            "--chat-skeleton-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <div
          data-sk="list-tabs"
          className="hidden h-[60px] min-h-[60px] shrink-0 items-stretch border-b border-line bg-panel lg:flex"
        >
          {[0, 1].map((index) => (
            <div
              key={index}
              className={cn(
                "-mb-px flex flex-1 items-center justify-center gap-2 border-b-2",
                index === 0 ? "border-tab-on" : "border-transparent",
              )}
            >
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className={cn("h-3", index === 0 ? "w-10" : "w-12")} />
            </div>
          ))}
        </div>
        <div
          data-sk="list-pane"
          className="flex min-h-0 flex-1 flex-col border-e border-line bg-panel"
        >
          <ChatListToolbarSkeleton />
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatListRowsSkeleton count={10} />
          </div>
        </div>
      </div>

      {isConversation ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <ThreadHeaderSkeleton />
          <ConversationMessagesSkeleton decorative />
          <ComposerSkeleton />
        </div>
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center bg-chat md:flex">
          <div className="flex flex-col items-center px-8">
            <Skeleton className="size-20 rounded-[1.65rem]" />
            <Skeleton className="mt-7 h-3 w-32 rounded-full" />
            <Skeleton className="mt-4 h-8 w-72 max-w-full rounded-lg" />
            <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-md" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Settings page skeleton - section nav + the General panel, laid out with the
 * same classes as SettingsPage (nav groups, header, Panel).
 */
function SettingsPageSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div
      className={cn("flex h-full min-h-0 w-full bg-page", className)}
      role="status"
      aria-label={t("layout.loadingSettings", "Loading workspace settings")}
    >
      <aside
        data-sk="settings-nav"
        className="hidden w-64 shrink-0 overflow-hidden border-e border-line bg-surface px-4 py-6 md:block"
      >
        <SkeletonLine className="h-4 px-2" bar="h-2.5 w-16" />
        <SkeletonLine className="mt-2 h-7 px-2" bar="h-5 w-36" />
        <div className="mt-7 space-y-5">
          {[3, 3, 4, 1, 1].map((itemCount, groupIndex) => (
            <div key={groupIndex}>
              <SkeletonLine className="mb-1 h-[15px] px-2" bar="h-2 w-20" />
              <div className="space-y-0.5">
                {Array.from({ length: itemCount }).map((_, itemIndex) => (
                  <div
                    key={itemIndex}
                    className={cn(
                      "flex h-9 items-center gap-3 rounded-lg px-2.5",
                      groupIndex === 0 && itemIndex === 0 && "bg-muted",
                    )}
                  >
                    <Skeleton className="size-4 shrink-0 rounded" />
                    <Skeleton
                      className={cn("h-3", itemIndex % 2 ? "w-28" : "w-24")}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
          <div className="mb-6 md:hidden">
            <SkeletonLine className="h-4" bar="h-2.5 w-16" />
            <Skeleton className="mt-3 h-11 w-full rounded-lg" />
          </div>

          <header
            data-sk="page-header"
            className="mb-7 border-b border-line pb-5"
          >
            <SkeletonLine className="h-4" bar="h-2.5 w-20" />
            <SkeletonLine className="mt-1 h-8" bar="h-6 w-44" />
          </header>

          <div className="space-y-5">
            <section
              data-sk="card"
              className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6"
            >
              <SkeletonLine className="h-6" bar="h-4 w-40" />
              <div className="mb-5 mt-1">
                <SkeletonLine className="h-6" bar="h-3 w-full max-w-md" />
                <SkeletonLine className="h-6 sm:hidden" bar="h-3 w-4/5" />
                <SkeletonLine className="h-6 sm:hidden" bar="h-3 w-2/3" />
              </div>
              <div className="space-y-6">
                <div className="flex flex-col gap-4 rounded-2xl border border-line bg-subtle p-4 sm:flex-row sm:items-center">
                  <Skeleton className="size-20 shrink-0 rounded-2xl" />
                  <div className="min-w-0 flex-1">
                    <SkeletonLine className="h-5" bar="h-3.5 w-28" />
                    <SkeletonLine
                      className="mt-1 h-5"
                      bar="h-2.5 w-full max-w-xs"
                    />
                    <SkeletonLine className="h-5" bar="h-2.5 w-3/5" />
                  </div>
                  <Skeleton className="h-9 w-full shrink-0 rounded-lg sm:w-[6.25rem]" />
                </div>
                <div>
                  <SkeletonLine className="h-5" bar="h-3 w-28" />
                  <Skeleton className="mt-2 h-9 w-full rounded-lg" />
                </div>
                <div>
                  <div className="flex h-5 items-center justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                  {/* A textarea is inline: its label keeps ~5px of line box
                      below it, so the block placeholder adds it back. */}
                  <Skeleton className="mt-2 h-[86px] w-full rounded-xl" />
                  <div className="h-[5px]" />
                </div>
                <div className="flex justify-end border-t border-line pt-5">
                  <Skeleton className="h-9 w-36 rounded-lg" />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
              <SkeletonLine className="h-6" bar="h-4 w-28" />
              <SkeletonLine
                className="mb-5 mt-1 h-6"
                bar="h-3 w-full max-w-sm"
              />
              <div className="grid gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index}>
                    <SkeletonLine className="h-4" bar="h-2.5 w-16" />
                    <SkeletonLine className="mt-1 h-5" bar="h-3.5 w-24" />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Dashboard page skeleton - header, the overview stat grid, and the three
 * trend panels, using DashboardHeader/StatCard/ChartPanel geometry.
 */
function DashboardPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-page",
        className,
      )}
    >
      <header
        data-sk="page-header"
        className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <SkeletonLine className="h-[18px]" bar="h-3.5 w-24" />
              <SkeletonLine
                className="mt-1 h-4"
                bar="h-2.5 w-56 max-w-[60vw]"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="hidden h-[34px] w-[13rem] rounded-lg sm:block" />
            <Skeleton className="h-9 flex-1 rounded-lg sm:hidden" />
            <Skeleton className="h-8 w-[7.2rem] rounded-lg" />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div
          data-sk="card"
          className="h-full overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
        >
          <div className="space-y-6 p-4 sm:p-5 lg:p-6">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <SkeletonLine className="h-5" bar="h-3.5 w-36" />
                  <SkeletonLine
                    className="mt-0.5 h-8 sm:h-4"
                    bar="h-2.5 w-64 max-w-[52vw]"
                  />
                </div>
                <Skeleton className="h-[25px] w-16 shrink-0 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    data-sk="stat"
                    className="rounded-xl border border-line bg-surface p-4 shadow-xs"
                  >
                    <Skeleton className="mb-4 size-8 rounded-lg" />
                    <SkeletonLine
                      className="h-[15px]"
                      bar="h-2 w-20 max-w-full"
                    />
                    <SkeletonLine className="mt-1 h-8" bar="h-6 w-12" />
                  </div>
                ))}
              </div>
            </section>

            <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
              <div className="w-[15rem] max-w-full sm:w-auto">
                <SkeletonLine className="h-5" bar="h-3.5 w-28" />
                <SkeletonLine
                  className="mt-0.5 h-4"
                  bar="h-2.5 w-56 max-w-[60vw]"
                />
              </div>
              <Skeleton className="h-[23px] w-24 rounded-full" />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              {["xl:col-span-8", "xl:col-span-4", "xl:col-span-12"].map(
                (span, index) => (
                  <section
                    key={span}
                    data-sk="chart"
                    className={cn(
                      "rounded-xl border border-line bg-surface p-4 shadow-xs sm:p-5",
                      span,
                    )}
                  >
                    <ChartPanelSkeletonBody tall={index === 1} />
                  </section>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ChartPanel title row + chart summary + 220px plot. */
export function ChartPanelSkeletonBody({ tall = false }: { tall?: boolean }) {
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-xl" />
        <div>
          <SkeletonLine className="h-5" bar="h-3.5 w-28" />
          <SkeletonLine
            className="mt-0.5 h-[17px]"
            bar="h-2.5 w-44 max-w-[55vw]"
          />
        </div>
      </div>
      <div className="mb-4 flex h-[43px] items-end gap-5">
        <Skeleton className="h-9 w-14" />
        <Skeleton className="h-9 w-14" />
      </div>
      <Skeleton className="h-[220px] w-full rounded-xl" />
      {/* The contact chart adds an 11px legend under its plot. */}
      {tall && <div className="h-[11px]" />}
    </>
  );
}

/**
 * Workspace chooser skeleton - preserves the chooser's frame while auth and
 * memberships restore. This route used to borrow the onboarding/auth loading
 * screen, which looked like a brief jump back to login before the chooser
 * appeared.
 */
function WorkspaceChooserSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <main
      className={cn(
        "relative min-h-dvh overflow-hidden bg-canvas px-5 py-10 text-fg",
        className,
      )}
      role="status"
      aria-label={t("auth.loadingWorkspaces", "Loading your workspaces…")}
    >
      <div className="relative mx-auto max-w-2xl">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10 shrink-0 rounded-xl object-contain" />
            <span className="text-sm font-semibold tracking-tight">
              WATeamInbox
            </span>
          </div>
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>

        <Skeleton className="h-3 w-36 rounded-full bg-accent/20" />
        <Skeleton className="mt-5 h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="mt-4 h-5 w-full max-w-lg rounded-md" />

        <div className="mt-9 grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-xs"
            >
              <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Skeleton
                  className={cn("h-4", index === 1 ? "w-36" : "w-28")}
                />
                <Skeleton className="mt-2 h-3 w-14" />
              </div>
              <Skeleton className="h-5 w-5 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * Team page skeleton - TeamManagement header, tabs and the members table.
 */
function TeamPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-page",
        className,
      )}
    >
      <header
        data-sk="page-header"
        className="border-b border-line bg-surface px-4 py-4 sm:px-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <SkeletonLine className="h-4" bar="h-2.5 w-16" />
            <SkeletonLine className="h-7" bar="h-5 w-16" />
            <SkeletonLine className="mt-1 h-4" bar="h-2.5 w-44" />
          </div>
          <Skeleton className="h-9 w-[9.5rem] shrink-0 rounded-lg" />
        </div>
      </header>

      <div data-sk="tabs" className="flex border-b border-line bg-surface">
        {[0, 1].map((index) => (
          <div
            key={index}
            className={cn(
              "flex items-center gap-2 border-b-2 px-5 py-3",
              index === 0 ? "border-accent" : "border-transparent",
            )}
          >
            <Skeleton className="size-4 rounded" />
            <SkeletonLine
              className="h-5"
              bar={cn("h-3", index ? "w-20" : "w-16")}
            />
            <Skeleton className="h-[19px] w-5 rounded-full" />
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        <TableCardSkeleton toolbar="search" columns={5} rowHeight={65} />
      </div>
    </div>
  );
}

/** Table-oriented destinations (audit, broadcasts) - header + ServerDataTable. */
function DataPageSkeleton({
  className,
  variant,
}: {
  className?: string;
  variant: "audit" | "broadcasts";
}) {
  const isAudit = variant === "audit";
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-page",
        className,
      )}
    >
      <PageHeaderSkeleton
        tall={!isAudit}
        action={isAudit ? undefined : "w-[8.8rem] max-sm:w-[4.7rem]"}
        titleWidth={isAudit ? "w-24" : "w-28"}
      />
      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <TableCardSkeleton
          density="compact"
          toolbar={isAudit ? "leading-actions" : "leading"}
          columns={6}
          rowHeight={isAudit ? 61 : 55}
          tableClassName="min-w-[68rem]"
          className="min-h-0"
        />
      </div>
    </div>
  );
}

/** Notifications - header, the filter toolbar and day-grouped rows. */
function NotificationsPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "@container flex h-full min-h-0 w-full flex-col overflow-hidden bg-page",
        className,
      )}
    >
      <header
        data-sk="page-header"
        className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6"
      >
        <div className="flex w-full items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <SkeletonLine className="h-[18px]" bar="h-3.5 w-28" />
            <SkeletonLine className="mt-1 h-4" bar="h-2.5 w-56 max-w-[50vw]" />
          </div>
          <Skeleton className="size-9 shrink-0 rounded-lg" />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex h-full min-h-0 w-full gap-4">
          <section
            data-sk="card"
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
          >
            <div
              data-sk="toolbar"
              className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4"
            >
              <Skeleton className="h-[38px] w-[7.1rem] rounded-lg" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="h-[30px] border-b border-line bg-subtle/95 px-4 py-2 sm:px-5">
                <Skeleton className="h-2.5 w-14" />
              </div>
              <NotificationListSkeleton rows={8} />
            </div>
          </section>
          <aside className="@5xl:flex hidden w-72 shrink-0 flex-col gap-4">
            <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <SkeletonLine className="h-4" bar="h-2.5 w-24" />
              <SkeletonLine className="mt-2 h-9" bar="h-7 w-8" />
              <SkeletonLine className="mt-1 h-4" bar="h-2.5 w-full" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * Default page skeleton - simple centered loading
 */
function DefaultPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "min-h-dvh flex items-center justify-center bg-canvas",
        className,
      )}
    >
      <div className="text-center">
        <Skeleton className="w-16 h-16 rounded-full mx-auto mb-4" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
    </div>
  );
}
