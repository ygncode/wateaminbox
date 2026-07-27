/**
 * Rate Limit Configuration
 *
 * Environment variables:
 * - RATE_LIMIT_ENABLED: Enable/disable rate limiting globally (default: true)
 * - RATE_LIMIT_STORE_TYPE: Store type - "memory" or "redis" (default: "memory")
 * - RATE_LIMIT_REDIS_URL: Redis connection URL for distributed rate limiting
 * - RATE_LIMIT_MEMORY_MAX_ITEMS: Max items in memory LRU cache (default: 10000)
 *
 * Tier-specific overrides (use window_seconds_* format for window duration):
 * - RATE_LIMIT_GLOBAL_REQUESTS: Global tier requests per window (default: 100)
 * - RATE_LIMIT_GLOBAL_WINDOW_SECONDS: Global tier window in seconds (default: 60)
 *
 * Auth endpoints:
 * - RATE_LIMIT_AUTH_LOGIN_REQUESTS: Login requests per window (default: 5)
 * - RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS: Login window in seconds (default: 900)
 * - RATE_LIMIT_AUTH_REGISTER_REQUESTS: Register requests per window (default: 3)
 * - RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS: Register window in seconds (default: 3600)
 * - RATE_LIMIT_AUTH_REFRESH_REQUESTS: Refresh requests per window (default: 20)
 * - RATE_LIMIT_AUTH_REFRESH_WINDOW_SECONDS: Refresh window in seconds (default: 60)
 *
 * Resource-intensive endpoints:
 * - RATE_LIMIT_RESOURCE_SEARCH_REQUESTS: Search requests per window (default: 30)
 * - RATE_LIMIT_RESOURCE_EXPORT_REQUESTS: Export requests per window (default: 10)
 * - RATE_LIMIT_RESOURCE_EXPORT_WINDOW_SECONDS: Export window in seconds (default: 3600)
 * - RATE_LIMIT_RESOURCE_IMPORT_REQUESTS: Import requests per window (default: 5)
 * - RATE_LIMIT_RESOURCE_ANALYTICS_REQUESTS: Analytics requests per window (default: 20)
 *
 * Messaging endpoints:
 * - RATE_LIMIT_MESSAGING_SEND_REQUESTS: Send message requests per window (default: 60)
 * - RATE_LIMIT_MESSAGING_WHATSAPP_REQUESTS: WhatsApp requests per window (default: 30)
 */

import { createLogger } from "../lib/logger.js";

const logger = createLogger("RateLimitConfig");

/**
 * Rate limit tier definition
 */
export interface RateLimitTier {
  requests: number;
  windowSeconds: number;
}

/**
 * Complete rate limit configuration
 */
export interface RateLimitConfig {
  enabled: boolean;
  store: {
    type: "memory" | "redis";
    redisUrl?: string;
    memoryMaxItems: number;
  };
  tiers: {
    global: RateLimitTier;
    auth: {
      login: RateLimitTier;
      register: RateLimitTier;
      forgotPassword: RateLimitTier;
      refresh: RateLimitTier;
    };
    resource: {
      search: RateLimitTier;
      export: RateLimitTier;
      import: RateLimitTier;
      analytics: RateLimitTier;
    };
    messaging: {
      send: RateLimitTier;
      whatsapp: RateLimitTier;
    };
  };
}

/**
 * Parse a positive integer from an environment variable
 * Returns the default value if parsing fails or the value is not positive
 */
function parsePositiveInt(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn(
      { value, defaultValue },
      "Invalid value for environment variable, using default",
    );
    return defaultValue;
  }

  return parsed;
}

/**
 * Check if we're in development mode
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Get default value for a tier, with more lenient defaults in development
 */
function getDefaultRequests(
  envValue: string | undefined,
  prodDefault: number,
  devMultiplier: number = 10,
): number {
  if (envValue !== undefined && envValue !== "") {
    return parsePositiveInt(envValue, prodDefault);
  }
  return isDevelopment() ? prodDefault * devMultiplier : prodDefault;
}

/**
 * Get the rate limit configuration from environment variables
 * Uses sensible defaults when variables are not set
 * Development mode uses 10x more lenient defaults
 */
