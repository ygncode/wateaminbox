import {
  Bell,
  FileClock,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/auth-context";
import { useWorkspace } from "../../contexts/workspace-context";
import { cn } from "../../lib/utils";
import { workspacePath } from "../../lib/workspace-routes";
import { ThemeToggle } from "../chat/ThemeToggle";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { WorkspaceSwitcher } from "../workspace/WorkspaceSwitcher";

const SyncingOverlay = lazy(() =>
  import("../chat/SyncingOverlay").then((module) => ({
    default: module.SyncingOverlay,
  })),
);

interface NavigationItem {
  label: string;
  path: string;
  icon: typeof Inbox;
  visible: boolean;
}

function NavigationLink({
  item,
  compact = false,
  collapsed = false,
}: {
  item: NavigationItem;
  compact?: boolean;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
          compact
            ? "h-12 min-w-14 flex-1 flex-col justify-center gap-0.5 px-1 text-[10px]"
            : collapsed
              ? "h-11 w-full justify-center px-0 text-sm"
              : "h-10 gap-3 px-3 text-sm",
          isActive
            ? "bg-[#dcefe7] text-[#075c41]"
            : compact
              ? "text-[#65736d] dark:text-dark-text-secondary"
              : "text-[#b8c9c2] hover:bg-white/[0.07] hover:text-white",
        )
      }
    >
      <Icon className={compact ? "h-5 w-5" : "h-[18px] w-[18px]"} />
      <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
    </NavLink>
  );
}

function MoreLink({
  item,
  onClick,
}: {
  item: NavigationItem;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium",
          isActive
            ? "bg-[#dcefe7] text-[#075c41]"
            : "hover:bg-[#edf1ed] dark:hover:bg-dark-tertiary",
        )
      }
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </NavLink>
  );
}

function ButtonSignOut({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </button>
  );
}

const SIDEBAR_COLLAPSED_KEY = "wateaminbox:sidebar-collapsed";

