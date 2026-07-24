import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "../../lib/env.js";
import { getRefreshTokenExpiry } from "../../lib/jwt.js";

const REFRESH_COOKIE_NAME = "wateaminbox_refresh";
const REFRESH_COOKIE_PATH = "/api/auth";

export function getRefreshTokenCookie(c: Context): string | undefined {
  return getCookie(c, REFRESH_COOKIE_NAME);
}

export function setRefreshTokenCookie(c: Context, token: string): void {
  const maxAge = Math.max(
    0,
    Math.floor((getRefreshTokenExpiry().getTime() - Date.now()) / 1000),
  );

  setCookie(c, REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: REFRESH_COOKIE_PATH,
    maxAge,
  });
}

export function clearRefreshTokenCookie(c: Context): void {
  deleteCookie(c, REFRESH_COOKIE_NAME, {
    secure: env.NODE_ENV === "production",
    path: REFRESH_COOKIE_PATH,
  });
}
