import { Hono } from "hono";
import type { Context } from "hono";
import {
  createAdminSession,
  createLoginCsrf,
  deleteAdminSession,
  getAdminStats,
  getAdminSubscriberPage,
  parseAdminSubscriberQuery,
  readAdminSession,
  sessionCsrf,
  verifyAdminPassword,
  verifyLoginCsrf,
} from "./services/admin";
import { clientIp, enforceRateLimit } from "./services/rate-limit";
import { verifyTurnstile } from "./services/turnstile";
import {
  acceptedSignupResponse,
  acquireIdempotency,
  completeIdempotency,
  confirmSignup,
  prepareSignup,
  releaseIdempotency,
  sendConfirmation,
} from "./services/waitlist";
import {
  allowedCorsOrigin,
  getRuntimeConfig,
  hasExactOrigin,
  type RuntimeConfig,
} from "./lib/config";
import { adminCookieNames, getCookie, serializeCookie } from "./lib/cookies";
import { timingSafeStringEqual } from "./lib/crypto";
import { ConfigurationError, HttpError } from "./lib/errors";
import {
  looksAutomated,
  readFormBody,
  readJsonBody,
  signupSchema,
  validIdempotencyKey,
  validOpaqueToken,
} from "./lib/validation";
import { renderDashboardPage, renderLoginPage } from "./templates/admin";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();
type AppContext = Context<AppEnv>;

function publicHeaders(response: Response, corsOrigin?: string): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Vary", "Origin");

  if (corsOrigin) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
  }

  return response;
}

function json(
  c: AppContext,
  body: Record<string, string>,
  status: 200 | 202 | 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
): Response {
  return publicHeaders(c.json(body, status), c.get("corsOrigin"));
}

