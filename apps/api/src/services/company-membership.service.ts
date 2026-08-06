/**
 * Cached workspace membership for realtime fan-out.
 *
 * Every conversation-scoped realtime event resolves its recipients from two
 * facts: who is in the workspace and what they may see (membership), and who
 * currently holds the contact's assignment. Typing and presence fire far more
 * often than either fact changes, so re-reading membership per event is pure
 * overhead.
 *
 * Only the MEMBERSHIP half is cached here. Assignments stay live because they
 * change constantly and are the per-conversation half of the authorization
 * decision - see `resolveContactViewerIds`.
 *
 * The cache does not widen the permission-revocation window in the supported
 * single-API topology: every write to `company_members` calls
 * `invalidateCompanyMembership`, so a role change, permission edit, removal,
 * invitation acceptance, or ownership transfer takes effect on the very next
 * event. The short TTL is a backstop for anything that mutates the table
 * outside those paths, not the primary correctness mechanism.
 *
 * MULTI-REPLICA CAVEAT: invalidation is in-process. A second API replica keeps
 * serving its own cached copy until its TTL lapses, so a revocation can lag by
 * up to `REALTIME_MEMBERSHIP_CACHE_TTL_MS` there. This mirrors the existing
 * in-memory rate-limit caveat in the README. Set the TTL to 0 to disable
 * caching entirely and read membership live on every event.
 */

import { db } from "@wateaminbox/database";
import { env } from "../lib/env.js";
import {
  getEffectivePermissions,
  type MemberPermissions,
} from "./permission.service.js";

export interface CompanyMemberPermissions {
  userId: string;
  permissions: MemberPermissions;
}

interface CacheEntry {
  value: CompanyMemberPermissions[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CompanyMemberPermissions[]>>();

/**
 * Hard ceiling on cached workspaces.
 *
 * Entries are reclaimed on expiry, but a process that touches an unbounded
 * number of workspaces between reads would still accumulate them.
 *
 * Eviction is least-recently-REFRESHED, deliberately not true LRU: a cache
 * HIT does not move the entry, only a store does. Promoting on every hit would
 * add a Map delete+insert to the hottest path in the system (typing and
 * presence resolve through here) to improve a policy that only engages once a
 * single process has touched 5000 workspaces between refreshes - which the
 * supported single-host topology never approaches. The cost of getting it
 * "wrong" is one extra query after an eviction, so the trade is firmly in
 * favour of the cheaper read path. `MAX_CACHED_COMPANIES` is a memory
 * backstop, not a tuning knob, which is why it is a constant rather than
 * configuration: an operator has no information with which to pick a better
 * value, and a too-small one would silently defeat the cache.
 */
export const MAX_CACHED_COMPANIES = 5_000;

/**
 * Effective TTL. Initialized from configuration and adjustable at runtime,
 * matching `setMessageCleanupConfig`. Tests use the setter instead of mutating
 * the shared `env` object, which would leak into every other test file.
 */
let ttlMs = env.REALTIME_MEMBERSHIP_CACHE_TTL_MS;

/** Current cache TTL in milliseconds; 0 disables caching. */
export function getMembershipCacheTtlMs(): number {
  return ttlMs;
}

/** Override the cache TTL. Pass 0 to read membership live on every event. */
export function setMembershipCacheTtlMs(value: number): void {
  ttlMs = value;
  if (value <= 0) {
    cache.clear();
    inFlight.clear();
  }
}

/** Counters for tests and operational visibility. */
let hits = 0;
let misses = 0;
let invalidations = 0;

export function getMembershipCacheStats(): {
  hits: number;
  misses: number;
  invalidations: number;
  size: number;
  ttlMs: number;
} {
  return {
    hits,
    misses,
    invalidations,
    size: cache.size,
    ttlMs,
  };
}

async function loadCompanyMembers(
  companyId: string,
): Promise<CompanyMemberPermissions[]> {
  const members = await db
    .selectFrom("company_members")
    .select(["user_id", "role", "permissions"])
    .where("company_id", "=", companyId)
    .execute();

  return members.map((member) => ({
    userId: member.user_id,
    permissions: getEffectivePermissions(
      member.role as "owner" | "admin" | "member",
      (member.permissions ?? {}) as Partial<MemberPermissions>,
    ),
  }));
}

function storeCacheEntry(
  companyId: string,
  value: CompanyMemberPermissions[],
  ttl: number,
): void {
  // Re-insert so the Map's iteration order is least-recently-refreshed first.
  cache.delete(companyId);
  cache.set(companyId, { value, expiresAt: Date.now() + ttl });
  while (cache.size > MAX_CACHED_COMPANIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Members of a workspace with their effective permissions.
 *
 * Concurrent callers share one query: a burst of events for the same workspace
 * - which is exactly what an inbound message storm looks like - collapses to a
 * single read rather than one per event.
 */
export async function getCompanyMemberPermissions(
  companyId: string,
  load: (id: string) => Promise<CompanyMemberPermissions[]> = loadCompanyMembers,
): Promise<CompanyMemberPermissions[]> {
  const ttl = ttlMs;
  if (ttl <= 0) {
    misses++;
    return load(companyId);
  }

  const now = Date.now();
  const cached = cache.get(companyId);
  if (cached) {
    if (cached.expiresAt > now) {
      hits++;
      return cached.value;
    }
    // Reclaim on observation: a workspace that goes quiet after its entry
    // lapses would otherwise occupy a slot until the size cap forced it out.
    cache.delete(companyId);
  }

  const pending = inFlight.get(companyId);
  if (pending) {
    hits++;
    return pending;
  }

  misses++;
  const request: Promise<CompanyMemberPermissions[]> = load(companyId)
    .then((value) => {
      // The in-flight slot doubles as the "still valid" marker. Invalidation
      // removes it, so a read that started before a write cannot store its
      // now-stale result afterwards and delay the revocation.
      if (inFlight.get(companyId) === request) {
        storeCacheEntry(companyId, value, ttl);
      }
      return value;
    })
    .finally(() => {
      // A failure must not be cached; the next event retries. Only clear the
      // slot if it is still ours - an invalidation may have replaced it.
      if (inFlight.get(companyId) === request) inFlight.delete(companyId);
    });

  inFlight.set(companyId, request);
  return request;
}

/**
 * Drop a workspace's cached membership.
 *
 * Call this from every path that changes who is a member or what they may do.
 * Dropping the in-flight promise too is what stops a read that started before
 * the write from repopulating the cache with pre-write data afterwards.
 */
export function invalidateCompanyMembership(companyId: string): void {
  invalidations++;
  cache.delete(companyId);
  inFlight.delete(companyId);
}

/** Drop every workspace's cached membership. */
export function invalidateAllCompanyMemberships(): void {
  invalidations++;
  cache.clear();
  inFlight.clear();
}

/** Test seam: clear cache and counters. */
export function resetMembershipCache(): void {
  cache.clear();
  inFlight.clear();
  ttlMs = env.REALTIME_MEMBERSHIP_CACHE_TTL_MS;
  hits = 0;
  misses = 0;
  invalidations = 0;
}
