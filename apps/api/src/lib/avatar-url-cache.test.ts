import { describe, expect, mock, test } from "bun:test";
import { createAvatarUrlSigner } from "./avatar-url-cache.js";

describe("avatar signature reuse", () => {
  test("coalesces concurrent signing and reuses a settled signature", async () => {
    const deferred = Promise.withResolvers<string>();
    const sign = mock(() => deferred.promise);
    const cached = createAvatarUrlSigner(sign, 300);
    const requests = Array.from({ length: 100 }, () =>
      cached("tenant-a/avatar"),
    );
    expect(new Set(requests).size).toBe(1);
    deferred.resolve("signed-url");
    expect(await Promise.all(requests)).toEqual(Array(100).fill("signed-url"));
    expect(await cached("tenant-a/avatar")).toBe("signed-url");
    expect(sign).toHaveBeenCalledTimes(1);
  });

  test("object keys, including tenant prefixes, never share signatures", async () => {
    const sign = mock(async (key: string) => `signed:${key}`);
    const cached = createAvatarUrlSigner(sign, 300);
    expect(await cached("tenant-a/avatar")).toBe("signed:tenant-a/avatar");
    expect(await cached("tenant-b/avatar")).toBe("signed:tenant-b/avatar");
    expect(await cached("tenant-a/new-avatar")).toBe(
      "signed:tenant-a/new-avatar",
    );
    expect(sign).toHaveBeenCalledTimes(3);
  });

  test("refreshes at one minute even when frequently accessed", async () => {
    let time = 0;
    let calls = 0;
    const cached = createAvatarUrlSigner(
      async () => `url-${++calls}`,
      300,
      () => time,
    );
    expect(await cached("avatar")).toBe("url-1");
    time = 59_999;
    expect(await cached("avatar")).toBe("url-1");
    time = 60_000;
    expect(await cached("avatar")).toBe("url-2");
  });

  test("shorter configured lifetimes keep a 30-second expiry margin", async () => {
    let time = 0;
    let calls = 0;
    const cached = createAvatarUrlSigner(
      async () => `url-${++calls}`,
      45,
      () => time,
    );
    expect(await cached("avatar")).toBe("url-1");
    time = 14_999;
    expect(await cached("avatar")).toBe("url-1");
    time = 15_000;
    expect(await cached("avatar")).toBe("url-2");
  });

  test.each([1, 15, 30])(
    "does not cache a %i-second signature",
    async (lifetime) => {
      const sign = mock(async () => "url");
      const cached = createAvatarUrlSigner(sign, lifetime);
      await cached("avatar");
      await cached("avatar");
      expect(sign).toHaveBeenCalledTimes(2);
    },
  );

  test("measures reuse from signing start, not slow signing completion", async () => {
    let time = 0;
    const deferred = Promise.withResolvers<string>();
    const sign = mock(() => deferred.promise);
    const cached = createAvatarUrlSigner(sign, 300, () => time);
    const first = cached("avatar");
    time = 61_000;
    deferred.resolve("url");
    await first;
    await cached("avatar");
    expect(sign).toHaveBeenCalledTimes(2);
  });

  test("does not retain failed signatures, including synchronous errors", async () => {
    let calls = 0;
    const cached = createAvatarUrlSigner(() => {
      if (++calls === 1) throw new Error("signing failed");
      return Promise.resolve("recovered-url");
    }, 300);
    const results = await Promise.allSettled([
      cached("avatar"),
      cached("avatar"),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(calls).toBe(1);
    expect(await cached("avatar")).toBe("recovered-url");
    expect(calls).toBe(2);
  });

  test("an expired failed request cannot evict its replacement", async () => {
    let time = 0;
    const deferred = Promise.withResolvers<string>();
    const sign = mock(() => deferred.promise);
    const cached = createAvatarUrlSigner(sign, 300, () => time);
    const first = cached("avatar");
    const failed = Promise.allSettled([first]);
    await Promise.resolve();
    time = 60_000;
    sign.mockImplementation(async () => "replacement");
    expect(await cached("avatar")).toBe("replacement");
    deferred.reject(new Error("old signing failed"));
    await failed;
    expect(await cached("avatar")).toBe("replacement");
    expect(sign).toHaveBeenCalledTimes(2);
  });

  test("bounds retained URLs and evicts the least recently used key", async () => {
    const sign = mock(async (key: string) => `url:${key}`);
    const cached = createAvatarUrlSigner(sign, 300);
    await Promise.all(
      Array.from({ length: 1_024 }, (_, i) => cached(String(i))),
    );
    await cached("0"); // Keep the oldest key hot, so key 1 should be evicted.
    await cached("new");
    await cached("0");
    expect(sign).toHaveBeenCalledTimes(1_025);
    await cached("1");
    expect(sign).toHaveBeenCalledTimes(1_026);
  });
});
