import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getUserCompanies, prewarmUserCompanies } from "./companies.js";
import type { CompanyWithRole } from "./types.js";

// Stub fetch rather than mock the client module: `mock.module` is process-wide
// in bun and leaks a never-resolving fetchWithAuth into every later test file
// that imports the client (the quick-replies suite timed out in CI from it).
const originalFetch = globalThis.fetch;
let calls = 0;
let resolveFetch: ((value: CompanyWithRole[]) => void) | null = null;

beforeEach(() => {
  calls = 0;
  resolveFetch = null;
  globalThis.fetch = (async () => {
    calls += 1;
    const body = await new Promise<CompanyWithRole[]>((resolve) => {
      resolveFetch = resolve;
    });
    return Response.json(body);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getUserCompanies coalescing", () => {
  test("concurrent callers share one in-flight request", async () => {
    const a = getUserCompanies();
    const b = getUserCompanies();
    expect(calls).toBe(1);
    resolveFetch?.([]);
    // Both callers resolve from the same request.
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
  });

  test("a prewarm lets a later consumer attach to the same request", async () => {
    prewarmUserCompanies();
    const consumer = getUserCompanies();
    // Only the prewarm's request is in flight; the consumer reuses it.
    expect(calls).toBe(1);
    resolveFetch?.([]);
    await consumer;
  });

  test("after settling, a new call fetches fresh (no stale cache)", async () => {
    const first = getUserCompanies();
    resolveFetch?.([]);
    await first;
    void getUserCompanies();
    expect(calls).toBe(2);
  });
});
