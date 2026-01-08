/**
 * Rate Limit Middleware
 *
 * Provides rate limiting middleware for Hono applications.
 * Supports multiple key generation strategies (IP, user, tenant) and
 * standard rate limit headers.
 */

import type { Context, Next } from "hono";
import type { RateLimitTier } from "../config/rate-limit.config";
import type { RateLimitResult, RateLimitStore } from "../lib/rate-limit-store";

/**
 * Standard rate limit response headers
 */
export const RATE_LIMIT_HEADERS = {
  LIMIT: "X-RateLimit-Limit",
  REMAINING: "X-RateLimit-Remaining",
  RESET: "X-RateLimit-Reset",
  RETRY_AFTER: "Retry-After",
} as const;

/**
 * Key generation strategy options
 */
export type KeyStrategy = "ip" | "user" | "tenant" | "user-tenant";

/**
 * Options for configuring the rate limit middleware
 */
export interface RateLimitOptions {
  /**
   * The rate limit store to use for tracking counters
   */
  store: RateLimitStore;

  /**
   * Rate limit tier configuration (requests per window)
   */
  tier: RateLimitTier;

  /**
   * How to generate the rate limit key
   * - 'ip': Use client IP address
   * - 'user': Use authenticated user ID
   * - 'tenant': Use tenant (company) ID
   * - 'user-tenant': Combine user ID and tenant ID
   */
  keyStrategy: KeyStrategy;

  /**
   * Prefix for the rate limit key (useful for namespacing)
   * Default: 'ratelimit'
   */
  keyPrefix?: string;

  /**
   * Optional function to skip rate limiting for certain requests
   * Return true to skip rate limiting for this request
   */
  skip?: (c: Context) => boolean | Promise<boolean>;

  /**
   * Optional custom key generator
   * If provided, this overrides keyStrategy
   */
  generateKey?: (c: Context) => string | Promise<string>;

  /**
   * Optional handler for when rate limit is exceeded
   * If not provided, uses default 429 response
   */
  onLimitReached?: (
    c: Context,
    result: RateLimitResult,
  ) => Response | Promise<Response>;

  /**
   * Whether to set rate limit headers on successful responses
   * Default: true
   */
  setHeaders?: boolean;
}

/**
 * Get client IP address from request
 * Checks multiple headers for proxy scenarios
 */
