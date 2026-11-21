/**
 * Whether this browser had a signed-in session last time.
 *
 * Not a credential and never trusted for access: the refresh cookie and the
 * API decide that. It only picks what to paint while the session is being
 * restored, so a signed-out visitor sees a neutral loader instead of the
 * signed-in app shell flashing before the redirect to /login.
 */
export const SESSION_HINT_KEY = "wateaminbox-session";

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSessionHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT_KEY, "1");
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // storage unavailable (privacy mode)
  }
}
