import { describe, expect, test } from "bun:test";
import { getDateRange } from "./date";

describe("getDateRange", () => {
  test.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ] as const)("%s returns exactly %d calendar days", (range, days) => {
    const { start, end } = getDateRange(range);

    expect(end.startOf("day").diff(start, "day") + 1).toBe(days);
    expect(start.toISOString()).toBe(start.startOf("day").toISOString());
    expect(end.isAfter(start)).toBe(true);
  });
});
