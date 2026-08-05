import { describe, expect, test } from "bun:test";
import { MemoryRateLimitStore } from "./rate-limit-store.js";

describe("MemoryRateLimitStore counting", () => {
  test("counts within a window and denies past the limit", async () => {
    const store = new MemoryRateLimitStore();

    const first = await store.increment("ip:1.2.3.4", 2, 60);
    expect(first).toMatchObject({ allowed: true, currentCount: 1, limit: 2 });

    expect(await store.increment("ip:1.2.3.4", 2, 60)).toMatchObject({
      allowed: true,
      currentCount: 2,
    });
    expect(await store.increment("ip:1.2.3.4", 2, 60)).toMatchObject({
      allowed: false,
      currentCount: 3,
    });
  });

  test("separate keys keep separate buckets", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("a", 1, 60);
    expect(await store.increment("b", 1, 60)).toMatchObject({ allowed: true });
    expect(store.size).toBe(2);
  });

  test("reset clears one bucket without disturbing the others", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("a", 1, 60);
    await store.increment("b", 1, 60);

    await store.reset("a");

    expect(store.size).toBe(1);
    expect(await store.increment("a", 1, 60)).toMatchObject({
      allowed: true,
      currentCount: 1,
    });
    expect(await store.increment("b", 1, 60)).toMatchObject({
      allowed: false,
      currentCount: 2,
    });
  });

  test("clear drops every bucket", async () => {
    const store = new MemoryRateLimitStore();
    await store.increment("a", 1, 60);
    await store.increment("b", 1, 60);

    await store.clear();

    expect(store.size).toBe(0);
    expect(await store.increment("a", 1, 60)).toMatchObject({
      currentCount: 1,
    });
  });

  test("a lapsed window starts a fresh count", async () => {
    const store = new MemoryRateLimitStore();
    // A zero-length window is already elapsed on the next call.
    await store.increment("a", 1, 0);
    expect(await store.increment("a", 1, 0)).toMatchObject({
      allowed: true,
      currentCount: 1,
    });
  });
});

describe("MemoryRateLimitStore LRU eviction", () => {
  test("never grows past maxItems", async () => {
    const store = new MemoryRateLimitStore(3);
    for (let i = 0; i < 50; i++) {
      await store.increment(`key-${i}`, 100, 60);
    }
    expect(store.size).toBe(3);
  });

  test("evicts the least recently used key, keeping refreshed ones", async () => {
    const store = new MemoryRateLimitStore(2);

    await store.increment("old", 100, 60);
    await store.increment("kept", 100, 60);
    // Touching "old" must move it ahead of "kept" in the eviction order.
    await store.increment("old", 100, 60);
    await store.increment("new", 100, 60);

    expect(store.size).toBe(2);
    // "old" survived with its accumulated count of 2 (asserted first, because
    // re-adding an evicted key would itself evict something).
    expect(await store.increment("old", 100, 60)).toMatchObject({
      currentCount: 3,
    });
    // "kept" was evicted, so its counter restarts at 1.
    expect(await store.increment("kept", 100, 60)).toMatchObject({
      currentCount: 1,
    });
  });

  test("eviction bookkeeping stays consistent across resets", async () => {
    // A stale parallel index would let size drift above maxItems here.
    const store = new MemoryRateLimitStore(2);
    await store.increment("a", 100, 60);
    await store.reset("a");
    await store.increment("b", 100, 60);
    await store.increment("c", 100, 60);
    await store.increment("d", 100, 60);

    expect(store.size).toBe(2);
  });
});