function getClientIp(c: Context): string {
  // Check common proxy headers first
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    // Take the first IP from the comma-separated list
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = c.req.header("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  const cfConnectingIp = c.req.header("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  // Fall back to the remote address (may not be available in all setups)
  // @ts-expect-error - Hono doesn't expose this in types but it's available at runtime
  return c.req.raw?.header?.["x-forwarded-for"] || "unknown";
}

/**
 * Generate rate limit key based on strategy
 */
async function generateKey(
  c: Context,
  strategy: KeyStrategy,
  prefix: string = "ratelimit",
): Promise<string> {
  const parts = [prefix];

  switch (strategy) {
    case "ip":
      parts.push("ip", getClientIp(c));
      break;

    case "user": {
      const user = c.get("user");
      if (!user?.id) {
        // Fall back to IP if user is not authenticated
        parts.push("ip", getClientIp(c));
      } else {
        parts.push("user", user.id);
      }
      break;
    }

    case "tenant": {
      const companyId = c.get("companyId");
      if (!companyId) {
        // Fall back to IP if tenant is not available
        parts.push("ip", getClientIp(c));
      } else {
        parts.push("tenant", companyId);
      }
      break;
    }

    case "user-tenant": {
      const user = c.get("user");
      const companyId = c.get("companyId");

      if (user?.id && companyId) {
        parts.push("user", user.id, "tenant", companyId);
      } else if (user?.id) {
        parts.push("user", user.id);
      } else {
        parts.push("ip", getClientIp(c));
      }
      break;
    }

    default:
      parts.push("ip", getClientIp(c));
  }

  return parts.join(":");
}

/**
 * Set rate limit headers on response
 */
function setRateLimitHeaders(
  c: Context,
  result: RateLimitResult,
  headers: typeof RATE_LIMIT_HEADERS,
): void {
  c.header(headers.LIMIT, result.limit.toString());
  c.header(
    headers.REMAINING,
    Math.max(0, result.limit - result.currentCount).toString(),
  );
  c.header(headers.RESET, result.resetAt.toString());
}

/**
 * Default 429 response when rate limit is exceeded
 */
function defaultRateLimitExceededResponse(
  c: Context,
  result: RateLimitResult,
  headers: typeof RATE_LIMIT_HEADERS,
): Response {
  // Set rate limit headers
  setRateLimitHeaders(c, result, headers);
  c.header(headers.RETRY_AFTER, result.retryAfter.toString());

  return c.json(
    {
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      retryAfter: result.retryAfter,
    },
    429,
  );
}

/**
 * Create a rate limit middleware factory
 *
 * @param options - Rate limit configuration options
 * @returns Hono middleware function
 *
 * @example
 * ```ts
 * // Global rate limiter (IP-based)
 * const globalLimiter = createRateLimitMiddleware({
 *   store: rateLimitStore,
 *   tier: { requests: 100, windowSeconds: 60 },
 *   keyStrategy: 'ip',
 * })
 *
 * // User-specific rate limiter
 * const userLimiter = createRateLimitMiddleware({
 *   store: rateLimitStore,
 *   tier: { requests: 60, windowSeconds: 60 },
 *   keyStrategy: 'user',
 *   keyPrefix: 'messages',
 * })
 *
 * // Skip rate limiting for health checks
 * const limiterWithSkip = createRateLimitMiddleware({
 *   store: rateLimitStore,
 *   tier: { requests: 100, windowSeconds: 60 },
 *   keyStrategy: 'ip',
 *   skip: (c) => c.req.path === '/health',
 * })
 * ```
 */
export function createRateLimitMiddleware(options: RateLimitOptions) {
  const {
    store,
    tier,
    keyStrategy,
    keyPrefix = "ratelimit",
    skip,
    generateKey: customKeyGenerator,
    onLimitReached,
    setHeaders = true,
  } = options;

  return async (c: Context, next: Next) => {
    // Check if we should skip rate limiting for this request
    if (skip && (await skip(c))) {
      await next();
      return;
    }

    // Generate the rate limit key
    const key = customKeyGenerator
      ? await customKeyGenerator(c)
      : await generateKey(c, keyStrategy, keyPrefix);

    // Increment the counter and check if limit is exceeded
    const result = await store.increment(
      key,
      tier.requests,
      tier.windowSeconds,
    );

    // Set headers on all responses if enabled
    if (setHeaders) {
      setRateLimitHeaders(c, result, RATE_LIMIT_HEADERS);
    }

    // Check if limit is exceeded
    if (!result.allowed) {
      if (onLimitReached) {
        return onLimitReached(c, result);
      }
      return defaultRateLimitExceededResponse(c, result, RATE_LIMIT_HEADERS);
    }

    // Continue to next middleware/handler
    await next();
  };
}

/**
 * Shorthand for IP-based rate limiting (common for public endpoints)
 */
export function ipRateLimit(
  store: RateLimitStore,
  tier: RateLimitTier,
  prefix?: string,
) {
  return createRateLimitMiddleware({
    store,
    tier,
    keyStrategy: "ip",
    keyPrefix: prefix,
  });
}

/**
 * Shorthand for user-based rate limiting (for authenticated endpoints)
 */
export function userRateLimit(
  store: RateLimitStore,
  tier: RateLimitTier,
  prefix?: string,
) {
  return createRateLimitMiddleware({
    store,
    tier,
    keyStrategy: "user",
    keyPrefix: prefix,
  });
}

/**
 * Shorthand for tenant-based rate limiting (for multi-tenant scenarios)
 */
export function tenantRateLimit(
  store: RateLimitStore,
  tier: RateLimitTier,
  prefix?: string,
) {
  return createRateLimitMiddleware({
    store,
    tier,
    keyStrategy: "tenant",
    keyPrefix: prefix,
  });
}

/**
 * Shorthand for combined user+tenant rate limiting
 */
export function userTenantRateLimit(
  store: RateLimitStore,
  tier: RateLimitTier,
  prefix?: string,
) {
  return createRateLimitMiddleware({
    store,
    tier,
    keyStrategy: "user-tenant",
    keyPrefix: prefix,
  });
}

/**
 * Helper to create a skip function for certain paths
 */
export function skipPaths(paths: string[] | RegExp[]): (c: Context) => boolean {
  return (c: Context) => {
    const path = c.req.path;
    return paths.some((p) => {
      if (p instanceof RegExp) {
        return p.test(path);
      }
      return path === p || path.startsWith(p + "/");
    });
  };
}

/**
 * Helper to create a skip function for certain HTTP methods
 */
export function skipMethods(methods: string[]): (c: Context) => boolean {
  const upperMethods = methods.map((m) => m.toUpperCase());
  return (c: Context) => {
    return upperMethods.includes(c.req.method);
  };
}

/**
 * No-op middleware that just continues to the next handler
 * Used when rate limiting is disabled
 */
const noopMiddleware = async (_c: Context, next: Next) => await next();

/**
 * Factory function to create a conditional rate limiter
 *
 * Returns a rate limit middleware if rate limiting is enabled,
 * otherwise returns a no-op middleware that passes through.
 *
 * This eliminates the need for conditional rate limiter creation in route files.
 *
 * @param options - Rate limit configuration options
 * @param enabled - Whether rate limiting is enabled (typically from rateLimitConfig.enabled)
 * @returns Hono middleware function
 *
 * @example
 * ```ts
 * import { createConditionalRateLimiter } from '../middleware/rate-limit.js'
 * import { rateLimitConfig, rateLimitStore } from '../lib/rate-limit-store.js'
 *
 * // Replaces the verbose pattern:
 * // const limiter: MiddlewareHandler = rateLimitConfig.enabled
 * //   ? createRateLimitMiddleware({...})
 * //   : async (_c, next) => await next();
 *
 * // With:
 * const limiter = createConditionalRateLimiter({
 *   store: rateLimitStore,
 *   tier: rateLimitConfig.tiers.auth.login,
 *   keyStrategy: 'ip',
 *   keyPrefix: 'auth-login',
 * }, rateLimitConfig.enabled)
 * ```
 */
export function createConditionalRateLimiter(
  options: RateLimitOptions,
  enabled: boolean,
) {
  if (!enabled) {
    return noopMiddleware;
  }
  return createRateLimitMiddleware(options);
}
