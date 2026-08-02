export interface CookieOptions {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Lax" | "Strict";
  secure?: boolean;
}

export function getCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) {
      continue;
    }

    const key = entry.slice(0, separator).trim();
    if (key === name) {
      return entry.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? "/"}`];

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join("; ");
}

export function adminCookieNames(secure: boolean): {
  loginCsrf: string;
  session: string;
} {
  return secure
    ? {
        loginCsrf: "__Host-wateaminbox-admin-login-csrf",
        session: "__Host-wateaminbox-admin",
      }
    : {
        loginCsrf: "wateaminbox_admin_login_csrf",
        session: "wateaminbox_admin",
      };
}
