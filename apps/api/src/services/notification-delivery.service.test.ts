import { describe, expect, test } from "bun:test";
import { createAndPublishNotification } from "./notification-delivery.service.js";
import type { Notification } from "./notification-history.service.js";

const persisted: Notification = {
  id: "notification-id",
  userId: "user-id",
  notificationType: "assignment",
  title: "Assigned",
  message: null,
  actionUrl: "/chat/contact-id",
  metadata: null,
  isRead: false,
  readAt: null,
  createdAt: new Date(),
};

describe("notification delivery orchestration", () => {
  test("persists before publishing a targeted invalidation", async () => {
    const calls: string[] = [];
    const result = await createAndPublishNotification(
      "company-id",
      { userId: "user-id", notificationType: "assignment", title: "Assigned" },
      {
        persist: async () => {
          calls.push("persist");
          return [persisted];
        },
        publish: async (_companyId, userId, event, data) => {
          calls.push("publish");
          expect(userId).toBe("user-id");
          expect(event).toBe("notification:new");
          expect(data).toEqual({
            notificationId: "notification-id",
            userId: "user-id",
            type: "assignment",
          });
        },
      },
    );
    expect(result).toBe(persisted);
    expect(calls).toEqual(["persist", "publish"]);
  });

  test("returns persisted data when Pusher fails", async () => {
    const result = await createAndPublishNotification(
      "company-id",
      { userId: "user-id", notificationType: "assignment", title: "Assigned" },
      {
        persist: async () => [persisted],
        publish: async () => {
          throw new Error("Pusher unavailable");
        },
      },
    );
    expect(result.id).toBe("notification-id");
  });
});
