import { describe, expect, test } from "bun:test";
import { invalidateNotificationQueries } from "./notification-realtime";

describe("notification realtime invalidation", () => {
  test("invalidates the canonical company notification prefix", async () => {
    let key: readonly unknown[] | undefined;
    await invalidateNotificationQueries({
      invalidateQueries: ((filters: { queryKey?: readonly unknown[] }) => {
        key = filters.queryKey;
        return Promise.resolve();
      }) as never,
    });
    expect(key?.[0]).toBe("notifications");
  });
});