function adminHtml(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=UTF-8",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      // `no-referrer` makes Chromium submit HTML forms with `Origin: null`.
      // Keep same-origin referrers so the exact-origin CSRF guard works.
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: location,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function setCorsOrigin(c: AppContext, config: RuntimeConfig): void {
  const suppliedOrigin = c.req.header("Origin");
  const origin = allowedCorsOrigin(c.req.raw, config);

  if (suppliedOrigin && !origin) {
    throw new HttpError(
      403,
      "This origin is not allowed to use the waitlist API.",
    );
  }
  if (origin) {
    c.set("corsOrigin", origin);
  }
}

async function renderLogin(
  env: Env,
  config: RuntimeConfig,
  error?: string,
  status = 200,
): Promise<Response> {
  const csrf = await createLoginCsrf(env.ADMIN_SESSION_SECRET);
  const names = adminCookieNames(config.secureCookies);
  const response = adminHtml(renderLoginPage(csrf, error), status);
  response.headers.append(
    "Set-Cookie",
    serializeCookie(names.loginCsrf, csrf, {
      maxAge: 60 * 15,
      sameSite: "Strict",
      secure: config.secureCookies,
    }),
  );
  return response;
}

function adminRateLimitError(retryAfter: number): HttpError {
  return new HttpError(
    429,
    `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    retryAfter,
  );
}

async function requireAdmin(c: AppContext, config: RuntimeConfig) {
  const names = adminCookieNames(config.secureCookies);
  const token = getCookie(c.req.header("Cookie"), names.session);
  return readAdminSession(c.env, token);
}

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("X-Request-ID", c.get("requestId"));
});

app.get("/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return publicHeaders(c.json({ status: "ok" }), undefined);
  } catch {
    return publicHeaders(c.json({ status: "unavailable" }, 503), undefined);
  }
});

app.options("/v1/waitlist", (c) => {
  const config = getRuntimeConfig(c.env);
  const origin = allowedCorsOrigin(c.req.raw, config);
  if (!origin) {
    throw new HttpError(
      403,
      "This origin is not allowed to use the waitlist API.",
    );
  }

  c.set("corsOrigin", origin);
  const response = publicHeaders(new Response(null, { status: 204 }), origin);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Idempotency-Key",
  );
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
});

app.post("/v1/waitlist", async (c) => {
  const config = getRuntimeConfig(c.env);
  setCorsOrigin(c, config);

  const parsed = signupSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) {
    throw new HttpError(400, "Please check your signup details and try again.");
  }

  const now = Date.now();
  if (looksAutomated(parsed.data.website, parsed.data.formStartedAt, now)) {
    return json(c, acceptedSignupResponse, 202);
  }

  const ip = clientIp(c.req.raw);
  const ipLimit = await enforceRateLimit(
    c.env.DB,
    c.env.WAITLIST_TOKEN_SECRET,
    "signup-ip",
    ip,
    6,
    1000 * 60 * 60,
    now,
  );
  if (!ipLimit.allowed) {
    throw new HttpError(
      429,
      "Please wait before requesting another confirmation email.",
      ipLimit.retryAfter,
    );
  }

  await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    parsed.data.turnstileToken,
    ip,
  );

  const emailLimit = await enforceRateLimit(
    c.env.DB,
    c.env.WAITLIST_TOKEN_SECRET,
    "signup-email",
    parsed.data.email,
    3,
    1000 * 60 * 60 * 24,
    now,
  );
  if (!emailLimit.allowed) {
    throw new HttpError(
      429,
      "Please wait before requesting another confirmation email.",
      emailLimit.retryAfter,
    );
  }

  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!validIdempotencyKey(idempotencyKey)) {
    throw new HttpError(400, "Please retry with a valid idempotency key.");
  }

  const idempotency = await acquireIdempotency(
    c.env,
    idempotencyKey,
    parsed.data.email,
    now,
  );
  if (idempotency.type === "conflict") {
    throw new HttpError(
      409,
      "This submission was already used for another request.",
    );
  }
  if (idempotency.type === "replay") {
    return json(c, idempotency.body, 202);
  }
  if (idempotency.type === "in_progress") {
    return json(c, acceptedSignupResponse, 202);
  }

  try {
    const preparation = await prepareSignup(c.env, parsed.data.email, now);
    if (preparation.type === "send-confirmation") {
      await sendConfirmation(c.env, config, preparation, now);
    }
    await completeIdempotency(c.env, idempotency, now);
    return json(c, acceptedSignupResponse, 202);
  } catch (error) {
    await releaseIdempotency(c.env, idempotency).catch(() => undefined);
    throw error;
  }
});

app.get("/v1/waitlist/confirm", async (c) => {
  const config = getRuntimeConfig(c.env);
  const token = c.req.query("token");
  const state = validOpaqueToken(token)
    ? await confirmSignup(c.env, token)
    : "expired";
  const destination = new URL(config.marketingOrigin);
  destination.searchParams.set("waitlist", state);
  destination.hash = "waitlist";
  return redirect(destination.toString());
});

app.get("/admin/login", async (c) => {
  const config = getRuntimeConfig(c.env);
  const session = await requireAdmin(c, config);
  if (session) {
    return redirect("/admin");
  }
  return renderLogin(c.env, config);
});

app.post("/admin/login", async (c) => {
  const config = getRuntimeConfig(c.env);
  if (!hasExactOrigin(c.req.raw, config.apiOrigin)) {
    throw new HttpError(403, "Invalid sign-in origin.");
  }

  const ip = clientIp(c.req.raw);
  const rate = await enforceRateLimit(
    c.env.DB,
    c.env.WAITLIST_TOKEN_SECRET,
    "admin-login-ip",
    ip,
    5,
    1000 * 60 * 15,
  );
  if (!rate.allowed) {
    throw adminRateLimitError(rate.retryAfter);
  }

  const form = await readFormBody(c.req.raw);
  const names = adminCookieNames(config.secureCookies);
  const submittedCsrf = form.get("csrf") ?? undefined;
  const cookieCsrf = getCookie(c.req.header("Cookie"), names.loginCsrf);
  const csrfMatches = Boolean(
    submittedCsrf &&
      cookieCsrf &&
      timingSafeStringEqual(submittedCsrf, cookieCsrf),
  );
  const csrfValid =
    csrfMatches &&
    (await verifyLoginCsrf(c.env.ADMIN_SESSION_SECRET, submittedCsrf));

  if (!csrfValid) {
    return renderLogin(
      c.env,
      config,
      "Your sign-in form expired. Refresh and try again.",
      403,
    );
  }

  const password = form.get("password");
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > 1024 ||
    !(await verifyAdminPassword(password, c.env.ADMIN_PASSWORD_HASH))
  ) {
    return renderLogin(c.env, config, "That password did not match.", 401);
  }

  const session = await createAdminSession(c.env, ip);
  const response = redirect("/admin");
  response.headers.append(
    "Set-Cookie",
    serializeCookie(names.session, session.token, {
      maxAge: Math.floor((session.expiresAt - Date.now()) / 1000),
      sameSite: "Strict",
      secure: config.secureCookies,
    }),
  );
  response.headers.append(
    "Set-Cookie",
    serializeCookie(names.loginCsrf, "", {
      maxAge: 0,
      sameSite: "Strict",
      secure: config.secureCookies,
    }),
  );
  return response;
});

app.get("/admin", async (c) => {
  const config = getRuntimeConfig(c.env);
  const session = await requireAdmin(c, config);
  if (!session) {
    return redirect("/admin/login");
  }

  const subscriberPage = getAdminSubscriberPage(
    c.env.DB,
    parseAdminSubscriberQuery({
      page: c.req.query("page"),
      search: c.req.query("q"),
      status: c.req.query("status"),
    }),
  );
  const [stats, subscribers, csrf] = await Promise.all([
    getAdminStats(c.env.DB),
    subscriberPage,
    sessionCsrf(c.env.ADMIN_SESSION_SECRET, session.token, "logout"),
  ]);
  return adminHtml(renderDashboardPage(stats, subscribers, csrf));
});

app.post("/admin/logout", async (c) => {
  const config = getRuntimeConfig(c.env);
  if (!hasExactOrigin(c.req.raw, config.apiOrigin)) {
    throw new HttpError(403, "Invalid sign-out origin.");
  }

  const session = await requireAdmin(c, config);
  if (!session) {
    return redirect("/admin/login");
  }

  const form = await readFormBody(c.req.raw);
  const submittedCsrf = form.get("csrf");
  const expectedCsrf = await sessionCsrf(
    c.env.ADMIN_SESSION_SECRET,
    session.token,
    "logout",
  );
  if (
    typeof submittedCsrf !== "string" ||
    !timingSafeStringEqual(submittedCsrf, expectedCsrf)
  ) {
    throw new HttpError(403, "Invalid sign-out request.");
  }

  await deleteAdminSession(c.env, session.token);
  const names = adminCookieNames(config.secureCookies);
  const response = redirect("/admin/login");
  response.headers.append(
    "Set-Cookie",
    serializeCookie(names.session, "", {
      maxAge: 0,
      sameSite: "Strict",
      secure: config.secureCookies,
    }),
  );
  return response;
});

app.notFound((c) => json(c, { error: "Not found." }, 404));

app.onError((error, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  if (error instanceof HttpError) {
    const response = json(c, { error: error.message, requestId }, error.status);
    if (error.retryAfter) {
      response.headers.set("Retry-After", String(error.retryAfter));
    }
    return response;
  }

  if (error instanceof ConfigurationError) {
    console.error({ requestId, type: "configuration-error" });
    return json(
      c,
      {
        error: "The waitlist service is not configured yet.",
        requestId,
      },
      503,
    );
  }

  console.error({
    requestId,
    path: c.req.path,
    type: "unexpected-error",
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  return json(
    c,
    { error: "Something went wrong. Please try again.", requestId },
    500,
  );
});

export { app };
