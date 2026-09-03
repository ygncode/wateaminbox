/**
 * Rate Limit Store Abstraction
 *
 * Provides a unified interface for rate limiting storage backends.
 * Supports in-memory LRU cache, PostgreSQL, and optional Redis backends.
 */

import { type Database, db } from "@wateaminbox/database";
import { type Kysely, sql } from "kysely";
import type { RateLimitConfig } from "../config/rate-limit.config";
import {
  getRateLimitConfig,
  MAX_RATE_LIMIT_CLEANUP_BATCH_SIZE,
  MAX_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS,
  MAX_RATE_LIMIT_REQUESTS,
  MAX_RATE_LIMIT_WINDOW_SECONDS,
} from "../config/rate-limit.config.js";
import { createLogger, formatError } from "./logger.js";

const logger = createLogger("RateLimitStore");

/** A shared backend could not authoritatively apply a rate limit. */
export class RateLimitStoreUnavailableError extends Error {
  override readonly name = "RateLimitStoreUnavailableError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function assertRateLimitArguments(limit: number, windowSeconds: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_RATE_LIMIT_REQUESTS
  ) {
    throw new RangeError(
      `Rate limit must be a positive safe integer no greater than ${MAX_RATE_LIMIT_REQUESTS}`,
    );
  }
  if (
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds <= 0 ||
    windowSeconds > MAX_RATE_LIMIT_WINDOW_SECONDS
  ) {
    throw new RangeError(
      `Rate limit window must be a positive safe integer no greater than ${MAX_RATE_LIMIT_WINDOW_SECONDS}`,
    );
  }
}

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

  /** Check whether an authoritative shared backend is available. */
  healthCheck?(): Promise<boolean>;
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
  // A Map iterates in insertion order, so re-inserting a key on access makes
  // the Map itself the LRU list. The previous parallel array cost an O(n)
  // indexOf + splice on every single rate-limited request (n up to maxItems,
  // 10k by default), which is pure CPU burn on the hottest request path.
  private counters: Map<string, CounterEntry>;
  private maxItems: number;

  constructor(maxItems: number = 10000) {
    this.counters = new Map();
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
    assertRateLimitArguments(limit, windowSeconds);
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Get or create entry
    let entry = this.counters.get(key);

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
        // Once denied, callers only need to know that the cap was crossed.
        // Capping at limit + 1 keeps the counter overflow-safe.
        entry.count = Math.min(entry.count + 1, limit + 1);
      }

      // Re-insert so this key becomes the most recently used.
      this.counters.delete(key);
      this.counters.set(key, entry);
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
  }

  /**
   * Clear all counters
   */
  async clear(): Promise<void> {
    this.counters.clear();
  }

  /**
   * Close the store (no-op for memory store)
   */
  async close(): Promise<void> {
    // No resources to release for in-memory store
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Evict least recently used entries if we're over the limit.
   *
   * The Map's first key is the least recently used one, because every access
   * re-inserts its key at the end.
   */
  private evictIfNeeded(): void {
    while (this.counters.size > this.maxItems) {
      const lruKey = this.counters.keys().next().value;
      if (lruKey === undefined) return;
      this.counters.delete(lruKey);
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

interface PostgresIncrementRow {
  request_count: string;
  reset_at: string;
  retry_after: string;
}

/**
 * PostgreSQL-backed fixed-window counters shared by every API replica.
 * Each increment is one atomic INSERT ... ON CONFLICT statement and uses only
 * PostgreSQL time, so replica clock skew cannot split or extend a bucket.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupInFlight: Promise<number> | undefined;
  private closed = false;

  constructor(
    private readonly database: Kysely<Database> = db,
    private readonly cleanupIntervalSeconds = 60,
    private readonly cleanupBatchSize = 1000,
  ) {
    if (
      !Number.isSafeInteger(cleanupIntervalSeconds) ||
      cleanupIntervalSeconds <= 0 ||
      cleanupIntervalSeconds > MAX_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS
    ) {
      throw new RangeError(
        `PostgreSQL cleanup interval must be between 1 and ${MAX_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS}`,
      );
    }
    if (
      !Number.isSafeInteger(cleanupBatchSize) ||
      cleanupBatchSize <= 0 ||
      cleanupBatchSize > MAX_RATE_LIMIT_CLEANUP_BATCH_SIZE
    ) {
      throw new RangeError(
        `PostgreSQL cleanup batch size must be between 1 and ${MAX_RATE_LIMIT_CLEANUP_BATCH_SIZE}`,
      );
    }
    this.scheduleCleanup();
  }

  async increment(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    assertRateLimitArguments(limit, windowSeconds);
    const cappedCount = limit + 1;

    try {
      const result = await sql<PostgresIncrementRow>`
        INSERT INTO api_rate_limit_buckets (
          bucket_key,
          request_count,
          window_started_at,
          expires_at
        ) VALUES (
          ${key},
          1,
          statement_timestamp(),
          statement_timestamp() + (${windowSeconds} * interval '1 second')
        )
        ON CONFLICT (bucket_key) DO UPDATE SET
          request_count = CASE
            WHEN api_rate_limit_buckets.expires_at <= statement_timestamp()
              THEN 1
            ELSE CASE
              WHEN api_rate_limit_buckets.request_count >= ${cappedCount}::bigint
                THEN ${cappedCount}::bigint
              ELSE api_rate_limit_buckets.request_count + 1
            END
          END,
          window_started_at = CASE
            WHEN api_rate_limit_buckets.expires_at <= statement_timestamp()
              THEN statement_timestamp()
            ELSE api_rate_limit_buckets.window_started_at
          END,
          expires_at = CASE
            WHEN api_rate_limit_buckets.expires_at <= statement_timestamp()
              THEN statement_timestamp() + (${windowSeconds} * interval '1 second')
            ELSE api_rate_limit_buckets.expires_at
          END
        RETURNING
          request_count::text AS request_count,
          ceil(extract(epoch FROM expires_at))::bigint::text AS reset_at,
          greatest(
            0,
            ceil(extract(epoch FROM (expires_at - statement_timestamp())))
          )::bigint::text AS retry_after
      `.execute(this.database);
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL returned no rate-limit row");

      const currentCount = Number(row.request_count);
      const resetAt = Number(row.reset_at);
      const retryAfter = Number(row.retry_after);
      if (
        !Number.isSafeInteger(currentCount) ||
        !Number.isSafeInteger(resetAt) ||
        !Number.isSafeInteger(retryAfter)
      ) {
        throw new Error("PostgreSQL returned an invalid rate-limit result");
      }

      return {
        allowed: currentCount <= limit,
        currentCount,
        limit,
        resetAt,
        retryAfter,
      };
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "PostgreSQL rate-limit increment failed",
      );
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await sql`DELETE FROM api_rate_limit_buckets WHERE bucket_key = ${key}`.execute(
        this.database,
      );
    } catch (error) {
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await sql`DELETE FROM api_rate_limit_buckets`.execute(this.database);
    } catch (error) {
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
    }
  }

  /** Delete at most one configured batch, safely shared across replicas. */
  cleanupExpiredBuckets(): Promise<number> {
    if (this.cleanupInFlight) return this.cleanupInFlight;
    const cleanup = (async () => {
      const result = await sql`
        WITH expired AS (
          SELECT bucket_key
          FROM api_rate_limit_buckets
          WHERE expires_at <= statement_timestamp()
          ORDER BY expires_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.cleanupBatchSize}
        )
        DELETE FROM api_rate_limit_buckets AS buckets
        USING expired
        WHERE buckets.bucket_key = expired.bucket_key
      `.execute(this.database);
      return Number(result.numAffectedRows ?? 0);
    })();
    this.cleanupInFlight = cleanup;
    const clearInFlight = () => {
      if (this.cleanupInFlight === cleanup) this.cleanupInFlight = undefined;
    };
    void cleanup.then(clearInFlight, clearInFlight);
    return cleanup;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await sql`SELECT 1 FROM api_rate_limit_buckets LIMIT 1`.execute(
        this.database,
      );
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    try {
      await this.cleanupInFlight;
    } catch {
      // A failed cleanup was already logged and must not block shutdown.
    }
  }

  private scheduleCleanup(): void {
    if (this.closed) return;
    this.cleanupTimer = setTimeout(() => {
      void this.cleanupExpiredBuckets()
        .catch((error) => {
          logger.warn(
            { err: formatError(error) },
            "PostgreSQL rate-limit cleanup failed",
          );
        })
        .finally(() => this.scheduleCleanup());
    }, this.cleanupIntervalSeconds * 1000);
    this.cleanupTimer.unref?.();
  }
}

/**
 * Type definition for Redis client (ioredis)
 * We use dynamic import to make Redis an optional dependency
 */
interface RedisClient {
  ping(): Promise<string>;
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
  exec(): Promise<Array<[Error | null, unknown] | null>>;
  length: number;
}

function assertRedisPipelineSucceeded(
  results: Array<[Error | null, unknown] | null>,
): void {
  for (const result of results) {
    if (!result) throw new Error("Redis pipeline returned no command result");
    if (result[0]) throw result[0];
  }
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

      const Redis = redisModule.default as unknown as new (
        url: string,
        options: {
          maxRetriesPerRequest: number;
          retryStrategy: (times: number) => number | null;
        },
      ) => RedisClient;
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
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
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
    assertRateLimitArguments(limit, windowSeconds);
    await this.ensureConnected();

    if (!this.client) {
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
      );
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
        assertRedisPipelineSucceeded(await pipeline.exec());

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
        assertRedisPipelineSucceeded(await pipeline.exec());

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
      logger.error(
        { err: formatError(error) },
        "Redis rate-limit increment failed",
      );
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
    }
  }

  /**
   * Reset a specific key's counter
   */
  async reset(key: string): Promise<void> {
    await this.ensureConnected();

    if (!this.client) {
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
      );
    }

    const countKey = `ratelimit:${key}:count`;
    const startKey = `ratelimit:${key}:start`;

    try {
      await this.client.del(countKey, startKey);
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "Redis rate-limit reset failed",
      );
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
    }
  }

  /**
   * Clear all rate limit data
   * Uses SCAN to avoid blocking for large datasets
   */
  async clear(): Promise<void> {
    await this.ensureConnected();

    if (!this.client) {
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
      );
    }

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
        assertRedisPipelineSucceeded(await pipeline.exec());
      }
    } catch (error) {
      logger.error(
        { err: formatError(error) },
        "Redis rate-limit clear failed",
      );
      throw new RateLimitStoreUnavailableError(
        "The rate-limit service is temporarily unavailable",
        { cause: error },
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return (await this.client?.ping()) === "PONG";
    } catch {
      return false;
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
  if (config.store.type === "postgres") {
    return new PostgresRateLimitStore(
      db,
      config.store.postgresCleanupIntervalSeconds,
      config.store.postgresCleanupBatchSize,
    );
  }

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
