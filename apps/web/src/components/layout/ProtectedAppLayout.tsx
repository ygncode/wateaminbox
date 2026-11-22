import {
  Bell,
  CreditCard,
  FileClock,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "../../contexts/auth-context";
import { useWorkspace } from "../../contexts/workspace-context";
import { useInboxUnreadTotal } from "../../hooks/useInbox";
import { getWorkspaceBillingUrl } from "../../lib/billing-url";
import { cn } from "../../lib/utils";
import { workspacePath } from "../../lib/workspace-routes";
import { ThemeToggle } from "../chat/ThemeToggle";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { WorkspaceSwitcher } from "../workspace/WorkspaceSwitcher";
import {
  APP_SIDEBAR_COLLAPSED_KEY,
  getInitialAppSidebarCollapsed,
} from "./app-shell-preferences";
import { resolveAppShellChrome } from "./conversation-chrome";
import {
  formatInboxUnreadCount,
  getInboxNavigationLabel,
} from "./inbox-unread";
import { MobileBottomNav } from "./MobileBottomNav";
import {
  buildMobileNavLinks,
  resolveActiveMobileNavKey,
} from "./mobile-navigation";

const SyncingOverlay = lazy(() =>
  import("../chat/SyncingOverlay").then((module) => ({
    default: module.SyncingOverlay,
  })),
);

interface NavigationItem {
  /** i18n key; `label` is the English fallback and the stable identifier. */
  labelKey: string;
  label: string;
  path: string;
  icon: typeof Inbox;
  visible: boolean;
  unreadCount?: number;
  external?: boolean;
}

function NavigationLink({
  item,
  collapsed = false,
}: {
  item: NavigationItem;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();

  const Icon = item.icon;
  const unreadCount = item.unreadCount ?? 0;
  const baseClass = cn(
    "group relative flex items-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    collapsed
      ? "h-11 w-full justify-center px-0 text-sm"
      : "h-10 gap-3 px-3 text-sm",
  );
  const inactiveClass =
    "text-nav-fg-muted hover:bg-nav-hover hover:text-nav-fg";
  const content = (
    <>
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className={collapsed ? "sr-only" : undefined}>
        {t(item.labelKey, item.label)}
      </span>
      {unreadCount > 0 && (
        <span
          className={cn(
            "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-nav-badge px-1 text-[10px] font-bold leading-none text-on-nav-badge tabular-nums",
            collapsed ? "absolute end-1.5 top-1" : "ms-auto",
          )}
          aria-hidden="true"
          data-testid="inbox-unread-badge"
        >
          {formatInboxUnreadCount(unreadCount)}
        </span>
      )}
    </>
  );
  const accessibleLabel = getInboxNavigationLabel(
    t(item.labelKey, item.label),
    unreadCount,
    t,
  );
  const title = collapsed ? accessibleLabel : undefined;

  if (item.external) {
    return (
      <a
        href={item.path}
        aria-label={accessibleLabel}
        title={title}
        className={cn(baseClass, inactiveClass)}
      >
        {content}
      </a>
    );
  }

  return (
    <NavLink
      to={item.path}
      aria-label={accessibleLabel}
      title={title}
      className={({ isActive }) =>
        cn(
          baseClass,
          isActive ? "bg-nav-active text-nav-active-fg" : inactiveClass,
        )
      }
    >
      {content}
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
  const { t } = useTranslation();

  const Icon = item.icon;
  const content = (
    <>
      <Icon className="h-5 w-5" />
      {t(item.labelKey, item.label)}
    </>
  );
  const baseClass =
    "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium";

  if (item.external) {
    return (
      <a
        href={item.path}
        onClick={onClick}
        className={cn(baseClass, "hover:bg-muted")}
      >
        {content}
      </a>
    );
  }

  return (
    <NavLink
      to={item.path}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          baseClass,
          isActive ? "bg-accent-soft text-accent" : "hover:bg-muted",
        )
      }
    >
      {content}
    </NavLink>
  );
}

function ButtonSignOut({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft"
    >
      <LogOut className="h-4 w-4" />
      {t("nav.signOut", "Sign out")}
    </button>
  );
}

/** Workspace-aware shell shared by every protected destination. */
export function ProtectedAppLayout() {
  const { t } = useTranslation();

  const { pathname, search } = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    getInitialAppSidebarCollapsed,
  );
  const { user, logout } = useAuth();
  const { activeWorkspace, can, canAny, isSwitching, switchingTo } =
    useWorkspace();
  // Counted by the server across every channel and every page, not summed
  // from the first page of WhatsApp chats as before.
  const inboxUnreadCount = useInboxUnreadTotal();

  if (!activeWorkspace) return null;

  const billingUrl = getWorkspaceBillingUrl(activeWorkspace.id);
  const items: NavigationItem[] = [
    {
      labelKey: "nav.inbox",
      label: "Inbox",
      path: workspacePath(activeWorkspace.id, "chat"),
      icon: Inbox,
      visible: true,
      unreadCount: inboxUnreadCount,
    },
    {
      labelKey: "nav.dashboard",
      label: "Dashboard",
      path: workspacePath(activeWorkspace.id, "dashboard"),
      icon: LayoutDashboard,
      visible: can("can_view_dashboard"),
    },
    {
      labelKey: "nav.broadcasts",
      label: "Broadcasts",
      path: workspacePath(activeWorkspace.id, "broadcasts"),
      icon: Megaphone,
      visible: can("can_send_bulk_messages"),
    },
    {
      labelKey: "nav.team",
      label: "Team",
      path: workspacePath(activeWorkspace.id, "team"),
      icon: Users,
      visible: canAny(["can_manage_team", "can_invite"]),
    },
    {
      labelKey: "nav.audit",
      label: "Audit",
      path: workspacePath(activeWorkspace.id, "audit"),
      icon: FileClock,
      visible: can("can_view_audit"),
    },
    {
      labelKey: "nav.billing",
      label: "Plan & billing",
      path: billingUrl ?? "#",
      icon: CreditCard,
      visible: activeWorkspace.role === "owner" && billingUrl !== null,
      external: true,
    },
  ];
  const visibleItems = items.filter((item) => item.visible);
  const settingsItem: NavigationItem = {
    labelKey: "nav.settings",
    label: "Settings",
    path: workspacePath(activeWorkspace.id, "settings"),
    icon: Settings,
    visible: true,
  };
  const notificationsItem: NavigationItem = {
    labelKey: "nav.notifications",
    label: "Notifications",
    path: workspacePath(activeWorkspace.id, "notifications"),
    icon: Bell,
    visible: true,
  };
  // The floating bar carries Chat/Groups/Dashboard/Broadcast; everything else
  // a member is allowed to open has to stay reachable from the profile sheet,
  // or those destinations become desktop-only.
  const profileSheetItems = [
    ...visibleItems.filter(
      (item) =>
        item.label !== "Inbox" &&
        item.label !== "Dashboard" &&
        item.label !== "Broadcasts",
    ),
    settingsItem,
    notificationsItem,
  ];
  const mobileNavLinks = buildMobileNavLinks(activeWorkspace.id, {
    canViewDashboard: can("can_view_dashboard"),
    canSendBroadcasts: can("can_send_bulk_messages"),
  });
  const activeMobileNavKey = resolveActiveMobileNavKey(pathname, search);
  // An open conversation owns the whole phone screen: the floating bar and
  // the height it reserves both step aside there. See conversation-chrome.ts.
  const shellChrome = resolveAppShellChrome(pathname);
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(APP_SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas text-fg">
      <a href="#main-content" className="skip-link">
        {t("nav.skipToMain", "Skip to main content")}
      </a>
      <aside
        data-sk="rail"
        className={cn(
          "relative hidden h-full shrink-0 flex-col bg-nav py-3 transition-[width,padding] duration-200 ease-out lg:flex",
          sidebarCollapsed ? "w-[72px] px-2" : "w-[226px] px-3",
        )}
      >
        <WorkspaceSwitcher collapsed={sidebarCollapsed} />
        <nav
          data-sk="rail-nav"
          className="mt-5 space-y-1"
          aria-label={t("nav.primary", "Primary navigation")}
        >
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
              "mb-2 flex h-10 w-full items-center rounded-xl text-sm font-medium text-nav-fg-subtle transition-colors hover:bg-nav-hover hover:text-nav-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-fg/40",
              sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
            aria-label={
              sidebarCollapsed
                ? t("nav.expandSidebar", "Expand sidebar")
                : t("nav.collapseSidebar", "Collapse sidebar")
            }
            title={
              sidebarCollapsed
                ? t("nav.expandSidebar", "Expand sidebar")
                : undefined
            }
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
            <span className={sidebarCollapsed ? "sr-only" : undefined}>
              {sidebarCollapsed
                ? t("nav.expandSidebar", "Expand sidebar")
                : t("nav.collapseSidebar", "Collapse sidebar")}
            </span>
          </button>
          <div className="space-y-1 border-t border-nav-line pt-3">
            <NavigationLink item={settingsItem} collapsed={sidebarCollapsed} />
            <div
              className={cn(
                "flex items-center gap-1 pt-1",
                sidebarCollapsed ? "flex-col px-0" : "px-1",
              )}
            >
              <NotificationCenter className="rounded-xl text-nav-fg-muted hover:bg-nav-hover hover:text-nav-fg" />
              <ThemeToggle className="rounded-xl text-nav-fg-muted hover:bg-nav-hover hover:text-nav-fg" />
            </div>
            {sidebarCollapsed ? (
              <div className="mt-2 flex flex-col items-center gap-1.5">
                <Avatar
                  className="h-10 w-10 rounded-xl border border-nav-line bg-nav-hover"
                  title={t("nav.signedInAs", {
                    name: user?.name || user?.email,
                  })}
                >
                  <AvatarImage
                    src={user?.avatarUrl}
                    alt=""
                    className="object-cover"
                  />
                  <AvatarFallback className="rounded-xl bg-nav-active text-sm font-semibold text-nav-fg">
                    {(user?.name || user?.email || "U")
                      .slice(0, 1)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="grid h-10 w-10 place-items-center rounded-xl text-nav-fg-muted transition-colors hover:bg-nav-hover hover:text-nav-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-fg/40"
                  aria-label={t("nav.signOut", "Sign out")}
                  title={t("nav.signOut", "Sign out")}
                >
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </div>
            ) : (
              <div
                data-sk="rail-user"
                className="mt-2 overflow-hidden rounded-xl border border-nav-line bg-nav-card"
              >
                <div className="flex items-center gap-3 p-2.5">
                  <Avatar className="h-10 w-10 rounded-xl bg-nav-hover">
                    <AvatarImage
                      src={user?.avatarUrl}
                      alt=""
                      className="object-cover"
                    />
                    <AvatarFallback className="rounded-xl bg-nav-active text-sm font-semibold text-nav-fg">
                      {(user?.name || user?.email || "U")
                        .slice(0, 1)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-5 text-nav-fg">
                      {user?.name || t("nav.account")}
                    </p>
                    <p className="truncate text-[11px] leading-4 text-nav-fg-subtle">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="flex h-9 w-full items-center gap-2 border-t border-nav-line px-3 text-xs font-medium text-nav-fg-muted transition-colors hover:bg-nav-hover hover:text-nav-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-fg/40"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t("nav.signOut", "Sign out")}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div
        data-sk="frame"
        className="app-frame relative flex min-w-0 flex-1 flex-col"
      >
        {/* The notch inset is added on top of the 3.5rem row, not eaten out
            of it: `box-sizing: border-box` is global and the viewport opts
            into `viewport-fit=cover`, so a plain `h-14` would leave roughly
            9px of usable height on a notched phone.

            Withdrawn entirely on a conversation detail route, where the
            conversation's own header takes over the top of the screen and
            inherits the notch inset - see conversation-chrome.ts. */}
        <header
          data-sk="mobile-header"
          className={cn(
            "safe-area-top h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-nav-line bg-nav px-2",
            shellChrome.workspaceHeaderClass,
          )}
        >
          <WorkspaceSwitcher compact />
          <div className="flex items-center text-nav-fg-muted">
            <NotificationCenter className="text-nav-fg-muted hover:bg-nav-hover hover:text-nav-fg" />
            <ThemeToggle className="text-nav-fg-muted hover:bg-nav-hover hover:text-nav-fg" />
          </div>
        </header>
        <main
          id="main-content"
          // The floating bar sits outside the flow, so the shell reserves the
          // space it occupies - otherwise the composer and the last table row
          // would sit underneath it and stay untappable.
          className={cn(
            "relative min-h-0 min-w-0 flex-1 overflow-hidden",
            shellChrome.mainPaddingClass,
          )}
          tabIndex={-1}
        >
          <Outlet />
          {isSwitching && (
            <div
              className="absolute inset-0 z-50 grid place-items-center bg-canvas/95 backdrop-blur-sm"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-col items-center text-center">
                <div className="h-9 w-9 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <p className="mt-4 text-sm font-semibold">
                  {t("nav.switchingTo", { name: switchingTo?.name })}
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  {t("nav.preparingWorkspace", "Preparing a clean workspace")}
                </p>
              </div>
            </div>
          )}
        </main>
        <Suspense fallback={null}>
          <SyncingOverlay />
        </Suspense>
        <MobileBottomNav
          links={mobileNavLinks}
          activeKey={activeMobileNavKey}
          unreadCount={inboxUnreadCount}
          onOpenProfile={() => setProfileOpen(true)}
          visibilityClassName={shellChrome.navClass}
        />
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          {/* The sheet grows with the member's permissions (up to team,
              audit, billing, settings and notifications), which overflows a
              landscape phone - so it caps at the viewport and scrolls. */}
          <DialogContent className="mx-4 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-4 sm:w-full">
            <DialogHeader>
              <DialogTitle>{t("nav.profile", "Profile")}</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
              <Avatar className="h-11 w-11 rounded-xl">
                <AvatarImage
                  src={user?.avatarUrl}
                  alt=""
                  className="object-cover"
                />
                <AvatarFallback className="rounded-xl bg-accent-soft text-sm font-semibold text-accent">
                  {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {user?.name || t("nav.account", "Account")}
                </p>
                <p className="truncate text-xs text-fg-muted">{user?.email}</p>
              </div>
            </div>
            <nav
              className="space-y-1"
              aria-label={t("nav.profileMenu", "Profile navigation")}
            >
              {profileSheetItems.map((item) => (
                <MoreLink
                  key={item.label}
                  item={item}
                  onClick={() => setProfileOpen(false)}
                />
              ))}
            </nav>
            <div className="flex items-center justify-end border-t border-line pt-3">
              <ButtonSignOut onClick={() => void logout()} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
