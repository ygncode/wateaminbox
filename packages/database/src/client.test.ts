import { describe, expect, test } from "bun:test";
import { createDatabase } from "./client.js";

describe("database pool configuration", () => {
  test("accepts bounded per-process pools", async () => {
    const database = createDatabase("postgresql://unused.invalid/test", 5);
    await database.destroy();
  });

  test.each([
    0,
    51,
    1.5,
    Number.MAX_SAFE_INTEGER,
  ])("rejects invalid pool maximum %s", (maximum) => {
    expect(() =>
      createDatabase("postgresql://unused.invalid/test", maximum),
    ).toThrow(/between 1 and 50/);
  });
});
