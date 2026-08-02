import {
  base64UrlToBytes,
  derivePbkdf2Sha256,
  hmacSha256,
  randomToken,
  timingSafeEqual,
  timingSafeStringEqual,
} from "../lib/crypto";
import { ConfigurationError } from "../lib/errors";
import type { Env } from "../types";

const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const LOGIN_CSRF_TTL_MS = 1000 * 60 * 15;
const SESSION_TOUCH_INTERVAL_MS = 1000 * 60 * 15;
const ADMIN_SUBSCRIBER_PAGE_SIZE = 50;
const MAX_ADMIN_SUBSCRIBER_PAGE = 10_000;
const MAX_ADMIN_SUBSCRIBER_SEARCH_LENGTH = 254;

interface AdminSessionRow {
  expires_at: number;
  id: string;
  last_seen_at: number;
}

interface CountResult {
  count: number;
}

export interface AdminSession {
  expiresAt: number;
  id: string;
  lastSeenAt: number;
  token: string;
}

export interface AdminStats {
  confirmationEmailsSevenDays: number;
  confirmed: number;
  confirmedToday: number;
  conversionRate: number;
  expiredUnconfirmedTokens: number;
  pending: number;
  total: number;
}

export type AdminSubscriberStatus = "all" | "confirmed" | "pending";

export interface AdminSubscriberQuery {
  page: number;
  search: string;
  status: AdminSubscriberStatus;
}

export interface AdminSubscriber {
  confirmedAt: number | null;
  createdAt: number;
  email: string;
  status: "confirmed" | "pending";
}

export interface AdminSubscriberPage {
  page: number;
  pageSize: number;
  query: AdminSubscriberQuery;
  records: AdminSubscriber[];
  total: number;
  totalPages: number;
}

interface AdminSubscriberRow {
  confirmed_at: number | null;
  created_at: number;
  email: string;
  status: "confirmed" | "pending";
}

function parsePasswordHash(value: string): {
  digest: Uint8Array;
  iterations: number;
  salt: Uint8Array;
} {
  const [algorithm, iterationValue, saltValue, digestValue, ...extra] =
    value.split("$");
  const iterations = Number(iterationValue);

  if (
    algorithm !== "pbkdf2_sha256" ||
    extra.length > 0 ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 100_000
  ) {
    throw new ConfigurationError("ADMIN_PASSWORD_HASH has an invalid format");
  }

  try {
    const salt = base64UrlToBytes(saltValue);
    const digest = base64UrlToBytes(digestValue);
    if (salt.byteLength < 16 || digest.byteLength !== 32) {
      throw new Error("Invalid password hash length");
    }
    return { digest, iterations, salt };
  } catch {
    throw new ConfigurationError("ADMIN_PASSWORD_HASH has an invalid format");
  }
}

export async function verifyAdminPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(passwordHash);
  const derived = await derivePbkdf2Sha256(
    password,
    parsed.salt,
    parsed.iterations,
    parsed.digest.byteLength,
  );
  return timingSafeEqual(derived, parsed.digest);
}

export async function createLoginCsrf(
  secret: string,
  now = Date.now(),
): Promise<string> {
  const nonce = randomToken(18);
  const signature = await hmacSha256(
    secret,
    `waitlist-admin-login-csrf:v1:${nonce}:${now}`,
  );
  return `${nonce}.${now}.${signature}`;
}

export async function verifyLoginCsrf(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!value) {
    return false;
  }

  const [nonce, timestampValue, signature, ...extra] = value.split(".");
  const timestamp = Number(timestampValue);
  if (
    extra.length > 0 ||
    !nonce ||
    !signature ||
    !Number.isSafeInteger(timestamp) ||
    timestamp > now ||
    now - timestamp > LOGIN_CSRF_TTL_MS
  ) {
    return false;
  }

  const expected = await hmacSha256(
    secret,
    `waitlist-admin-login-csrf:v1:${nonce}:${timestamp}`,
  );
  return timingSafeStringEqual(signature, expected);
}

export async function sessionCsrf(
  secret: string,
  token: string,
  action: "logout",
): Promise<string> {
  return hmacSha256(
    secret,
    `waitlist-admin-session-csrf:v1:${action}:${token}`,
  );
}

async function sessionHash(secret: string, token: string): Promise<string> {
  return hmacSha256(secret, `waitlist-admin-session:v1:${token}`);
}

