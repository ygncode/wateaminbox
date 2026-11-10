export const APP_SIDEBAR_COLLAPSED_KEY = "wateaminbox:sidebar-collapsed";

/**
 * Read the persisted desktop rail state before the workspace has loaded.
 *
 * Route guards use this as well as the live shell so the first authenticated
 * paint has the same width as the shell that replaces it.
 */
export function getInitialAppSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}
