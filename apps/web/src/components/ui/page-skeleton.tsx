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
import { Skeleton } from "./skeleton";

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
        return <AuthPageSkeleton className={className} />;
      case "team":
        return <TeamPageSkeleton className={className} />;
      case "workspace-chooser":
        return <WorkspaceChooserSkeleton className={className} />;
      case "audit":
      case "broadcasts":
      case "notifications":
        return <DataPageSkeleton className={className} />;
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
    <div className="flex h-dvh w-full overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary">
      <aside
        className={cn(
          "relative hidden h-full shrink-0 flex-col bg-[#102c24] py-3 lg:flex",
          collapsed ? "w-[72px] px-2" : "w-[226px] px-3",
        )}
      >
        <div
          className={cn(
            "flex items-center rounded-xl",
            collapsed
              ? "h-11 justify-center p-1"
              : "gap-3 border border-white/10 bg-white/[0.06] p-2.5",
          )}
        >
          <Skeleton className="size-9 shrink-0 rounded-lg bg-white/10" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-24 bg-white/10" />
              <Skeleton className="mt-1.5 h-2.5 w-12 bg-white/10" />
            </div>
          )}
        </div>

        <div className="mt-5 space-y-1">
          {[20, 24, 22, 12, 14, 20].map((width, index) => (
            <div
              key={index}
              className={cn(
                "flex items-center rounded-xl",
                collapsed ? "h-11 justify-center" : "h-10 gap-3 px-3",
                index === 0 && "bg-white/10",
              )}
            >
              <Skeleton className="size-[18px] shrink-0 rounded bg-white/10" />
              {!collapsed && (
                <Skeleton
                  className="h-3 bg-white/10"
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
            <Skeleton className="size-[18px] shrink-0 rounded bg-white/10" />
            {!collapsed && <Skeleton className="h-3 w-24 bg-white/10" />}
          </div>
          <div className="space-y-1 border-t border-white/10 pt-3">
            <div
              className={cn(
                "flex h-10 items-center",
                collapsed ? "justify-center" : "gap-3 px-3",
              )}
            >
              <Skeleton className="size-[18px] shrink-0 rounded bg-white/10" />
              {!collapsed && <Skeleton className="h-3 w-16 bg-white/10" />}
            </div>
            <div
              className={cn(
                "flex items-center gap-1",
                collapsed ? "flex-col" : "px-1",
              )}
            >
              <Skeleton className="size-8 rounded-lg bg-white/10" />
              <Skeleton className="size-8 rounded-lg bg-white/10" />
            </div>
            {collapsed ? (
              <div className="mt-2 flex flex-col items-center gap-1.5">
                <Skeleton className="size-10 rounded-xl bg-white/10" />
                <Skeleton className="size-10 rounded-xl bg-white/10" />
              </div>
            ) : (
              <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/10">
                <div className="flex items-center gap-3 p-2.5">
                  <Skeleton className="size-10 shrink-0 rounded-xl bg-white/10" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-3 w-24 bg-white/10" />
                    <Skeleton className="mt-1.5 h-2.5 w-28 bg-white/10" />
                  </div>
                </div>
                <div className="flex h-9 items-center gap-2 border-t border-white/10 px-3">
                  <Skeleton className="size-3.5 shrink-0 rounded bg-white/10" />
                  <Skeleton className="h-2.5 w-14 bg-white/10" />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "safe-area-top h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-[#dce3de] bg-[#102c24] px-2",
            shellChrome.workspaceHeaderClass,
          )}
        >
          <div className="flex h-10 min-w-0 items-center gap-2 px-2">
            <Skeleton className="size-9 shrink-0 rounded-lg bg-white/10" />
            <div className="min-w-0">
              <Skeleton className="h-3 w-28 bg-white/10" />
              <Skeleton className="mt-1.5 h-2.5 w-12 bg-white/10" />
            </div>
          </div>
          <div className="flex gap-1">
            <Skeleton className="size-9 rounded-lg bg-white/10" />
            <Skeleton className="size-9 rounded-lg bg-white/10" />
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
          <div className="flex w-full max-w-md items-stretch gap-1 rounded-[1.75rem] border border-[#d7e0da] bg-white p-1.5 shadow-[0_10px_30px_-8px_rgba(16,44,36,0.25)] dark:border-white/10 dark:bg-dark-secondary">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className={cn(
                  "flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl",
                  index === 0 && "bg-[#dcefe7] dark:bg-dark-tertiary",
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
 * Chat page skeleton - chat list pane + conversation area
 *
 * Mirrors the inbox in the order it actually stacks: the Chats/Groups tabs,
 * the contact search, the lifecycle filter row, the assignment filter row,
 * then the rows themselves. Every band here lands where its real counterpart
 * lands, so the swap to live data changes content and not layout.
 */
function ChatPageSkeleton({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const isConversation = isConversationDetailPath(pathname);
  const sidebarWidth = getInitialSidebarWidth();

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 overflow-hidden bg-gray-50 dark:bg-dark-primary",
        className,
      )}
    >
      <div
        className={cn(
          "h-full w-full flex-col border-r border-gray-200 bg-white dark:border-dark-border dark:bg-dark-secondary md:flex md:w-[320px] lg:w-[var(--chat-skeleton-width)]",
          isConversation ? "hidden" : "flex",
        )}
        style={
          {
            "--chat-skeleton-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <div className="flex h-14 shrink-0 items-stretch border-b border-gray-200 bg-gray-100 dark:border-dark-border dark:bg-dark-secondary md:h-[60px]">
          {[0, 1].map((index) => (
            <div
              key={index}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 border-b-2",
                index === 0 ? "border-[#0b7a55]" : "border-transparent",
              )}
            >
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className={cn("h-3", index === 0 ? "w-10" : "w-14")} />
            </div>
          ))}
        </div>

        <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-2 dark:border-dark-border dark:bg-dark-secondary">
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>

        {[
          [26, 34, 44, 52],
          [26, 44, 70, 62],
        ].map((widths, row) => (
          <div
            key={row}
            className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-dark-border dark:bg-dark-secondary"
          >
            {widths.map((width, index) => (
              <Skeleton
                key={index}
                className={cn(
                  "h-6 rounded-full",
                  index === 0 && "bg-[#0b7a55]/25 dark:bg-[#0b7a55]/40",
                  index === widths.length - 1 && "ml-auto",
                )}
                style={{ width: `${width}px` }}
              />
            ))}
          </div>
        ))}

        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 9 }).map((_, index) => (
            <div
              key={index}
              className="flex min-h-[72px] items-center gap-3 border-b border-gray-100 px-3 py-3 dark:border-dark-border"
            >
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Skeleton
                    className={cn("h-4", index % 2 === 0 ? "w-36" : "w-28")}
                  />
                  <Skeleton className="h-3 w-9 shrink-0" />
                </div>
                <Skeleton
                  className={cn("h-3", index % 3 === 0 ? "w-40" : "w-52")}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {isConversation ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 bg-gray-100 px-4 dark:border-dark-border dark:bg-dark-secondary">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-36 max-w-[42%]" />
              <Skeleton className="h-2.5 w-24 max-w-[30%]" />
            </div>
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[#e5ddd5] dark:bg-dark-primary">
            <div className="absolute inset-0 opacity-[0.045] [background-image:radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:28px_28px] dark:opacity-[0.09]" />
            <div className="relative mx-auto flex h-full w-full max-w-4xl flex-col justify-end gap-3 px-5 py-8 sm:px-10">
              <div className="flex justify-center pb-2">
                <Skeleton className="h-5 w-20 rounded-full bg-black/10 dark:bg-white/10" />
              </div>
              <Skeleton className="h-12 w-[58%] max-w-md rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
              <Skeleton className="h-16 w-[46%] max-w-sm rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
              <div className="flex justify-end">
                <Skeleton className="h-12 w-[52%] max-w-md rounded-2xl rounded-br-sm bg-[#d9fdd3]/80 dark:bg-[#005c4b]/70" />
              </div>
              <Skeleton className="h-10 w-[36%] max-w-xs rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
              <div className="flex justify-end">
                <Skeleton className="h-16 w-[44%] max-w-sm rounded-2xl rounded-br-sm bg-[#d9fdd3]/80 dark:bg-[#005c4b]/70" />
              </div>
            </div>
          </div>
          <div className="flex min-h-[64px] shrink-0 items-center gap-3 border-t border-gray-200 bg-gray-100 px-3 py-2.5 dark:border-dark-border dark:bg-dark-secondary">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <Skeleton className="h-10 flex-1 rounded-[1.35rem] bg-white dark:bg-dark-tertiary" />
            <Skeleton className="size-10 shrink-0 rounded-full bg-[#0b6b5d]/30 dark:bg-[#00a884]/30" />
          </div>
        </div>
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center bg-[#f6f8f9] dark:bg-[#0b141a] md:flex">
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
 * Settings page skeleton - navigation + content area
 */
function SettingsPageSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full bg-[#f5f7f4] dark:bg-dark-primary",
        className,
      )}
      role="status"
      aria-label={t("layout.loadingSettings", "Loading workspace settings")}
    >
      <aside className="hidden w-64 shrink-0 overflow-hidden border-r border-[#dce3de] bg-[#edf1ed] px-4 py-6 dark:border-dark-border dark:bg-dark-secondary md:block">
        <Skeleton className="mx-2 h-3 w-16" />
        <Skeleton className="mx-2 mt-3 h-6 w-36" />

        <div className="mt-8 space-y-6">
          {[2, 3, 2].map((itemCount, groupIndex) => (
            <div key={groupIndex}>
              <Skeleton className="mx-2 mb-2 h-2.5 w-20" />
              <div className="space-y-1">
                {Array.from({ length: itemCount }).map((_, itemIndex) => (
                  <div
                    key={itemIndex}
                    className={cn(
                      "flex h-9 items-center gap-3 rounded-lg px-2.5",
                      groupIndex === 0 &&
                        itemIndex === 0 &&
                        "bg-white shadow-sm dark:bg-white/[0.06] dark:shadow-none",
                    )}
                  >
                    <Skeleton className="h-4 w-4 shrink-0 rounded" />
                    <Skeleton
                      className={cn(
                        "h-3",
                        itemIndex % 2 === 0 ? "w-24" : "w-28",
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
          <div className="mb-6 md:hidden">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-11 w-full rounded-xl" />
          </div>

          <header className="mb-7 border-b border-[#dce3de] pb-5 dark:border-dark-border">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-44" />
          </header>

          <div className="space-y-5">
            <section className="min-h-[720px] rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:min-h-0 sm:p-6">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-3 h-3 w-full max-w-md" />
              <Skeleton className="mt-2 h-3 w-4/5 max-w-sm" />

              <div className="mt-6 space-y-6">
                <div className="flex flex-col gap-4 rounded-2xl border border-[#dce3de] bg-[#f8faf8] p-4 dark:border-dark-border dark:bg-dark-tertiary/35 sm:flex-row sm:items-center">
                  <Skeleton className="size-20 shrink-0 rounded-2xl" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="mt-2 h-3 w-full max-w-xs" />
                    <Skeleton className="mt-2 h-3 w-4/5 max-w-64" />
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Skeleton className="h-9 w-24 rounded-lg" />
                    <Skeleton className="h-9 w-20 rounded-lg" />
                  </div>
                </div>

                <div>
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="mt-2 h-9 w-full rounded-lg" />
                </div>
                <div>
                  <div className="flex justify-between">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <Skeleton className="mt-2 h-20 w-full rounded-xl" />
                </div>
                <div className="flex justify-end border-t border-[#e6ebe7] pt-5 dark:border-dark-border">
                  <Skeleton className="h-9 w-32 rounded-lg" />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#dce3de] bg-white p-5 dark:border-dark-border dark:bg-dark-elevated sm:p-6">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-3 w-full max-w-sm" />
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index}>
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="mt-2 h-5 w-24" />
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
 * Dashboard page skeleton - stats cards + charts
 */
function DashboardPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary",
        className,
      )}
    >
      <header className="min-h-[111px] shrink-0 border-b border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:min-h-[63px] sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1.5 h-3 w-56 max-w-[60vw]" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden gap-1 rounded-lg border border-[#d7e0da] p-0.5 sm:flex dark:border-dark-border">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-7 w-14 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-9 flex-1 rounded-lg sm:hidden" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="h-full overflow-hidden rounded-xl border border-[#dce3de] bg-[#f9fbf9] shadow-sm dark:border-dark-border dark:bg-dark-secondary">
          <div className="space-y-6 p-4 sm:p-5 lg:p-6">
            <section className="min-h-[501px] xl:min-h-[187px]">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="mt-1.5 h-3 w-64 max-w-[65vw]" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-[#dce3de] bg-white p-4 dark:border-dark-border dark:bg-dark-elevated"
                  >
                    <Skeleton className="size-9 rounded-xl" />
                    <Skeleton className="mt-3 h-3 w-20 max-w-full" />
                    <Skeleton className="mt-2 h-8 w-16" />
                  </div>
                ))}
              </div>
            </section>

            <div className="flex min-h-[72px] items-end justify-between gap-2 pt-1 sm:min-h-0">
              <div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-1.5 h-3 w-56 max-w-[60vw]" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              {[8, 4, 12].map((span, index) => (
                <section
                  key={index}
                  className={cn(
                    "rounded-xl border border-[#dce3de] bg-white p-4 dark:border-dark-border dark:bg-dark-elevated sm:p-5",
                    span === 8
                      ? "min-h-[372px] xl:col-span-8 xl:min-h-[391px]"
                      : span === 4
                        ? "min-h-[383px] xl:col-span-4 xl:min-h-[391px]"
                        : "min-h-[372px] xl:col-span-12 xl:min-h-[380px]",
                  )}
                >
                  <div className="mb-5 flex items-center gap-3">
                    <Skeleton className="size-9 shrink-0 rounded-xl" />
                    <div>
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="mt-1.5 h-3 w-44 max-w-[55vw]" />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-24" />
                  </div>
                  <Skeleton className="mt-4 h-[220px] w-full rounded-xl" />
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
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
        "relative min-h-dvh overflow-hidden bg-[#f5f7f4] px-5 py-10 text-[#10211b] dark:bg-dark-primary dark:text-dark-text-primary",
        className,
      )}
      role="status"
      aria-label={t("auth.loadingWorkspaces", "Loading your workspaces…")}
    >
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#dcefe7] blur-3xl dark:bg-emerald-500/10"
        aria-hidden="true"
      />
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

        <Skeleton className="h-3 w-36 rounded-full bg-[#0b7a55]/20 dark:bg-emerald-400/15" />
        <Skeleton className="mt-5 h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="mt-4 h-5 w-full max-w-lg rounded-md" />

        <div className="mt-9 grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-2xl border border-[#dce3de] bg-white p-4 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated"
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
 * Auth page skeleton - centered form card
 */
function AuthPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary",
        className,
      )}
    >
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
          {/* Logo + title */}
          <div className="text-center mb-8">
            <Skeleton className="w-16 h-16 rounded-full mx-auto mb-4" />
            <Skeleton className="h-7 w-40 mx-auto mb-2" />
            <Skeleton className="h-4 w-48 mx-auto" />
          </div>
          {/* Form fields */}
          <div className="space-y-4">
            <div>
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full mt-6" />
          </div>
          {/* Footer link */}
          <div className="mt-6 text-center">
            <Skeleton className="h-4 w-48 mx-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Team page skeleton - header + member list
 */
function TeamPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary",
        className,
      )}
    >
      {/* Workspace heading and primary action */}
      <header className="shrink-0 border-b border-[#dce3de] bg-white px-4 py-4 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-auto">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1.5 h-6 w-14" />
            <Skeleton className="mt-2 h-3 w-44" />
          </div>
          <Skeleton className="h-10 w-36 rounded-md" />
        </div>
      </header>

      {/* Members and invitations tabs */}
      <div className="flex shrink-0 border-b border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-secondary">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "flex items-center gap-2 border-b-2 px-5 py-3",
              index === 0 ? "border-[#0b7a55]" : "border-transparent",
            )}
          >
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className={cn("h-4", index === 0 ? "w-16" : "w-20")} />
            <Skeleton className="h-4 w-6 rounded-full" />
          </div>
        ))}
      </div>

      {/* Searchable, paginated members table */}
      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        <section className="flex h-full min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-[#d7e0da] bg-white shadow-[0_12px_34px_rgba(16,33,27,0.07)] dark:border-dark-border dark:bg-dark-elevated dark:shadow-none">
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-[#e3e9e5] bg-[#fbfcfb] p-3 sm:flex-row sm:items-center dark:border-dark-border dark:bg-dark-secondary/40">
            <Skeleton className="h-9 w-full sm:max-w-md" />
            <Skeleton className="h-9 w-28 self-end rounded-lg sm:ml-auto sm:self-auto" />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="min-w-[48rem]">
              <div className="grid grid-cols-[minmax(20rem,1fr)_8rem_10rem_9rem_3.5rem] border-b border-[#d7e0da] bg-[#edf1ed]/95 px-4 py-3 dark:border-dark-border dark:bg-dark-tertiary/95">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-2.5 w-9" />
                <Skeleton className="h-2.5 w-12" />
                <Skeleton className="h-2.5 w-11" />
                <span />
              </div>

              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(20rem,1fr)_8rem_10rem_9rem_3.5rem] items-center border-b border-[#edf1ed] px-4 py-3.5 dark:border-dark-border"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                    <div>
                      <Skeleton
                        className={cn("h-4", index % 2 === 0 ? "w-32" : "w-40")}
                      />
                      <Skeleton className="mt-1.5 h-3 w-44" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-7 rounded-md" />
                </div>
              ))}
            </div>
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-[#d7e0da] bg-[#fbfcfb] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-dark-border dark:bg-dark-secondary/40">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

/** Table-oriented destinations (audit, broadcasts, and notifications). */
function DataPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary",
        className,
      )}
    >
      <header className="shrink-0 border-b border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
        <div className="flex min-h-9 items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-3 w-64 max-w-[60vw]" />
          </div>
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#dce3de] bg-white shadow-sm dark:border-dark-border dark:bg-dark-secondary">
          <div className="flex shrink-0 items-center gap-2 border-b border-[#e6ebe7] p-3 dark:border-dark-border sm:px-4">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="ml-auto h-8 w-32 rounded-lg" />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="grid grid-cols-[minmax(16rem,1fr)_10rem_9rem_7rem] gap-4 border-b border-[#d7e0da] bg-[#edf1ed]/95 px-4 py-3 dark:border-dark-border dark:bg-dark-tertiary/95">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-2.5 w-16" />
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="flex min-h-[64px] items-center gap-3 border-b border-[#edf1ed] px-4 py-3 dark:border-dark-border"
              >
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skeleton
                    className={cn("h-4", index % 2 ? "w-36" : "w-44")}
                  />
                  <Skeleton className="mt-2 h-3 w-3/5 max-w-sm" />
                </div>
                <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
                <Skeleton className="hidden h-3 w-20 md:block" />
              </div>
            ))}
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#d7e0da] bg-[#fbfcfb] px-3 py-2.5 dark:border-dark-border dark:bg-dark-secondary/40">
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="size-8 rounded-md" />
            </div>
          </footer>
        </section>
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
        "min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary",
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
