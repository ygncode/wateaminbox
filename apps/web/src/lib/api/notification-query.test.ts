import { describe, expect, test } from "bun:test";
import { buildNotificationListQuery } from "./notification-query";

describe("notification list query", () => {
  test("omits the unread filter when the caller wants every notification", () => {
    // Sending `unreadOnly=false` is what hid read notifications from "View all".
    expect(buildNotificationListQuery({ limit: 25, offset: 0 })).toEqual({
      limit: 25,
      offset: 0,
    });
    expect(
      buildNotificationListQuery({ limit: 25, offset: 0, unreadOnly: false }),
    ).toEqual({ limit: 25, offset: 0 });
    expect(
      Object.keys(buildNotificationListQuery({ unreadOnly: false })),
    ).not.toContain("unreadOnly");
  });

  test("sends the unread filter when it is switched on", () => {
    expect(
      buildNotificationListQuery({ limit: 25, offset: 50, unreadOnly: true }),
    ).toEqual({ limit: 25, offset: 50, unreadOnly: true });
  });

  test("passes paging through untouched and tolerates no params", () => {
    expect(buildNotificationListQuery()).toEqual({});
    expect(buildNotificationListQuery({ offset: 75 })).toEqual({ offset: 75 });
  });
});
