export interface RedirectLocationState {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
}

/** Only allow same-origin application paths as post-auth destinations. */
export function getSafeAuthRedirect(
  value: string | null | undefined,
): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function getInvitationTokenFromRedirect(
  redirect: string | null | undefined,
): string | undefined {
  const safeRedirect = getSafeAuthRedirect(redirect);
  if (!safeRedirect) return undefined;
  const match = safeRedirect.match(/^\/invite\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function getAuthRedirectFromState(state: unknown): string | null {
  const from = (state as RedirectLocationState | null)?.from;
  if (!from?.pathname) return null;
  return getSafeAuthRedirect(
    `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`,
  );
}

export function buildAuthUrl(
  path: "/forgot-password" | "/login" | "/register",
  redirect: string | null,
  email?: string | null,
): string {
  const params = new URLSearchParams();
  if (redirect) params.set("redirect", redirect);
  if (email) params.set("email", email);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Build the login URL shown on the registration success screen. Invitation
 * registrations auto-accept the invitation during email verification, so the
 * `/invite/<token>` redirect is dropped to keep the user from being routed
 * back to a consumed (and therefore invalid) invitation after they sign in.
 * Login then falls through to its normal workspace routing, landing the user
 * in the workspace they just joined.
 */
export function buildPostRegistrationLoginUrl(
  redirectTo: string | null,
  email?: string | null,
): string {
  const invitationToken = getInvitationTokenFromRedirect(redirectTo);
  return buildAuthUrl("/login", invitationToken ? null : redirectTo, email);
}
