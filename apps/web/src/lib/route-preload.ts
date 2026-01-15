/**
 * Route preloading utility for prefetching page chunks on hover/focus
 * This improves perceived navigation speed by downloading chunks before the user clicks
 */

// Map of route names to their dynamic import functions
// These must match the lazy() imports in App.tsx
const routeImports = {
  login: () => import("@/pages/LoginPage"),
  register: () => import("@/pages/RegisterPage"),
  forgotPassword: () => import("@/pages/ForgotPasswordPage"),
  companySetup: () => import("@/pages/CompanySetupPage"),
  chat: () => import("@/pages/ChatPage"),
  team: () => import("@/pages/TeamPage"),
  settings: () => import("@/pages/SettingsPage"),
  audit: () => import("@/pages/AuditPage"),
  dashboard: () => import("@/pages/DashboardPage"),
  acceptInvitation: () => import("@/pages/AcceptInvitationPage"),
} as const;

export type RouteName = keyof typeof routeImports;

// Track which routes have been preloaded to prevent duplicate requests
const preloadedRoutes = new Set<RouteName>();

/**
 * Preload a route's chunk in the background
 * Safe to call multiple times - will only trigger one network request per route
 *
 * @example
 * // In a navigation component
 * <Link
 *   to="/settings"
 *   onMouseEnter={() => preloadRoute("settings")}
 *   onFocus={() => preloadRoute("settings")}
 * >
 *   Settings
 * </Link>
 */
export function preloadRoute(routeName: RouteName): void {
  // Skip if already preloaded
  if (preloadedRoutes.has(routeName)) {
    return;
  }

  // Mark as preloaded immediately to prevent duplicate requests
  preloadedRoutes.add(routeName);

  // Trigger the import (Vite will cache the result)
  routeImports[routeName]().catch(() => {
    // If preload fails, remove from set so it can be retried
    preloadedRoutes.delete(routeName);
  });
}

/**
 * Preload multiple routes at once
 * Useful for preloading related routes together
 *
 * @example
 * // Preload all auth-related routes
 * preloadRoutes(["login", "register", "forgotPassword"])
 */
export function preloadRoutes(routeNames: RouteName[]): void {
  for (const routeName of routeNames) {
    preloadRoute(routeName);
  }
}

/**
 * Check if a route has been preloaded
 * Useful for debugging or conditional UI
 */
export function isRoutePreloaded(routeName: RouteName): boolean {
  return preloadedRoutes.has(routeName);
}

/**
 * Map of URL paths to route names for easy lookup
 */
export const pathToRouteName: Record<string, RouteName> = {
  "/login": "login",
  "/register": "register",
  "/forgot-password": "forgotPassword",
  "/company-setup": "companySetup",
  "/chat": "chat",
  "/team": "team",
  "/settings": "settings",
  "/audit": "audit",
  "/dashboard": "dashboard",
};

/**
 * Preload a route by its URL path
 *
 * @example
 * preloadRouteByPath("/settings")
 */
export function preloadRouteByPath(path: string): void {
  // Handle paths with parameters (e.g., /chat/:contactId)
  const basePath = path.split("/").slice(0, 2).join("/") || path;
  const routeName = pathToRouteName[basePath];

  if (routeName) {
    preloadRoute(routeName);
  }
}
