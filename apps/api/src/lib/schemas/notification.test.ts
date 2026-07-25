import { describe, expect, test } from "bun:test";
import { createNotificationSchema } from "./notification.js";

const base = { notificationType: "system", title: "Test" };
describe("notification action URL validation", () => {
  test("accepts application-relative routes", () => {
    expect(
      createNotificationSchema.safeParse({ ...base, actionUrl: "/chat/123" })
        .success,
    ).toBe(true);
  });
  test("rejects absolute and protocol-relative URLs", () => {
    expect(
      createNotificationSchema.safeParse({
        ...base,
        actionUrl: "https://example.com",
      }).success,
    ).toBe(false);
    expect(
      createNotificationSchema.safeParse({
        ...base,
        actionUrl: "//example.com",
      }).success,
    ).toBe(false);
    expect(
      createNotificationSchema.safeParse({ ...base, actionUrl: "/\\evil" })
        .success,
    ).toBe(false);
  });
});
