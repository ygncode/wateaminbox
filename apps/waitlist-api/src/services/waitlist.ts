import { hmacSha256, randomToken } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import type { RuntimeConfig } from "../lib/config";
import { confirmationEmail } from "../templates/confirmation-email";
import type { Env } from "../types";

const CONFIRMATION_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const IDEMPOTENCY_STALE_MS = 1000 * 45;
const IDEMPOTENCY_TTL_MS = 1000 * 60 * 10;
const RESEND_COOLDOWN_MS = 1000 * 60 * 10;

export const acceptedSignupResponse = {
  message:
    "Check your inbox to confirm your place on the WATeamInbox Cloud waitlist.",
};

interface SubscriberRow {
  id: string;
  status: "pending" | "confirmed";
}

interface IdempotencyRow {
  completed_at: number | null;
  created_at: number;
  expires_at: number;
  request_hash: string;
  response_body: string | null;
  response_code: number | null;
}

interface ConfirmationTokenRow {
  expires_at: number;
  used_at: number | null;
}

interface ResultWithChanges {
  meta: { changes?: number };
}

export type IdempotencyState =
  | { keyHash: string; requestHash: string; type: "acquired" }
  | { type: "conflict" }
  | { type: "in_progress" }
  | { body: Record<string, string>; status: number; type: "replay" };

export type SignupPreparation =
  | { type: "already-confirmed" | "cooldown" }
  | {
      email: string;
      subscriberId: string;
      token: string;
      tokenId: string;
      type: "send-confirmation";
    };

function changes(result: ResultWithChanges): number {
  return result.meta.changes ?? 0;
}

function responseFromRow(row: IdempotencyRow): {
  body: Record<string, string>;
  status: number;
} {
  try {
    const body = JSON.parse(row.response_body ?? "") as Record<string, string>;
    return {
      body,
      status: row.response_code ?? 202,
    };
  } catch {
    return {
      body: acceptedSignupResponse,
      status: 202,
    };
  }
}

async function readIdempotency(
  db: D1Database,
  keyHash: string,
): Promise<IdempotencyRow | null> {
  return db
    .prepare(
      `SELECT request_hash, response_code, response_body, created_at, expires_at,
              completed_at
       FROM waitlist_idempotency_keys
       WHERE key_hash = ?`,
    )
    .bind(keyHash)
    .first<IdempotencyRow>();
}

export async function acquireIdempotency(
  env: Env,
  key: string,
  email: string,
  now = Date.now(),
): Promise<IdempotencyState> {
  const [keyHash, requestHash] = await Promise.all([
    hmacSha256(env.WAITLIST_TOKEN_SECRET, `waitlist-idempotency:v1:${key}`),
    hmacSha256(env.WAITLIST_TOKEN_SECRET, `waitlist-request:v1:${email}`),
  ]);
  const existing = await readIdempotency(env.DB, keyHash);

  if (existing && existing.expires_at > now) {
    if (existing.request_hash !== requestHash) {
      return { type: "conflict" };
    }

    if (existing.completed_at && existing.response_body) {
      const response = responseFromRow(existing);
      return { ...response, type: "replay" };
    }

    if (existing.created_at > now - IDEMPOTENCY_STALE_MS) {
      return { type: "in_progress" };
    }

    const takeover = await env.DB.prepare(
      `UPDATE waitlist_idempotency_keys
         SET created_at = ?, expires_at = ?
         WHERE key_hash = ? AND completed_at IS NULL AND created_at <= ?`,
    )
      .bind(now, now + IDEMPOTENCY_TTL_MS, keyHash, now - IDEMPOTENCY_STALE_MS)
      .run();

    if (changes(takeover) > 0) {
      return { keyHash, requestHash, type: "acquired" };
    }

    return { type: "in_progress" };
  }

  if (existing) {
    await env.DB.prepare(
      "DELETE FROM waitlist_idempotency_keys WHERE key_hash = ?",
    )
      .bind(keyHash)
      .run();
  }

  try {
    await env.DB.prepare(
      `INSERT INTO waitlist_idempotency_keys (
          key_hash, request_hash, created_at, expires_at
        ) VALUES (?, ?, ?, ?)`,
    )
      .bind(keyHash, requestHash, now, now + IDEMPOTENCY_TTL_MS)
      .run();
    return { keyHash, requestHash, type: "acquired" };
  } catch {
    const raced = await readIdempotency(env.DB, keyHash);
    if (raced?.request_hash === requestHash && raced.completed_at) {
      const response = responseFromRow(raced);
      return { ...response, type: "replay" };
    }
    return raced?.request_hash === requestHash
      ? { type: "in_progress" }
      : { type: "conflict" };
  }
}

