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

export function getAuthRedirectFromState(state: unknown): string | null {
  const from = (state as RedirectLocationState | null)?.from;
  if (!from?.pathname) return null;
  return getSafeAuthRedirect(
    `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`,
  );
}

export function buildAuthUrl(
  path: "/login" | "/register",
  redirect: string | null,
  email?: string | null,
): string {
  const params = new URLSearchParams();
  if (redirect) params.set("redirect", redirect);
  if (email) params.set("email", email);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
