/**
 * Pure route canonicalizer. Raw SPA locations contain workspace, contact,
 * broadcast-job, and invitation identifiers, and query strings can carry
 * verification/reset tokens — so page views only ever report the fixed
 * templates produced here, never the browser URL.
 */

export interface CanonicalRoute {
  path: string;
  title: string;
}

const UNKNOWN_ROUTE: CanonicalRoute = { path: "/unknown", title: "Unknown" };

const STATIC_ROUTES: Record<string, CanonicalRoute> = {
  "/": { path: "/", title: "Home" },
  "/login": { path: "/login", title: "Login" },
  "/register": { path: "/register", title: "Register" },
  "/forgot-password": { path: "/forgot-password", title: "Forgot password" },
  "/reset-password": { path: "/reset-password", title: "Reset password" },
  "/verify-email": { path: "/verify-email", title: "Verify email" },
  "/company-setup": { path: "/company-setup", title: "Workspace setup" },
  "/workspaces": { path: "/workspaces", title: "Workspace chooser" },
};

/**
 * Known static settings sections (see SettingsPage). Unknown sections become
 * the `:section` placeholder instead of being copied into the template.
 */
const SETTINGS_SECTIONS = new Set([
  "general",
  "connections",
  "sla",
  "quick-replies",
  "labels",
  "catalogs",
  "profile",
  "notifications",
  "data",
  "appearance",
  "privacy",
]);

function canonicalizeSettingsSection(section: string): string {
  return SETTINGS_SECTIONS.has(section) ? section : ":section";
}

/** Routes inside a workspace, after the `/w/:workspaceId` prefix. */
function canonicalizeWorkspaceRoute(segments: string[]): CanonicalRoute | null {
  const prefix = "/w/:workspace";
  if (segments.length === 0) return { path: prefix, title: "Workspace home" };
  const [head, second, ...rest] = segments;
  if (rest.length > 0) return null;
  switch (head) {
    case "chat":
      return second
        ? { path: `${prefix}/chat/:contact`, title: "Conversation" }
        : { path: `${prefix}/chat`, title: "Chat" };
    case "team":
      return second ? null : { path: `${prefix}/team`, title: "Team" };
    case "settings":
      return second
        ? {
            path: `${prefix}/settings/${canonicalizeSettingsSection(second)}`,
            title: "Settings",
          }
        : { path: `${prefix}/settings`, title: "Settings" };
    case "audit":
      return second ? null : { path: `${prefix}/audit`, title: "Audit log" };
    case "dashboard":
      return second
        ? null
        : { path: `${prefix}/dashboard`, title: "Dashboard" };
    case "broadcasts":
      return second
        ? { path: `${prefix}/broadcasts/:job`, title: "Broadcast job" }
        : { path: `${prefix}/broadcasts`, title: "Broadcasts" };
    case "notifications":
      return second
        ? null
        : { path: `${prefix}/notifications`, title: "Notifications" };
    default:
      return null;
  }
}

/** Legacy non-workspace paths that immediately redirect into `/w/...`. */
function canonicalizeLegacyRoute(segments: string[]): CanonicalRoute | null {
  const [head, second, ...rest] = segments;
  if (rest.length > 0) return null;
  switch (head) {
    case "chat":
      return second
        ? { path: "/chat/:contact", title: "Conversation" }
        : { path: "/chat", title: "Chat" };
    case "settings":
      return second
        ? {
            path: `/settings/${canonicalizeSettingsSection(second)}`,
            title: "Settings",
          }
        : { path: "/settings", title: "Settings" };
    case "team":
    case "audit":
    case "dashboard":
    case "broadcasts":
    case "notifications":
      return second
        ? null
        : { path: `/${head}`, title: head[0].toUpperCase() + head.slice(1) };
    default:
      return null;
  }
}

export function canonicalizeRoute(pathname: string): CanonicalRoute {
  if (typeof pathname !== "string") return UNKNOWN_ROUTE;
  // Defense in depth: never keep a query string or hash, even if a caller
  // passes a full URL-ish string instead of location.pathname.
  const bare = pathname.split(/[?#]/, 1)[0];

  const staticRoute = STATIC_ROUTES[bare.replace(/\/+$/, "") || "/"];
  if (staticRoute) return staticRoute;

  const segments = bare.split("/").filter(Boolean);
  if (segments.length === 0) return STATIC_ROUTES["/"];

  if (segments[0] === "invite") {
    return segments.length === 2
      ? { path: "/invite/:token", title: "Accept invitation" }
      : UNKNOWN_ROUTE;
  }

  if (segments[0] === "w" && segments.length >= 2) {
    return canonicalizeWorkspaceRoute(segments.slice(2)) ?? UNKNOWN_ROUTE;
  }

  return canonicalizeLegacyRoute(segments) ?? UNKNOWN_ROUTE;
}

/**
 * Canonical templates that only ever render a redirect (`<Navigate>` or
 * `LegacyWorkspaceRedirect`) and therefore must not produce a page view: the
 * settled destination is tracked instead, so one user navigation is never
 * counted twice (e.g. `/` -> `/chat` -> `/w/:workspace/chat`).
 */
const REDIRECT_ONLY_CANONICAL = new Set([
  "/", // root redirects to /chat
  "/unknown", // both wildcard routes redirect to chat
  "/w/:workspace", // workspace index redirects to chat
  "/w/:workspace/settings", // redirects to settings/general
  "/w/:workspace/settings/:section", // unknown section redirects to general
]);

/** Legacy non-workspace heads render only a redirect into `/w/...`. */
const LEGACY_REDIRECT_HEADS = new Set([
  "chat",
  "settings",
  "dashboard",
  "broadcasts",
  "team",
  "audit",
  "notifications",
]);

/**
 * Pure tracker decision: true only for settled, actually rendered
 * destinations. Canonicalizer behavior is unchanged — redirect hops still
 * canonicalize safely for tag state; they just don't emit a page_view.
 */
export function shouldTrackPageView(pathname: string): boolean {
  const { path } = canonicalizeRoute(pathname);
  if (REDIRECT_ONLY_CANONICAL.has(path)) return false;
  if (path.startsWith("/w/")) return true;
  const head = path.split("/").filter(Boolean)[0] ?? "";
  return !LEGACY_REDIRECT_HEADS.has(head);
}

/** The sanitized page_location sent to GA in place of the browser URL. */
export function buildPageLocation(
  origin: string,
  canonicalPath: string,
): string {
  return `${origin}${canonicalPath}`;
}

/**
 * One page view per navigation: React Router assigns each history entry a
 * key, so suppressing repeats of the same key drops StrictMode's duplicate
 * effect run while still counting a later navigation back to the same path.
 */
export function createNavigationDeduper(): (navigationKey: string) => boolean {
  let lastKey: string | null = null;
  return (navigationKey: string) => {
    if (navigationKey === lastKey) return false;
    lastKey = navigationKey;
    return true;
  };
}