export async function createAdminSession(
  env: Env,
  sourceIp: string,
  now = Date.now(),
): Promise<AdminSession> {
  const token = randomToken();
  const [tokenHash, ipHash] = await Promise.all([
    sessionHash(env.ADMIN_SESSION_SECRET, token),
    hmacSha256(env.ADMIN_SESSION_SECRET, `waitlist-admin-ip:v1:${sourceIp}`),
  ]);
  const session: AdminSession = {
    expiresAt: now + ADMIN_SESSION_TTL_MS,
    id: crypto.randomUUID(),
    lastSeenAt: now,
    token,
  };

  await env.DB.prepare(
    `INSERT INTO waitlist_admin_sessions (
        id, token_hash, ip_hash, created_at, expires_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      session.id,
      tokenHash,
      ipHash,
      now,
      session.expiresAt,
      session.lastSeenAt,
    )
    .run();

  return session;
}

export async function readAdminSession(
  env: Env,
  token: string | undefined,
  now = Date.now(),
): Promise<AdminSession | null> {
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return null;
  }

  const hash = await sessionHash(env.ADMIN_SESSION_SECRET, token);
  const session = await env.DB.prepare(
    `SELECT id, expires_at, last_seen_at
       FROM waitlist_admin_sessions
       WHERE token_hash = ? AND expires_at > ?`,
  )
    .bind(hash, now)
    .first<AdminSessionRow>();

  if (!session) {
    return null;
  }

  if (now - session.last_seen_at > SESSION_TOUCH_INTERVAL_MS) {
    await env.DB.prepare(
      "UPDATE waitlist_admin_sessions SET last_seen_at = ? WHERE id = ?",
    )
      .bind(now, session.id)
      .run();
  }

  return {
    expiresAt: session.expires_at,
    id: session.id,
    lastSeenAt: now,
    token,
  };
}

export async function deleteAdminSession(
  env: Env,
  token: string | undefined,
): Promise<void> {
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return;
  }

  const hash = await sessionHash(env.ADMIN_SESSION_SECRET, token);
  await env.DB.prepare(
    "DELETE FROM waitlist_admin_sessions WHERE token_hash = ?",
  )
    .bind(hash)
    .run();
}

function count(result: { results: unknown[] }): number {
  const row = result.results[0] as CountResult | undefined;
  return Number(row?.count ?? 0);
}

export function parseAdminSubscriberQuery(input: {
  page?: string;
  search?: string;
  status?: string;
}): AdminSubscriberQuery {
  const page =
    input.page && /^[1-9]\d{0,4}$/.test(input.page)
      ? Math.min(Number(input.page), MAX_ADMIN_SUBSCRIBER_PAGE)
      : 1;
  const status: AdminSubscriberStatus =
    input.status === "confirmed" || input.status === "pending"
      ? input.status
      : "all";

  return {
    page,
    search: (input.search ?? "")
      .trim()
      .slice(0, MAX_ADMIN_SUBSCRIBER_SEARCH_LENGTH),
    status,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function subscriberFilters(query: AdminSubscriberQuery): {
  sql: string;
  values: unknown[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (query.status !== "all") {
    clauses.push("status = ?");
    values.push(query.status);
  }
  if (query.search) {
    clauses.push("email COLLATE NOCASE LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLikePattern(query.search)}%`);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function getAdminSubscriberPage(
  db: D1Database,
  query: AdminSubscriberQuery,
): Promise<AdminSubscriberPage> {
  const filters = subscriberFilters(query);
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM waitlist_subscribers
       ${filters.sql}`,
    )
    .bind(...filters.values)
    .first<CountResult>();
  const total = safeCount(Number(totalRow?.count ?? 0));
  const totalPages = Math.ceil(total / ADMIN_SUBSCRIBER_PAGE_SIZE);
  const page =
    totalPages === 0 ? 1 : Math.min(query.page, Math.max(totalPages, 1));
  const offset = (page - 1) * ADMIN_SUBSCRIBER_PAGE_SIZE;
  const result = await db
    .prepare(
      `SELECT email, status, created_at, confirmed_at
       FROM waitlist_subscribers
       ${filters.sql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...filters.values, ADMIN_SUBSCRIBER_PAGE_SIZE, offset)
    .all<AdminSubscriberRow>();

  return {
    page,
    pageSize: ADMIN_SUBSCRIBER_PAGE_SIZE,
    query,
    records: result.results.map((row) => ({
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
      email: row.email,
      status: row.status,
    })),
    total,
    totalPages,
  };
}

export async function getAdminStats(
  db: D1Database,
  now = Date.now(),
): Promise<AdminStats> {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const oneWeekAgo = now - 1000 * 60 * 60 * 24 * 7;
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM waitlist_subscribers"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM waitlist_subscribers WHERE status = 'confirmed'",
    ),
    db.prepare(
      "SELECT COUNT(*) AS count FROM waitlist_subscribers WHERE status = 'pending'",
    ),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM waitlist_subscribers
         WHERE confirmed_at >= ?`,
      )
      .bind(startOfToday.getTime()),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM waitlist_confirmation_tokens
         WHERE email_sent_at >= ?`,
      )
      .bind(oneWeekAgo),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM waitlist_confirmation_tokens AS token
         JOIN waitlist_subscribers AS subscriber
           ON subscriber.id = token.subscriber_id
         WHERE token.expires_at < ?
           AND token.used_at IS NULL
           AND subscriber.status = 'pending'`,
      )
      .bind(now),
  ]);

  const total = count(results[0]);
  const confirmed = count(results[1]);

  return {
    confirmationEmailsSevenDays: count(results[4]),
    confirmed,
    confirmedToday: count(results[3]),
    conversionRate:
      total === 0 ? 0 : Math.round((confirmed / total) * 1000) / 10,
    expiredUnconfirmedTokens: count(results[5]),
    pending: count(results[2]),
    total,
  };
}
