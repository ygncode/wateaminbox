/**
 * Rate Limit Store Abstraction
 *
 * Provides a unified interface for rate limiting storage backends.
 * Supports in-memory LRU cache for development and Redis for production.
 */

import { getRateLimitConfig } from "../config/rate-limit.config.js";
import type { RateLimitConfig } from "../config/rate-limit.config";
import { createLogger, formatError } from "./logger.js";

const logger = createLogger("RedisRateLimitStore");

/**
 * Result of a rate limit check/increment operation
 */
export interface RateLimitResult {
  /**
   * Whether the request is allowed (not over limit)
   */
  allowed: boolean;
  /**
   * Current request count in this window
   */
  currentCount: number;
  /**
   * Maximum requests allowed in this window
   */
  limit: number;
  /**
   * Unix timestamp (seconds) when the window resets
   */
  resetAt: number;
  /**
   * Seconds until the window resets
   */
  retryAfter: number;
}

/**
 * Rate limit store interface
 *
 * All store implementations must provide these operations:
 * - Increment the counter for a key and get the current state
 * - Reset a specific key's counter
 * - Clear all data (useful for testing)
 */
export interface RateLimitStore {
  /**
   * Increment the counter for a given key within a time window
   * Creates a new counter if one doesn't exist
   *
   * @param key - Unique identifier for the rate limit bucket (e.g., "ip:1.2.3.4")
   * @param limit - Maximum requests allowed in the window
   * @param windowSeconds - Length of the rolling window in seconds
   * @returns RateLimitResult with current state
   */
  increment(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;

  /**
   * Reset the counter for a specific key
   *
   * @param key - Unique identifier for the rate limit bucket
   */
  reset(key: string): Promise<void>;

  /**
   * Clear all rate limit data
   * Useful for testing or emergency resets
   */
  clear(): Promise<void>;

  /**
   * Close the store and release resources
   * For Redis, this closes the connection
   */
  close(): Promise<void>;
}

/**
 * Individual counter entry stored in memory
 */
interface CounterEntry {
  count: number;
  windowStart: number; // Unix timestamp in milliseconds
}

/**
 * In-memory rate limit store with LRU eviction
 *
 * Suitable for single-instance deployments or development.
 * Uses a Map with manual LRU tracking to limit memory usage.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private counters: Map<string, CounterEntry>;
  private accessOrder: string[]; // Track access for LRU eviction
  private maxItems: number;

  constructor(maxItems: number = 10000) {
    this.counters = new Map();
    this.accessOrder = [];
    this.maxItems = maxItems;
  }

  /**
   * Increment the counter for a key, enforcing LRU eviction if needed
   */
  async increment(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Get or create entry
    let entry = this.counters.get(key);

    // Update access order for LRU
    this.updateAccessOrder(key);

    if (!entry) {
      // New entry - initialize with count of 1
      entry = { count: 1, windowStart: now };
      this.counters.set(key, entry);
      this.evictIfNeeded();
    } else {
      // Check if window has expired
      const windowElapsed = now - entry.windowStart;

      if (windowElapsed >= windowMs) {
        // Window expired - start fresh
        entry.count = 1;
        entry.windowStart = now;
      } else {
        // Within window - increment count
        entry.count++;
      }
    }

    const resetAtMs = entry.windowStart + windowMs;
    const resetAt = Math.floor(resetAtMs / 1000);
    const retryAfter = Math.max(0, Math.ceil((resetAtMs - now) / 1000));

    return {
      allowed: entry.count <= limit,
      currentCount: entry.count,
      limit,
      resetAt,
      retryAfter,
    };
  }

  /**
   * Reset a specific key's counter
   */
  async reset(key: string): Promise<void> {
    this.counters.delete(key);
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
  }

  /**
   * Clear all counters
   */
  async clear(): Promise<void> {
    this.counters.clear();
    this.accessOrder = [];
  }

  /**
   * Close the store (no-op for memory store)
   */
  async close(): Promise<void> {
    // No resources to release for in-memory store
  }

  /**
   * Update access order for LRU tracking
   * Moves the key to the end of the access list (most recently used)
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index >= 0) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Evict least recently used entries if we're over the limit
   */
  private evictIfNeeded(): void {
    while (this.counters.size > this.maxItems && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift();
      if (lruKey) {
        this.counters.delete(lruKey);
      }
    }
  }

  /**
   * Get current number of stored counters
   * Useful for monitoring and testing
   */
  get size(): number {
    return this.counters.size;
  }
}

