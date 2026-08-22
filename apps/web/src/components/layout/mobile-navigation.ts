import {
  chatViewPath,
  getWorkspaceDestination,
  parseChatView,
  workspacePath,
} from "@/lib/workspace-routes";

/**
 * Bottom navigation for phones and tablets. Desktop keeps the full sidebar
 * rail, so this list is deliberately short: the four destinations people move
 * between while triaging, plus an account sheet that carries everything else.
 *
 * Kept free of React so the destination/active-state rules stay unit-testable.
 */
export type MobileNavKey =
  | "chat"
  | "groups"
  | "dashboard"
  | "broadcasts"
  | "profile";

export type MobileNavLinkKey = Exclude<MobileNavKey, "profile">;

export interface MobileNavLink {
  key: MobileNavLinkKey;
  /** i18n key; `label` is the English fallback and the stable identifier. */
  labelKey: string;
  label: string;
  path: string;
}

export interface MobileNavPermissions {
  canViewDashboard: boolean;
  canSendBroadcasts: boolean;
}

/**
 * Only permitted destinations are rendered - a link the route guard would
 * bounce is worse than a shorter bar.
 */
export function buildMobileNavLinks(
  workspaceId: string,
  permissions: MobileNavPermissions,
): MobileNavLink[] {
  const links: MobileNavLink[] = [
    {
      key: "chat",
      labelKey: "nav.chat",
      label: "Chat",
      path: chatViewPath(workspaceId, "chats"),
    },
    {
      key: "groups",
      labelKey: "nav.groups",
      label: "Groups",
      path: chatViewPath(workspaceId, "groups"),
    },
  ];

  if (permissions.canViewDashboard) {
    links.push({
      key: "dashboard",
      labelKey: "nav.dashboard",
      label: "Dashboard",
      path: workspacePath(workspaceId, "dashboard"),
    });
  }

  if (permissions.canSendBroadcasts) {
    links.push({
      key: "broadcasts",
      labelKey: "nav.broadcast",
      label: "Broadcast",
      path: workspacePath(workspaceId, "broadcasts"),
    });
  }

  return links;
}

/**
 * Chat and Groups share a pathname and differ only by the `view` query param,
 * so `NavLink`'s pathname-only matching cannot tell them apart. Everything the
 * account sheet owns (team, audit, settings, notifications) highlights Profile.
 */
export function resolveActiveMobileNavKey(
  pathname: string,
  search: string,
): MobileNavKey | null {
  const { destination } = getWorkspaceDestination(pathname);

  switch (destination) {
    case "chat":
      return parseChatView(search) === "groups" ? "groups" : "chat";
    case "dashboard":
      return "dashboard";
    case "broadcasts":
      return "broadcasts";
    case "team":
    case "audit":
    case "settings":
    case "notifications":
      return "profile";
    default:
      return null;
  }
}