export async function completeIdempotency(
  env: Env,
  state: Extract<IdempotencyState, { type: "acquired" }>,
  now = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE waitlist_idempotency_keys
       SET response_code = ?, response_body = ?, completed_at = ?
       WHERE key_hash = ? AND request_hash = ?`,
  )
    .bind(
      202,
      JSON.stringify(acceptedSignupResponse),
      now,
      state.keyHash,
      state.requestHash,
    )
    .run();
}

export async function releaseIdempotency(
  env: Env,
  state: Extract<IdempotencyState, { type: "acquired" }>,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM waitlist_idempotency_keys
       WHERE key_hash = ? AND request_hash = ? AND completed_at IS NULL`,
  )
    .bind(state.keyHash, state.requestHash)
    .run();
}

async function createToken(secret: string): Promise<{
  token: string;
  tokenHash: string;
}> {
  const token = randomToken();
  const tokenHash = await hmacSha256(
    secret,
    `waitlist-confirmation-token:v1:${token}`,
  );
  return { token, tokenHash };
}

function isUniqueError(error: unknown): boolean {
  return String(error).includes("UNIQUE constraint failed");
}

export async function prepareSignup(
  env: Env,
  email: string,
  now = Date.now(),
  retryOnUnique = true,
): Promise<SignupPreparation> {
  const subscriber = await env.DB.prepare(
    "SELECT id, status FROM waitlist_subscribers WHERE email = ?",
  )
    .bind(email)
    .first<SubscriberRow>();

  if (!subscriber) {
    const subscriberId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const { token, tokenHash } = await createToken(env.WAITLIST_TOKEN_SECRET);

    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO waitlist_subscribers (
              id, email, status, created_at, updated_at,
              last_confirmation_requested_at
            ) VALUES (?, ?, 'pending', ?, ?, ?)`,
        ).bind(subscriberId, email, now, now, now),
        env.DB.prepare(
          `INSERT INTO waitlist_confirmation_tokens (
              id, subscriber_id, token_hash, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          tokenId,
          subscriberId,
          tokenHash,
          now,
          now + CONFIRMATION_TTL_MS,
        ),
      ]);
    } catch (error) {
      if (retryOnUnique && isUniqueError(error)) {
        return prepareSignup(env, email, now, false);
      }
      throw error;
    }

    return {
      email,
      subscriberId,
      token,
      tokenId,
      type: "send-confirmation",
    };
  }

  if (subscriber.status === "confirmed") {
    return { type: "already-confirmed" };
  }

  const tokenId = crypto.randomUUID();
  const { token, tokenHash } = await createToken(env.WAITLIST_TOKEN_SECRET);
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO waitlist_confirmation_tokens (
          id, subscriber_id, token_hash, created_at, expires_at
        ) SELECT ?, id, ?, ?, ?
          FROM waitlist_subscribers
          WHERE id = ?
            AND status = 'pending'
            AND (
              last_confirmation_requested_at IS NULL OR
              last_confirmation_requested_at <= ?
            )`,
    ).bind(
      tokenId,
      tokenHash,
      now,
      now + CONFIRMATION_TTL_MS,
      subscriber.id,
      now - RESEND_COOLDOWN_MS,
    ),
    env.DB.prepare(
      `UPDATE waitlist_subscribers
         SET last_confirmation_requested_at = ?, updated_at = ?
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM waitlist_confirmation_tokens WHERE id = ?
           )`,
    ).bind(now, now, subscriber.id, tokenId),
  ]);

  if (changes(results[0] as ResultWithChanges) === 0) {
    return { type: "cooldown" };
  }

  return {
    email,
    subscriberId: subscriber.id,
    token,
    tokenId,
    type: "send-confirmation",
  };
}

function emailErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 100);
  }
  return "SEND_FAILED";
}

export async function sendConfirmation(
  env: Env,
  config: RuntimeConfig,
  preparation: Extract<SignupPreparation, { type: "send-confirmation" }>,
  now = Date.now(),
): Promise<void> {
  const confirmationUrl = new URL("/v1/waitlist/confirm", config.apiOrigin);
  confirmationUrl.searchParams.set("token", preparation.token);
  const mail = confirmationEmail(confirmationUrl.toString());

  try {
    const result = await env.EMAIL.send({
      from: config.fromEmail,
      html: mail.html,
      subject: mail.subject,
      text: mail.text,
      to: preparation.email,
    });

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE waitlist_confirmation_tokens
           SET email_sent_at = ?, email_message_id = ?, email_error_code = NULL
           WHERE id = ?`,
      ).bind(now, result.messageId, preparation.tokenId),
      env.DB.prepare(
        `UPDATE waitlist_subscribers
           SET last_confirmation_sent_at = ?, updated_at = ?
           WHERE id = ?`,
      ).bind(now, now, preparation.subscriberId),
    ]);
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE waitlist_confirmation_tokens
             SET email_error_code = ?
             WHERE id = ? AND email_sent_at IS NULL`,
      ).bind(emailErrorCode(error), preparation.tokenId),
      env.DB.prepare(
        `UPDATE waitlist_subscribers
             SET last_confirmation_requested_at = NULL, updated_at = ?
             WHERE id = ? AND last_confirmation_requested_at = ?`,
      ).bind(now, preparation.subscriberId, now),
    ]).catch(() => undefined);

    throw new HttpError(
      503,
      "We could not send that confirmation email just now. Please try again shortly.",
    );
  }
}

export async function confirmSignup(
  env: Env,
  token: string,
  now = Date.now(),
): Promise<"already-confirmed" | "confirmed" | "expired"> {
  const tokenHash = await hmacSha256(
    env.WAITLIST_TOKEN_SECRET,
    `waitlist-confirmation-token:v1:${token}`,
  );
  const marker = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE waitlist_confirmation_tokens
         SET used_at = ?, used_marker = ?
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    ).bind(now, marker, tokenHash, now),
    env.DB.prepare(
      `UPDATE waitlist_subscribers
         SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?),
             updated_at = ?
         WHERE id = (
           SELECT subscriber_id
           FROM waitlist_confirmation_tokens
           WHERE token_hash = ? AND used_marker = ?
         )`,
    ).bind(now, now, tokenHash, marker),
  ]);

  if (changes(results[0] as ResultWithChanges) > 0) {
    return "confirmed";
  }

  const existing = await env.DB.prepare(
    `SELECT token.expires_at, token.used_at
       FROM waitlist_confirmation_tokens AS token
       WHERE token.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<ConfirmationTokenRow>();

  if (existing?.used_at || (existing && existing.expires_at > now)) {
    return "already-confirmed";
  }

  return "expired";
}

export async function pruneExpired(
  env: Pick<Env, "DB">,
  now = Date.now(),
): Promise<void> {
  const thirtyDays = 1000 * 60 * 60 * 24 * 30;
  const sevenDays = 1000 * 60 * 60 * 24 * 7;

  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM waitlist_idempotency_keys WHERE expires_at < ?",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM waitlist_admin_sessions WHERE expires_at < ?",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM waitlist_rate_limit_buckets WHERE updated_at < ?",
    ).bind(now - sevenDays),
    env.DB.prepare(
      "DELETE FROM waitlist_confirmation_tokens WHERE expires_at < ?",
    ).bind(now - thirtyDays),
    env.DB.prepare(
      `DELETE FROM waitlist_subscribers
         WHERE status = 'pending' AND updated_at < ?`,
    ).bind(now - thirtyDays),
  ]);
}
