import { hmacSha256 } from "../lib/crypto";

interface RateLimitRow {
  request_count: number;
  window_started_at: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

export function clientIp(request: Request): string {
  const value = request.headers.get("CF-Connecting-IP")?.trim();
  return value && value.length <= 64 ? value : "unknown";
}

export async function enforceRateLimit(
  db: D1Database,
  secret: string,
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowStartedAt = Math.floor(now / windowMs) * windowMs;
  const bucket = await hmacSha256(
    secret,
    `waitlist-rate-limit:v1:${scope}:${identifier}`,
  );
  const row = await db
    .prepare(
      `INSERT INTO waitlist_rate_limit_buckets (
         bucket, window_started_at, request_count, updated_at
       ) VALUES (?, ?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET
         request_count = CASE
           WHEN waitlist_rate_limit_buckets.window_started_at = excluded.window_started_at
           THEN waitlist_rate_limit_buckets.request_count + 1
           ELSE 1
         END,
         window_started_at = excluded.window_started_at,
         updated_at = excluded.updated_at
       RETURNING request_count, window_started_at`,
    )
    .bind(bucket, windowStartedAt, now)
    .first<RateLimitRow>();

  if (!row) {
    throw new Error("Rate limit counter did not return a row");
  }

  return {
    allowed: row.request_count <= limit,
    retryAfter: Math.max(
      1,
      Math.ceil((row.window_started_at + windowMs - now) / 1000),
    ),
  };
}
