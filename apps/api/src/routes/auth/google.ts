import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "../../lib/env.js";
import { AuthError } from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import {
  beginGoogleFlow,
  exchangeGoogleCode,
  FLOW_TTL_SECONDS,
  isGoogleSignInEnabled,
  openGoogleFlow,
  sameSecret,
  signInWithGoogle,
} from "../../services/google-auth.service.js";
import { setRefreshTokenCookie } from "./cookies.js";
import { googleCallbackRateLimiter } from "./rate-limiters.js";
import { getDeviceInfo } from "./utils.js";

const logger = createLogger("AuthRoutes:Google");

const FLOW_COOKIE = "wateaminbox_google_flow";
const FLOW_COOKIE_PATH = "/api/auth/google";

export const googleRoutes = new Hono();

/** Where the web app picks the flow back up. */
function appUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, env.APP_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function clearFlowCookie(c: Context) {
  deleteCookie(c, FLOW_COOKIE, {
    path: FLOW_COOKIE_PATH,
    secure: env.NODE_ENV === "production",
  });
}

/** Back to the login page with a stable, non-sensitive error code. */
function failure(c: Context, code: string, redirect?: string | null) {
  clearFlowCookie(c);
  const params: Record<string, string> = { googleError: code };
  if (redirect) params.redirect = redirect;
  return c.redirect(appUrl("/login", params), 302);
}

/**
 * GET /google/status
 * Lets the web app hide the button on deployments without Google configured.
 */
googleRoutes.get("/google/status", (c) =>
  c.json({ enabled: isGoogleSignInEnabled() }),
);

/**
 * GET /google/start?redirect=/invite/abc
 * Full-page navigation (not fetch): sets the flow cookie and sends the
 * browser to Google's consent screen.
 */
googleRoutes.get("/google/start", async (c) => {
  if (!isGoogleSignInEnabled()) return failure(c, "unavailable");
  const { url, cookie } = await beginGoogleFlow(
    c.req.query("redirect") ?? null,
  );
  setCookie(c, FLOW_COOKIE, cookie, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // Lax is what lets the cookie ride Google's top-level redirect back.
    sameSite: "Lax",
    path: FLOW_COOKIE_PATH,
    maxAge: FLOW_TTL_SECONDS,
  });
  c.header("cache-control", "no-store");
  return c.redirect(url, 302);
});

/**
 * GET /google/callback?code=...&state=...
 * Google's redirect target. Verifies state, exchanges the code, signs the
 * user in, then hands control back to the web app, which restores the
 * session from the refresh cookie exactly as it does on a page reload.
 */
googleRoutes.get("/google/callback", googleCallbackRateLimiter, async (c) => {
  c.header("cache-control", "no-store");
  c.header("referrer-policy", "no-referrer");
  if (!isGoogleSignInEnabled()) return failure(c, "unavailable");

  const flow = await openGoogleFlow(getCookie(c, FLOW_COOKIE));
  if (!flow) return failure(c, "expired");

  // The user pressed "Cancel" on Google, or Google refused the request.
  if (c.req.query("error")) return failure(c, "cancelled", flow.redirect);

  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  if (!state || !code || !sameSecret(state, flow.state)) {
    return failure(c, "invalid", flow.redirect);
  }

  try {
    const profile = await exchangeGoogleCode(code, flow);
    const { tokens, created } = await signInWithGoogle(
      profile,
      getDeviceInfo(c),
    );
    clearFlowCookie(c);
    setRefreshTokenCookie(c, tokens.refreshToken);
    const params: Record<string, string> = {
      google: created ? "signup" : "login",
    };
    if (flow.redirect) params.redirect = flow.redirect;
    return c.redirect(appUrl("/login", params), 302);
  } catch (error) {
    if (error instanceof AuthError) {
      const code =
        error.code === "GOOGLE_EMAIL_UNVERIFIED"
          ? "unverified"
          : error.code === "GOOGLE_ACCOUNT_MISMATCH"
            ? "mismatch"
            : "failed";
      logger.warn({ code: error.code }, "Google sign-in rejected");
      return failure(c, code, flow.redirect);
    }
    logger.error({ err: formatError(error) }, "Google sign-in error");
    return failure(c, "failed", flow.redirect);
  }
});
