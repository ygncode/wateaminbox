import { describe, expect, test } from "bun:test";
import {
  isStalePushError,
  removeStalePushSubscription,
} from "./web-push.service.js";

describe("Web Push stale subscription handling", () => {
  test("treats provider 404 and 410 responses as stale", () => {
    expect(isStalePushError({ statusCode: 404 })).toBe(true);
    expect(isStalePushError({ statusCode: 410 })).toBe(true);
    expect(isStalePushError({ statusCode: 500 })).toBe(false);
  });

  test("removes a subscription after 404/410 without throwing", async () => {
    let removed = false;
    expect(
      await removeStalePushSubscription({ statusCode: 410 }, async () => {
        removed = true;
      }),
    ).toBe(true);
    expect(removed).toBe(true);
  });
});
