import { beforeEach, describe, expect, test } from "bun:test";
import {
  type CompanyMemberPermissions,
  getMembershipCacheTtlMs,
  MAX_CACHED_COMPANIES,
  setMembershipCacheTtlMs,
  getCompanyMemberPermissions,
  getMembershipCacheStats,
  invalidateAllCompanyMemberships,
  invalidateCompanyMembership,
  resetMembershipCache,
} from "./company-membership.service.js";
import { ROLE_PRESETS } from "./permission.service.js";

const COMPANY = "company-a";
const OTHER = "company-b";

function members(...userIds: string[]): CompanyMemberPermissions[] {
  return userIds.map((userId) => ({
    userId,
    permissions: ROLE_PRESETS.member,
  }));
}

/** A loader that records how many times it was actually consulted. */
function countingLoader(value: CompanyMemberPermissions[]) {
  let calls = 0;
  return {
    load: async () => {
      calls++;
      return value;
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * The cache exists to stop typing and presence from re-reading membership per
 * event. It must never delay a revocation: every `company_members` write calls
 * `invalidateCompanyMembership`, so these pin that the invalidation is what
 * provides correctness, not the TTL.
 */
describe("company membership cache", () => {
  beforeEach(() => {
    resetMembershipCache();
  });

  test("a repeated read consults the database once", async () => {
    const loader = countingLoader(members("u1"));
    await getCompanyMemberPermissions(COMPANY, loader.load);
    await getCompanyMemberPermissions(COMPANY, loader.load);
    await getCompanyMemberPermissions(COMPANY, loader.load);
    expect(loader.calls).toBe(1);
    // beforeEach resets the counters, so this delta is from zero.
    expect(getMembershipCacheStats().hits).toBe(2);
  });

  test("a burst of concurrent reads shares one query", async () => {
    // An inbound message storm looks exactly like this.
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      calls++;
      await gate;
      return members("u1");
    };

    const reads = Promise.all([
      getCompanyMemberPermissions(COMPANY, load),
      getCompanyMemberPermissions(COMPANY, load),
      getCompanyMemberPermissions(COMPANY, load),
    ]);
    release?.();
    await reads;
    expect(calls).toBe(1);
  });

  test("invalidation forces the very next read to hit the database", async () => {
    const first = countingLoader(members("u1"));
    await getCompanyMemberPermissions(COMPANY, first.load);

    invalidateCompanyMembership(COMPANY);

    const second = countingLoader(members("u1", "u2"));
    const value = await getCompanyMemberPermissions(COMPANY, second.load);
    expect(second.calls).toBe(1);
    expect(value.map((member) => member.userId)).toEqual(["u1", "u2"]);
  });

  test("a revoked member disappears immediately, not after the TTL", async () => {
    // The direction that matters for security.
    const before = countingLoader(members("kept", "revoked"));
    await getCompanyMemberPermissions(COMPANY, before.load);

    invalidateCompanyMembership(COMPANY);

    const after = countingLoader(members("kept"));
    const value = await getCompanyMemberPermissions(COMPANY, after.load);
    expect(value.map((member) => member.userId)).toEqual(["kept"]);
  });

  test("invalidating one workspace does not disturb another", async () => {
    const a = countingLoader(members("a1"));
    const b = countingLoader(members("b1"));
    await getCompanyMemberPermissions(COMPANY, a.load);
    await getCompanyMemberPermissions(OTHER, b.load);

    invalidateCompanyMembership(COMPANY);

    await getCompanyMemberPermissions(OTHER, b.load);
    expect(b.calls).toBe(1);
    await getCompanyMemberPermissions(COMPANY, a.load);
    expect(a.calls).toBe(2);
  });

  test("invalidateAll clears every workspace", async () => {
    const a = countingLoader(members("a1"));
    const b = countingLoader(members("b1"));
    await getCompanyMemberPermissions(COMPANY, a.load);
    await getCompanyMemberPermissions(OTHER, b.load);

    invalidateAllCompanyMemberships();

    await getCompanyMemberPermissions(COMPANY, a.load);
    await getCompanyMemberPermissions(OTHER, b.load);
    expect(a.calls).toBe(2);
    expect(b.calls).toBe(2);
  });

  test("an in-flight read started before a write cannot repopulate stale data", async () => {
    // Invalidation drops the pending promise too, so the write's reader is not
    // served a snapshot taken before the write.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = async () => {
      await gate;
      return members("revoked");
    };

    const pending = getCompanyMemberPermissions(COMPANY, stale);
    invalidateCompanyMembership(COMPANY);
    release?.();
    await pending;

    const fresh = countingLoader(members("kept"));
    const value = await getCompanyMemberPermissions(COMPANY, fresh.load);
    expect(fresh.calls).toBe(1);
    expect(value.map((member) => member.userId)).toEqual(["kept"]);
  });

  test("a failed read is not cached", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      if (calls === 1) throw new Error("postgres unavailable");
      return members("u1");
    };

    await expect(getCompanyMemberPermissions(COMPANY, load)).rejects.toThrow(
      "postgres unavailable",
    );
    expect(await getCompanyMemberPermissions(COMPANY, load)).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

/**
 * The cache must not accumulate workspaces a process merely touched once. It
 * reclaims an entry the moment it is observed expired, and hard-caps how many
 * it will hold at all.
 */
describe("company membership cache lifecycle", () => {
  beforeEach(() => {
    resetMembershipCache();
  });

  test("an expired entry is reclaimed rather than left occupying a slot", async () => {
    setMembershipCacheTtlMs(1);
    const loader = countingLoader(members("u1"));
    await getCompanyMemberPermissions(COMPANY, loader.load);
    expect(getMembershipCacheStats().size).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 5));

    // Reading a different workspace must not be what clears the stale one;
    // observing the expiry does.
    await getCompanyMemberPermissions(COMPANY, loader.load);
    expect(loader.calls).toBe(2);
    expect(getMembershipCacheStats().size).toBe(1);
  });

  test("a lapsed entry counts as a miss, not a hit", async () => {
    setMembershipCacheTtlMs(1);
    const loader = countingLoader(members("u1"));
    await getCompanyMemberPermissions(COMPANY, loader.load);
    const afterFirst = getMembershipCacheStats();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await getCompanyMemberPermissions(COMPANY, loader.load);

    expect(getMembershipCacheStats().misses).toBe(afterFirst.misses + 1);
    expect(getMembershipCacheStats().hits).toBe(afterFirst.hits);
  });

  test("never grows past the hard cap", async () => {
    const loader = countingLoader(members("u1"));
    for (let i = 0; i < MAX_CACHED_COMPANIES + 250; i++) {
      await getCompanyMemberPermissions(`company-${i}`, loader.load);
    }
    expect(getMembershipCacheStats().size).toBe(MAX_CACHED_COMPANIES);
  });

  test("a cache HIT does not protect an entry from eviction", async () => {
    // Pins the documented semantics: least-recently-REFRESHED, not true LRU.
    // If this ever changes to promote on hit, the doc comment must change too.
    setMembershipCacheTtlMs(60_000);
    const loader = countingLoader(members("u1"));
    await getCompanyMemberPermissions("read-often", loader.load);

    for (let i = 0; i < MAX_CACHED_COMPANIES; i++) {
      // Keep reading the first entry: under true LRU this would save it.
      await getCompanyMemberPermissions("read-often", loader.load);
      await getCompanyMemberPermissions(`filler-${i}`, loader.load);
    }

    const before = getMembershipCacheStats().misses;
    await getCompanyMemberPermissions("read-often", loader.load);
    expect(getMembershipCacheStats().misses).toBe(before + 1);
  });

  test("eviction drops the least recently refreshed workspace", async () => {
    // Deliberately tiny so the property is checked, not approximated.
    setMembershipCacheTtlMs(60_000);
    const loader = countingLoader(members("u1"));
    await getCompanyMemberPermissions("old", loader.load);
    await getCompanyMemberPermissions("kept", loader.load);

    for (let i = 0; i < MAX_CACHED_COMPANIES; i++) {
      await getCompanyMemberPermissions(`filler-${i}`, loader.load);
    }

    expect(getMembershipCacheStats().size).toBe(MAX_CACHED_COMPANIES);
    // "old" was pushed out; re-reading it is a miss.
    const before = getMembershipCacheStats().misses;
    await getCompanyMemberPermissions("old", loader.load);
    expect(getMembershipCacheStats().misses).toBe(before + 1);
  });

  test("disabling the TTL clears what is already cached", async () => {
    const loader = countingLoader(members("u1"));
    await getCompanyMemberPermissions(COMPANY, loader.load);
    expect(getMembershipCacheStats().size).toBe(1);

    setMembershipCacheTtlMs(0);

    expect(getMembershipCacheStats().size).toBe(0);
    await getCompanyMemberPermissions(COMPANY, loader.load);
    await getCompanyMemberPermissions(COMPANY, loader.load);
    expect(loader.calls).toBe(3);
  });

  test("resetting restores the configured TTL", () => {
    setMembershipCacheTtlMs(12_345);
    expect(getMembershipCacheTtlMs()).toBe(12_345);
    resetMembershipCache();
    expect(getMembershipCacheTtlMs()).not.toBe(12_345);
  });

  test("a workspace removed entirely stops being cached once invalidated", async () => {
    // Models deleting the last member: the loader returns nothing, and that
    // empty result must be what subsequent reads see.
    const populated = countingLoader(members("u1"));
    await getCompanyMemberPermissions(COMPANY, populated.load);

    invalidateCompanyMembership(COMPANY);

    const emptied = countingLoader([]);
    expect(await getCompanyMemberPermissions(COMPANY, emptied.load)).toEqual(
      [],
    );
    expect(await getCompanyMemberPermissions(COMPANY, emptied.load)).toEqual(
      [],
    );
    expect(emptied.calls).toBe(1);
  });
});
