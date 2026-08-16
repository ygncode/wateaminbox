import { describe, expect, test } from "bun:test";
import { getPurgeCleanupRetryDelayMs } from "./connection-purge-cleanup.service.js";

describe("purge cleanup retry backoff", () => {
  test("waits a minute before the first retry and doubles from there", () => {
    expect(getPurgeCleanupRetryDelayMs(0)).toBe(60_000);
    expect(getPurgeCleanupRetryDelayMs(1)).toBe(120_000);
    expect(getPurgeCleanupRetryDelayMs(4)).toBe(960_000);
  });

  test("stops doubling at a day so a permanently broken item still retries", () => {
    expect(getPurgeCleanupRetryDelayMs(8)).toBe(15_360_000);
    expect(getPurgeCleanupRetryDelayMs(9)).toBe(30_720_000);
    expect(getPurgeCleanupRetryDelayMs(11)).toBe(86_400_000);
    expect(getPurgeCleanupRetryDelayMs(1_000)).toBe(86_400_000);
  });

  test("treats a missing or negative attempt count as the first try", () => {
    expect(getPurgeCleanupRetryDelayMs(-1)).toBe(60_000);
  });
});