/**
 * Type definition for Redis client (ioredis)
 * We use dynamic import to make Redis an optional dependency
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | number): Promise<"OK" | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string,
    arg1?: string,
    arg2?: string,
    arg3?: string,
    arg4?: string,
  ): Promise<[string, string[]]>;
  pipeline(): RedisPipeline;
  quit(): Promise<"OK">;
  on(event: string, handler: (err: Error) => void): void;
}

interface RedisPipeline {
  set(key: string, value: string | number): RedisPipeline;
  expire(key: string, seconds: number): RedisPipeline;
  incr(key: string): RedisPipeline;
  del(...keys: string[]): RedisPipeline;
  exec(): Promise<Array<[Error | null, any] | null>>;
  length: number;
}

/**
 * Redis rate limit store
 *
 * Suitable for distributed deployments where multiple API instances
 * need to share rate limit state.
 *
 * Uses Redis INCR with pipelined expiration for atomic operations.
 * Uses a simpler Lua-less approach for broader Redis compatibility.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private redisUrl: string;
  private client: RedisClient | null = null;
  private ready = false;

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
  }

  /**
   * Initialize the Redis connection
   * Called lazily on first use to avoid startup failures
   */
  private async ensureConnected(): Promise<void> {
    if (this.ready) return;

    try {
      // Dynamic import to avoid requiring ioredis when not using Redis
      // @ts-expect-error - ioredis is an optional dependency
      const redisModule = await import("ioredis").catch(() => {
        throw new Error(
          "ioredis package is required for Redis rate limiting. Install it with: bun add ioredis",
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Redis = redisModule.default as any;
      this.client = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          return Math.min(times * 100, 500);
        },
      }) as RedisClient;

      this.client!.on("error", (err: Error) => {
        logger.error({ err: formatError(err) }, "Redis error");
      });

      this.ready = true;
    } catch (error) {
      logger.error({ err: formatError(error) }, "Failed to connect to Redis");
      throw new Error(`Failed to initialize Redis store: ${error}`);
    }
  }

  /**
   * Increment the counter using Redis INCR with pipelined EXPIRE
   *
   * For accurate sliding windows, we store:
   * - key:count - the current counter
   * - key:start - the window start timestamp
   *
   * If the window has expired, we reset the counter.
   */
  async increment(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    await this.ensureConnected();

    if (!this.client) {
      throw new Error("Redis client not initialized");
    }

    const now = Math.floor(Date.now() / 1000);
    const countKey = `ratelimit:${key}:count`;
    const startKey = `ratelimit:${key}:start`;

    try {
      // Get current window start
      const windowStart = await this.client.get(startKey);

      if (windowStart === null) {
        // First request in this window
        const pipeline = this.client.pipeline();
        pipeline.set(countKey, 1);
        pipeline.set(startKey, now);
        pipeline.expire(countKey, windowSeconds);
        pipeline.expire(startKey, windowSeconds);
        await pipeline.exec();

        return {
          allowed: 1 <= limit,
          currentCount: 1,
          limit,
          resetAt: now + windowSeconds,
          retryAfter: windowSeconds,
        };
      }

      const windowStartNum = Number.parseInt(windowStart, 10);
      const windowElapsed = now - windowStartNum;

      if (windowElapsed >= windowSeconds) {
        // Window expired - reset
        const pipeline = this.client.pipeline();
        pipeline.set(countKey, 1);
        pipeline.set(startKey, now);
        pipeline.expire(countKey, windowSeconds);
        pipeline.expire(startKey, windowSeconds);
        await pipeline.exec();

        return {
          allowed: 1 <= limit,
          currentCount: 1,
          limit,
          resetAt: now + windowSeconds,
          retryAfter: windowSeconds,
        };
      }

      // Within window - increment counter
      const newCount = await this.client.incr(countKey);
      const resetAt = windowStartNum + windowSeconds;
      const retryAfter = Math.max(0, resetAt - now);

      return {
        allowed: newCount <= limit,
        currentCount: newCount,
        limit,
        resetAt,
        retryAfter,
      };
    } catch (error) {
      logger.error({ err: formatError(error) }, "Error during increment");
      // On Redis error, fail open - allow the request
      return {
        allowed: true,
        currentCount: 0,
        limit,
        resetAt: now + windowSeconds,
        retryAfter: windowSeconds,
      };
    }
  }

  /**
   * Reset a specific key's counter
   */
  async reset(key: string): Promise<void> {
    await this.ensureConnected();

    if (!this.client) return;

    const countKey = `ratelimit:${key}:count`;
    const startKey = `ratelimit:${key}:start`;

    try {
      await this.client.del(countKey, startKey);
    } catch (error) {
      logger.error({ err: formatError(error) }, "Error during reset");
    }
  }

  /**
   * Clear all rate limit data
   * Uses SCAN to avoid blocking for large datasets
   */
  async clear(): Promise<void> {
    await this.ensureConnected();

    if (!this.client) return;

    try {
      // Use SCAN with pattern matching to find and delete all rate limit keys
      let cursor = "0";
      const pipeline = this.client.pipeline();

      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          "MATCH",
          "ratelimit:*",
          "COUNT",
          "100",
        );

        if (keys.length > 0) {
          pipeline.del(...keys);
        }

        cursor = nextCursor;
      } while (cursor !== "0");

      // Execute the deletion pipeline
      if (pipeline.length > 0) {
        await pipeline.exec();
      }
    } catch (error) {
      logger.error({ err: formatError(error) }, "Error during clear");
    }
  }

  /**
   * Close the Redis connection
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (error) {
        logger.error({ err: formatError(error) }, "Error during close");
      }
      this.client = null;
      this.ready = false;
    }
  }
}

/**
 * Factory function to create the appropriate rate limit store
 * based on the provided configuration
 *
 * @param config - Rate limit configuration
 * @returns Configured RateLimitStore instance
 */
export function createRateLimitStore(config: RateLimitConfig): RateLimitStore {
  if (config.store.type === "redis") {
    if (!config.store.redisUrl) {
      throw new Error(
        "Redis store type requires RATE_LIMIT_REDIS_URL to be set",
      );
    }
    return new RedisRateLimitStore(config.store.redisUrl);
  }

  // Default to memory store
  return new MemoryRateLimitStore(config.store.memoryMaxItems);
}

// ============================================================================
// SINGLETON EXPORTS
// ============================================================================
// Initialized here to avoid circular dependencies between app.ts and route files
// This module has no dependencies on routes, so it's safe to import from anywhere

export const rateLimitConfig = getRateLimitConfig();
export const rateLimitStore = createRateLimitStore(rateLimitConfig);