/** Workspace-aware shell shared by every protected destination. */
export function ProtectedAppLayout() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const { user, logout } = useAuth();
  const { activeWorkspace, can, canAny, isSwitching, switchingTo } =
    useWorkspace();

  if (!activeWorkspace) return null;

  const items: NavigationItem[] = [
    {
      label: "Inbox",
      path: workspacePath(activeWorkspace.id, "chat"),
      icon: Inbox,
      visible: true,
    },
    {
      label: "Dashboard",
      path: workspacePath(activeWorkspace.id, "dashboard"),
      icon: LayoutDashboard,
      visible: can("can_view_dashboard"),
    },
    {
      label: "Team",
      path: workspacePath(activeWorkspace.id, "team"),
      icon: Users,
      visible: canAny(["can_manage_team", "can_invite"]),
    },
    {
      label: "Audit",
      path: workspacePath(activeWorkspace.id, "audit"),
      icon: FileClock,
      visible: can("can_view_audit"),
    },
  ];
  const visibleItems = items.filter((item) => item.visible);
  const settingsItem: NavigationItem = {
    label: "Settings",
    path: workspacePath(activeWorkspace.id, "settings"),
    icon: Settings,
    visible: true,
  };
  const mobileItems = visibleItems
    .filter((item) => item.label !== "Audit")
    .slice(0, 3);
  const auditItem = visibleItems.find((item) => item.label === "Audit");
  const moreIsActive = /\/(settings|audit|notifications)(?:\/|$)/.test(
    pathname,
  );
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#f5f7f4] text-[#10211b] dark:bg-dark-primary dark:text-dark-text-primary">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside
        className={cn(
          "relative hidden h-full shrink-0 flex-col bg-[#102c24] py-3 transition-[width,padding] duration-200 ease-out lg:flex",
          sidebarCollapsed ? "w-[72px] px-2" : "w-[226px] px-3",
        )}
      >
        <WorkspaceSwitcher collapsed={sidebarCollapsed} />
        <nav className="mt-5 space-y-1" aria-label="Primary navigation">
          {visibleItems.map((item) => (
            <NavigationLink
              key={item.label}
              item={item}
              collapsed={sidebarCollapsed}
            />
          ))}
        </nav>
        <div className="mt-auto">
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "mb-2 flex h-10 w-full items-center rounded-xl text-sm font-medium text-[#91a8a0] transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
              sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : undefined}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
            <span className={sidebarCollapsed ? "sr-only" : undefined}>
              {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            </span>
          </button>
          <div className="space-y-1 border-t border-white/10 pt-3">
            <NavigationLink item={settingsItem} collapsed={sidebarCollapsed} />
            <div
              className={cn(
                "flex items-center gap-1 pt-1",
                sidebarCollapsed ? "flex-col px-0" : "px-1",
              )}
            >
              <NotificationCenter className="rounded-xl text-[#b8c9c2] hover:bg-white/10 hover:text-white dark:hover:bg-white/10" />
              <ThemeToggle className="rounded-xl text-[#b8c9c2] hover:bg-white/10 hover:text-white dark:hover:bg-white/10" />
            </div>
            {sidebarCollapsed ? (
              <div className="mt-2 flex flex-col items-center gap-1.5">
                <div
                  className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/10 text-sm font-semibold text-white"
                  title={`Signed in as ${user?.name || user?.email}`}
                >
                  {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="grid h-10 w-10 place-items-center rounded-xl text-[#91a8a0] transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </div>
            ) : (
              <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/10">
                <div className="flex items-center gap-3 p-2.5">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-sm font-semibold text-white">
                    {(user?.name || user?.email || "U")
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-5 text-white">
                      {user?.name || "Account"}
                    </p>
                    <p className="truncate text-[11px] leading-4 text-[#91a8a0]">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="flex h-9 w-full items-center gap-2 border-t border-white/10 px-3 text-xs font-medium text-[#a7bbb3] transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-300"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-area-top flex h-14 shrink-0 items-center justify-between border-b border-[#dce3de] bg-[#102c24] px-2 lg:hidden">
          <WorkspaceSwitcher compact />
          <div className="flex items-center text-[#b8c9c2]">
            <NotificationCenter className="text-[#b8c9c2] hover:bg-white/10 hover:text-white dark:hover:bg-white/10" />
            <ThemeToggle className="text-[#b8c9c2] hover:bg-white/10 hover:text-white dark:hover:bg-white/10" />
          </div>
        </header>
        <main
          id="main-content"
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          tabIndex={-1}
        >
          <Outlet />
          {isSwitching && (
            <div
              className="absolute inset-0 z-50 grid place-items-center bg-[#f5f7f4]/95 backdrop-blur-sm dark:bg-dark-primary/95"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-col items-center text-center">
                <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#0b7a55] border-t-transparent" />
                <p className="mt-4 text-sm font-semibold">
                  Switching to {switchingTo?.name}…
                </p>
                <p className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
                  Preparing a clean workspace
                </p>
              </div>
            </div>
          )}
        </main>
        <Suspense fallback={null}>
          <SyncingOverlay />
        </Suspense>
        <nav
          className="safe-area-bottom flex shrink-0 items-center border-t border-[#dce3de] bg-white px-1 py-1 dark:border-dark-border dark:bg-dark-secondary lg:hidden"
          aria-label="Mobile navigation"
        >
          {mobileItems.map((item) => (
            <NavigationLink key={item.label} item={item} compact />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-medium",
              moreIsActive
                ? "bg-[#dcefe7] text-[#075c41]"
                : "text-[#65736d] dark:text-dark-text-secondary",
            )}
            aria-label="More navigation"
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        </nav>
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogContent className="mx-4 w-[calc(100vw-2rem)] rounded-2xl p-4 sm:w-full">
            <DialogHeader>
              <DialogTitle>More</DialogTitle>
            </DialogHeader>
            <nav className="space-y-1" aria-label="More navigation">
              {auditItem && (
                <MoreLink item={auditItem} onClick={() => setMoreOpen(false)} />
              )}
              <MoreLink
                item={settingsItem}
                onClick={() => setMoreOpen(false)}
              />
              <MoreLink
                item={{
                  label: "Notifications",
                  path: workspacePath(activeWorkspace.id, "notifications"),
                  icon: Bell,
                  visible: true,
                }}
                onClick={() => setMoreOpen(false)}
              />
            </nav>
            <div className="mt-2 flex items-center justify-between border-t border-[#dce3de] pt-3 dark:border-dark-border">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user?.name}</p>
                <p className="truncate text-xs text-[#65736d] dark:text-dark-text-secondary">
                  {user?.email}
                </p>
              </div>
              <ButtonSignOut onClick={() => void logout()} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
