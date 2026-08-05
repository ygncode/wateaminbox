import { describe, expect, test } from "bun:test";
import {
  createNotificationSchema,
  listNotificationsQuerySchema,
} from "./notification.js";

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

describe("notification list query parsing", () => {
  const parse = (query: Record<string, unknown>) =>
    listNotificationsQuerySchema.parse(query);

  test('keeps read notifications in the list when unreadOnly is "false"', () => {
    // Query strings carry booleans as text. Truthiness-based coercion turned
    // "false" into true here, which silently hid every read notification.
    expect(parse({ unreadOnly: "false" }).unreadOnly).toBe(false);
    expect(parse({ unreadOnly: "0" }).unreadOnly).toBe(false);
    expect(parse({ unreadOnly: "" }).unreadOnly).toBe(false);
    expect(parse({ unreadOnly: false }).unreadOnly).toBe(false);
  });

  test("still supports an explicit unread-only filter", () => {
    expect(parse({ unreadOnly: "true" }).unreadOnly).toBe(true);
    expect(parse({ unreadOnly: "1" }).unreadOnly).toBe(true);
    expect(parse({ unreadOnly: true }).unreadOnly).toBe(true);
  });

  test("defaults to the unfiltered list and keeps paging coercion", () => {
    expect(parse({})).toEqual({ limit: 20, offset: 0, unreadOnly: false });
    expect(parse({ limit: "50", offset: "25" })).toMatchObject({
      limit: 50,
      offset: 25,
    });
  });

  test("rejects values that do not spell a boolean", () => {
    expect(
      listNotificationsQuerySchema.safeParse({ unreadOnly: "yes" }).success,
    ).toBe(false);
  });
});
