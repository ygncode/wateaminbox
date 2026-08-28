import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { ZodError } from "zod";
import { env } from "./lib/env.js";
import { AppError, AuthError } from "./lib/errors.js";
import { createLogger, formatError } from "./lib/logger.js";
import { rateLimitConfig, rateLimitStore } from "./lib/rate-limit-store.js";
import { formatZodErrors } from "./lib/response.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { routes } from "./routes/index.js";

const appLogger = createLogger("App");

export const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Company-Id",
      "X-Realtime-Client-Id",
    ],
  }),
);

// Global rate limiting (applied to application /api/* routes; health probes are excluded)
// Positioned after CORS and before route-specific middleware
if (rateLimitConfig.enabled) {
  const globalRateLimiter = createRateLimitMiddleware({
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.global,
    keyStrategy: "ip",
    keyPrefix: "global",
    // Infrastructure probes must remain observable when PostgreSQL-backed
    // limiting is unavailable. Readiness performs its own authoritative
    // dependency checks; liveness must never turn a database outage into a
    // restart loop.
    skip: (c) => {
      const path = c.req.path;
      const isHealthProbe =
        path === "/api/health" || path.startsWith("/api/health/");
      return !path.startsWith("/api") || isHealthProbe;
    },
  });

  app.use("*", globalRateLimiter);
}

// Routes - mounted at /api
app.route("/api", routes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error handler
app.onError((err, c) => {
  // Handle HTTPException - preserve status code and message
  if (err instanceof HTTPException) {
    const status = err.status;
    const message = err.message || "An error occurred";

    // Check if this is a Zod validation error from zValidator
    // zValidator throws HTTPException with a response containing { success: false, error: ZodError }
    const cause = err.cause;
    if (cause && typeof cause === "object" && "issues" in cause) {
      // This is a ZodError - format it nicely
      const zodError = cause as ZodError;
      return c.json(
        {
          error: "Validation Error",
          details: formatZodErrors(zodError.issues),
        },
        400,
      );
    }

    return c.json({ error: message }, status);
  }

  // Handle AuthError - includes code field for specific auth error handling
  if (err instanceof AuthError) {
    return c.json(
      { error: err.code, message: err.message },
      err.statusCode as 400 | 401 | 403 | 404 | 409,
    );
  }

  // Handle AppError and its subclasses (TableNotFoundError, ServiceUnavailableError, etc.)
  if (err instanceof AppError) {
    return c.json(
      err.details
        ? { error: err.message, details: err.details }
        : { error: err.message },
      err.statusCode as 400 | 401 | 403 | 404 | 409 | 500 | 503,
    );
  }

  // Log unexpected errors
  appLogger.error(
    { err: formatError(err), path: c.req.path },
    "Unexpected error",
  );
  return c.json({ error: "Internal Server Error" }, 500);
});
