import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CompanyWithRole } from "./types.js";

let calls = 0;
let resolveFetch: ((value: CompanyWithRole[]) => void) | null = null;

mock.module("./client.js", () => ({
  fetchWithAuth: () => {
    calls += 1;
    return new Promise<CompanyWithRole[]>((resolve) => {
      resolveFetch = resolve;
    });
  },
}));

const { getUserCompanies, prewarmUserCompanies } = await import(
  "./companies.js"
);

beforeEach(() => {
  calls = 0;
  resolveFetch = null;
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
