import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { routes } from "./routes/index.js";
import { rateLimitConfig, rateLimitStore } from "./lib/rate-limit-store.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";

export const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Company-Id"],
  })
);

// Global rate limiting (applied to all /api/* routes)
// Positioned after CORS and before route-specific middleware
if (rateLimitConfig.enabled) {
  const globalRateLimiter = createRateLimitMiddleware({
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.global,
    keyStrategy: "ip",
    keyPrefix: "global",
    // Skip rate limiting for non-API routes
    skip: (c) => !c.req.path.startsWith("/api"),
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
    return c.json({ error: message }, status);
  }

  // Log unexpected errors
  console.error(`${err}`);
  return c.json({ error: "Internal Server Error" }, 500);
});
