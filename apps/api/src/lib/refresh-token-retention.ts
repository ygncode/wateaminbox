import type { RetiredRefreshToken } from "@wateaminbox/database";

/**
 * Per-session retention of just-superseded refresh-token hashes.
 *
 * A refresh token is single-use: `refreshSession` replaces the stored hash on
 * every rotation, so a client presenting a hash the session has already moved
 * past cannot refresh again and is returned to the login screen. That is the
 * correct response to a replayed token, but two benign races look identical
 * from the server:
 *
 * 1. A response lost in transit. The rotation committed and the reply never
 *    arrived - a container replaced mid-request during a deployment, a dropped
 *    connection, a proxy reset. The browser still holds the retired token.
 * 2. Two tabs refreshing at the same moment. The client coalesces concurrent
 *    refreshes within one document, but `refreshPromise` is module state and
 *    does not span tabs, so the second tab presents the token the first tab
 *    just retired.
 *
 * Both are availability failures rather than compromises, and both cost the
 * user a real re-login. Retaining the hashes for a bounded window lets the
 * retry converge instead.
 *
 * Tradeoff, stated plainly: within the window a stolen retired token is
 * accepted, where strict single-use rotation would have rejected it. The
 * window is bounded twice over - by `JWT_REFRESH_REUSE_GRACE_SECONDS` from the
 * rotation that superseded the hash, and by
 * {@link MAX_RETAINED_REFRESH_TOKENS} entries - and an entry's deadline is
 * set once and never extended, so repeated retries cannot widen it. Outside
 * the window, replay rejection is unchanged.
 *
 * These helpers are pure so the retention policy is testable without a
 * database.
 */

/**
 * Cap on retained hashes per session.
 *
 * Every rotation retires exactly one hash, so this bounds how many distinct
 * stale tokens a client may still be holding. Five covers the realistic
 * multi-tab case; the entry that falls off the end is the oldest one, which
 * is also the one closest to expiring on its own.
 */
export const MAX_RETAINED_REFRESH_TOKENS = 5;

function parseEntry(value: unknown): RetiredRefreshToken | null {
  if (typeof value !== "object" || value === null) return null;
  const { hash, expiresAt } = value as Record<string, unknown>;
  if (typeof hash !== "string" || hash.length === 0) return null;
  if (typeof expiresAt !== "string") return null;
  if (Number.isNaN(Date.parse(expiresAt))) return null;
  return { hash, expiresAt };
}

/**
 * Read the stored column defensively.
 *
 * This is a JSONB column, so a partial write, a hand-edited row, or an older
 * client could put anything in it. A malformed entry is dropped rather than
 * allowed to throw: the cost of dropping it is one user re-login, and the cost
 * of throwing is every refresh for that session failing until someone
 * intervenes.
 */
export function readRetiredRefreshTokens(
  value: unknown,
): RetiredRefreshToken[] {
  if (!Array.isArray(value)) return [];
  const entries: RetiredRefreshToken[] = [];
  for (const item of value) {
    const entry = parseEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Drop entries whose window has closed.
 *
 * `nowMs` is compared against each entry's own deadline, so pruning never
 * extends a window.
 */
export function pruneRetiredRefreshTokens(
  entries: readonly RetiredRefreshToken[],
  nowMs: number,
): RetiredRefreshToken[] {
  return entries.filter((entry) => Date.parse(entry.expiresAt) > nowMs);
}

/** Whether a presented hash is retired but still inside its grace window. */
export function isRetiredRefreshTokenAccepted(
  entries: readonly RetiredRefreshToken[],
  presentedHash: string,
  nowMs: number,
): boolean {
  return entries.some(
    (entry) =>
      entry.hash === presentedHash && Date.parse(entry.expiresAt) > nowMs,
  );
}

/**
 * Build the next retention list for a rotation that supersedes `retiredHash`.
 *
 * Entries are pruned first so the cap applies to live entries only, then the
 * hash being replaced is appended with a fresh deadline. Only the hash being
 * superseded right now gets that deadline; existing entries keep theirs.
 *
 * A grace of `0` stops new retirements, so strict single-use rotation resumes
 * as the entries already recorded expire on their own deadlines. Existing
 * entries are still pruned by expiry rather than dropped outright, so
 * narrowing the setting never invalidates a client that is mid-retry.
 */
export function retainSupersededRefreshToken(
  entries: readonly RetiredRefreshToken[],
  retiredHash: string,
  nowMs: number,
  graceMs: number,
): RetiredRefreshToken[] {
  const live = pruneRetiredRefreshTokens(entries, nowMs);
  if (graceMs <= 0) return live;

  live.push({
    hash: retiredHash,
    expiresAt: new Date(nowMs + graceMs).toISOString(),
  });

  return live.slice(-MAX_RETAINED_REFRESH_TOKENS);
}