export function getRateLimitConfig(): RateLimitConfig {
  const enabled = process.env.RATE_LIMIT_ENABLED !== "false";

  const storeType = process.env.RATE_LIMIT_STORE_TYPE as
    | "memory"
    | "redis"
    | undefined;
  const validStoreType: "memory" | "redis" =
    storeType === "redis" ? "redis" : "memory";

  return {
    enabled,
    store: {
      type: validStoreType,
      redisUrl: process.env.RATE_LIMIT_REDIS_URL,
      memoryMaxItems: parsePositiveInt(
        process.env.RATE_LIMIT_MEMORY_MAX_ITEMS,
        10000,
      ),
    },
    tiers: {
      global: {
        requests: getDefaultRequests(
          process.env.RATE_LIMIT_GLOBAL_REQUESTS,
          100,
        ),
        windowSeconds: parsePositiveInt(
          process.env.RATE_LIMIT_GLOBAL_WINDOW_SECONDS,
          60,
        ),
      },
      auth: {
        login: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_AUTH_LOGIN_REQUESTS,
            5,
            20, // 100 login attempts in dev
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS,
            isDevelopment() ? 60 : 900, // 1 minute in dev, 15 minutes in prod
          ),
        },
        register: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_AUTH_REGISTER_REQUESTS,
            3,
            20, // 60 registrations in dev
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS,
            isDevelopment() ? 60 : 3600, // 1 minute in dev, 1 hour in prod
          ),
        },
        forgotPassword: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_AUTH_FORGOT_PASSWORD_REQUESTS,
            3,
            20, // 60 in dev
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_AUTH_FORGOT_PASSWORD_WINDOW_SECONDS,
            isDevelopment() ? 60 : 3600, // 1 minute in dev, 1 hour in prod
          ),
        },
        refresh: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_AUTH_REFRESH_REQUESTS,
            20,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_AUTH_REFRESH_WINDOW_SECONDS,
            60, // 1 minute
          ),
        },
      },
      resource: {
        search: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_RESOURCE_SEARCH_REQUESTS,
            30,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_RESOURCE_SEARCH_WINDOW_SECONDS,
            60,
          ),
        },
        export: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_RESOURCE_EXPORT_REQUESTS,
            10,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_RESOURCE_EXPORT_WINDOW_SECONDS,
            isDevelopment() ? 60 : 3600, // 1 minute in dev, 1 hour in prod
          ),
        },
        import: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_RESOURCE_IMPORT_REQUESTS,
            5,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_RESOURCE_IMPORT_WINDOW_SECONDS,
            60,
          ),
        },
        analytics: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_RESOURCE_ANALYTICS_REQUESTS,
            60,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_RESOURCE_ANALYTICS_WINDOW_SECONDS,
            60,
          ),
        },
      },
      messaging: {
        send: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_MESSAGING_SEND_REQUESTS,
            60,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_MESSAGING_SEND_WINDOW_SECONDS,
            60,
          ),
        },
        whatsapp: {
          requests: getDefaultRequests(
            process.env.RATE_LIMIT_MESSAGING_WHATSAPP_REQUESTS,
            30,
          ),
          windowSeconds: parsePositiveInt(
            process.env.RATE_LIMIT_MESSAGING_WHATSAPP_WINDOW_SECONDS,
            60,
          ),
        },
      },
    },
  };
}

/**
 * Validate a rate limit configuration object
 * Returns true if the configuration is valid
 */
export function isValidRateLimitConfig(config: RateLimitConfig): boolean {
  if (typeof config.enabled !== "boolean") {
    return false;
  }

  const validStoreTypes = ["memory", "redis"];
  if (!validStoreTypes.includes(config.store.type)) {
    return false;
  }

  if (config.store.type === "redis" && !config.store.redisUrl) {
    return false;
  }

  if (
    typeof config.store.memoryMaxItems !== "number" ||
    config.store.memoryMaxItems <= 0
  ) {
    return false;
  }

  // Validate all tiers have positive integers
  const validateTier = (tier: RateLimitTier): boolean => {
    return (
      typeof tier.requests === "number" &&
      tier.requests > 0 &&
      typeof tier.windowSeconds === "number" &&
      tier.windowSeconds > 0
    );
  };

  if (!validateTier(config.tiers.global)) return false;

  for (const tier of Object.values(config.tiers.auth)) {
    if (!validateTier(tier)) return false;
  }

  for (const tier of Object.values(config.tiers.resource)) {
    if (!validateTier(tier)) return false;
  }

  for (const tier of Object.values(config.tiers.messaging)) {
    if (!validateTier(tier)) return false;
  }

  return true;
}

/**
 * Default configuration values
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  store: {
    type: "memory",
    redisUrl: undefined,
    memoryMaxItems: 10000,
  },
  tiers: {
    global: {
      requests: 100,
      windowSeconds: 60,
    },
    auth: {
      login: {
        requests: 5,
        windowSeconds: 900, // 15 minutes
      },
      register: {
        requests: 3,
        windowSeconds: 3600, // 1 hour
      },
      forgotPassword: {
        requests: 3,
        windowSeconds: 3600, // 1 hour
      },
      refresh: {
        requests: 20,
        windowSeconds: 60, // 1 minute
      },
    },
    resource: {
      search: {
        requests: 30,
        windowSeconds: 60,
      },
      export: {
        requests: 10,
        windowSeconds: 3600, // 1 hour
      },
      import: {
        requests: 5,
        windowSeconds: 60,
      },
      analytics: {
        requests: 60,
        windowSeconds: 60,
      },
    },
    messaging: {
      send: {
        requests: 60,
        windowSeconds: 60,
      },
      whatsapp: {
        requests: 30,
        windowSeconds: 60,
      },
    },
  },
};
