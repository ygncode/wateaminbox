import { test, expect } from "../fixtures/auth.fixture";
import { ChatPage } from "../pages";

/**
 * E2E Tests for Notification Center
 * Tests the in-app notification center UI and API integration
 */

test.describe("Notification Center", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ authenticatedPage }) => {
    chatPage = new ChatPage(authenticatedPage);
  });

  test.describe("Notification Bell Display", () => {
    test("should display notification bell in header", async ({
      authenticatedPage,
    }) => {
      // Mock API responses
      await authenticatedPage.route(
        "**/api/notifications/preferences",
        (route) => {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
                quietHoursStart: null,
                quietHoursEnd: null,
                mutedContacts: [],
              },
            }),
          });
        }
      );

      await authenticatedPage.route("**/api/notifications?**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            meta: {
              total: 0,
              unreadCount: 0,
              limit: 20,
              offset: 0,
            },
          }),
        });
      });

      await authenticatedPage.route("**/api/notifications/count", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { unreadCount: 0 },
          }),
        });
      });

      // Mock contacts/conversations
      await authenticatedPage.route("**/api/contacts**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      });

      await chatPage.goto();
      await chatPage.waitForLoad();

      // Verify notification bell is visible
      const notificationBell = authenticatedPage.getByTestId("notification-bell");
      await expect(notificationBell).toBeVisible();
    });

    test("should display unread badge when notifications exist", async ({
      authenticatedPage,
    }) => {
      // Mock API responses with unread notifications
      await authenticatedPage.route(
        "**/api/notifications/preferences",
        (route) => {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
              },
            }),
          });
        }
      );

      await authenticatedPage.route("**/api/notifications?**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "notif-1",
                userId: "user-123",
                notificationType: "message",
                title: "New message from John",
                message: "Hello!",
                isRead: false,
                createdAt: new Date().toISOString(),
              },
            ],
            meta: {
              total: 1,
              unreadCount: 1,
              limit: 20,
              offset: 0,
            },
          }),
        });
      });

      await authenticatedPage.route("**/api/notifications/count", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { unreadCount: 1 },
          }),
        });
      });

      await authenticatedPage.route("**/api/contacts**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      });

      await chatPage.goto();
      await chatPage.waitForLoad();

      // Verify notification badge is visible with count
      const notificationBadge =
        authenticatedPage.getByTestId("notification-badge");
      await expect(notificationBadge).toBeVisible();
      await expect(notificationBadge).toHaveText("1");
    });
  });

  test.describe("Notification Popover", () => {
    test("should open popover when clicking bell", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.route(
        "**/api/notifications/preferences",
        (route) => {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
              },
            }),
          });
        }
      );

      await authenticatedPage.route("**/api/notifications?**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "notif-1",
                userId: "user-123",
                notificationType: "message",
                title: "New message from John",
                message: "Hello!",
                isRead: false,
                createdAt: new Date().toISOString(),
              },
            ],
            meta: {
              total: 1,
              unreadCount: 1,
              limit: 20,
              offset: 0,
            },
          }),
        });
      });

      await authenticatedPage.route("**/api/notifications/count", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { unreadCount: 1 },
          }),
        });
      });

      await authenticatedPage.route("**/api/contacts**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      });

      await chatPage.goto();
      await chatPage.waitForLoad();

      // Click the notification bell
      const notificationBell =
        authenticatedPage.getByTestId("notification-bell");
      await notificationBell.click();

      // Verify popover is visible
      const popover = authenticatedPage.getByTestId("notification-popover");
      await expect(popover).toBeVisible();

      // Verify notification title is visible
      await expect(
        authenticatedPage.getByText("New message from John")
      ).toBeVisible();
    });

    test("should show empty state when no notifications", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.route(
        "**/api/notifications/preferences",
        (route) => {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
              },
            }),
          });
        }
      );

      await authenticatedPage.route("**/api/notifications?**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            meta: {
              total: 0,
              unreadCount: 0,
              limit: 20,
              offset: 0,
            },
          }),
        });
      });

      await authenticatedPage.route("**/api/notifications/count", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { unreadCount: 0 },
          }),
        });
      });

      await authenticatedPage.route("**/api/contacts**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      });

      await chatPage.goto();
      await chatPage.waitForLoad();

      // Click the notification bell
      const notificationBell =
        authenticatedPage.getByTestId("notification-bell");
      await notificationBell.click();

      // Verify popover is visible
      const popover = authenticatedPage.getByTestId("notification-popover");
      await expect(popover).toBeVisible();

      // Verify empty state message
      await expect(authenticatedPage.getByText("No notifications")).toBeVisible();
      await expect(
        authenticatedPage.getByText("You're all caught up!")
      ).toBeVisible();
    });

    test("should mark notification as read when clicked", async ({
      authenticatedPage,
    }) => {
      let isRead = false;

      await authenticatedPage.route(
        "**/api/notifications/preferences",
        (route) => {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
              },
            }),
          });
        }
      );

      await authenticatedPage.route("**/api/notifications?**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "notif-1",
                userId: "user-123",
                notificationType: "message",
                title: "New message from John",
                message: "Hello!",
                isRead: isRead,
                createdAt: new Date().toISOString(),
              },
            ],
            meta: {
              total: 1,
              unreadCount: isRead ? 0 : 1,
              limit: 20,
              offset: 0,
            },
          }),
        });
      });

      await authenticatedPage.route("**/api/notifications/count", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { unreadCount: isRead ? 0 : 1 },
          }),
        });
      });

      await authenticatedPage.route(
        "**/api/notifications/notif-1/read",
        (route, request) => {
          if (request.method() === "PATCH") {
            isRead = true;
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  id: "notif-1",
                  userId: "user-123",
                  notificationType: "message",
                  title: "New message from John",
                  isRead: true,
                  readAt: new Date().toISOString(),
                },
              }),
            });
          }
        }
      );

      await authenticatedPage.route("**/api/contacts**", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      });

      await chatPage.goto();
      await chatPage.waitForLoad();

      // Click the notification bell
      await authenticatedPage.getByTestId("notification-bell").click();

      // Wait for popover
      const popover = authenticatedPage.getByTestId("notification-popover");
      await expect(popover).toBeVisible();

      // Click the notification item
      const notificationItem = authenticatedPage.getByTestId("notification-item");
      await notificationItem.click();

      // Verify the notification mark as read API was called
      expect(isRead).toBe(true);
    });
  });
});
