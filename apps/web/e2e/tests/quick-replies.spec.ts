import { test, expect } from "../fixtures/auth.fixture";
import { SettingsPage } from "../pages";

/**
 * E2E Tests for Quick Replies feature
 * Tests the Quick Replies management UI in the Settings page
 */

test.describe("Quick Replies", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Mock auth/me endpoint
    await authenticatedPage.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "user-123",
            email: "test@example.com",
            name: "Test User",
            emailVerified: true,
          },
        }),
      });
    });

    // Mock companies endpoint
    await authenticatedPage.route("**/api/companies", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ id: "test-company-id", name: "Test Company" }],
        }),
      });
    });

    // Mock notification preferences (required for settings page)
    await authenticatedPage.route("**/api/notifications/preferences", (route) => {
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
    });
  });

  test("should display Quick Replies section and empty state on settings page", async ({ authenticatedPage }) => {
    // Mock empty quick replies
    await authenticatedPage.route("**/api/quick-replies**", (route, request) => {
      if (request.method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            meta: { total: 0, limit: 50, offset: 0 },
          }),
        });
      }
    });

    const settingsPage = new SettingsPage(authenticatedPage);
    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Take screenshot of settings page with Quick Replies section
    await authenticatedPage.screenshot({
      path: ".screenshots/quick-replies-01-settings-section.png",
      fullPage: true,
    });

    // Verify Quick Replies section is visible
    await expect(authenticatedPage.locator("text=Quick Replies")).toBeVisible();

    // Verify Add New button is visible
    const addButton = authenticatedPage.getByTestId("add-quick-reply-button");
    await expect(addButton).toBeVisible();

    // Verify empty state message
    await expect(authenticatedPage.locator("text=No quick replies yet")).toBeVisible();
  });

  test("should display list of quick replies", async ({ authenticatedPage }) => {
    // Mock quick replies data
    await authenticatedPage.route("**/api/quick-replies**", (route, request) => {
      if (request.method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "qr-1",
                shortcut: "greeting",
                title: "Welcome Greeting",
                content: "Hello! Thank you for contacting us. How can I help you today?",
                createdBy: "user-123",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: "qr-2",
                shortcut: "thanks",
                title: "Thank You Message",
                content: "Thank you for your patience. Is there anything else I can help you with?",
                createdBy: "user-123",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            meta: { total: 2, limit: 50, offset: 0 },
          }),
        });
      }
    });

    const settingsPage = new SettingsPage(authenticatedPage);
    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Wait for quick replies to load
    await authenticatedPage.waitForSelector('[data-testid="quick-replies-list"]');

    // Take screenshot of quick replies list
    await authenticatedPage.screenshot({
      path: ".screenshots/quick-replies-02-list.png",
      fullPage: true,
    });

    // Verify quick reply items are visible
    await expect(authenticatedPage.getByTestId("quick-reply-item-greeting")).toBeVisible();
    await expect(authenticatedPage.getByTestId("quick-reply-item-thanks")).toBeVisible();

    // Verify shortcut badges
    await expect(authenticatedPage.locator("text=/greeting")).toBeVisible();
    await expect(authenticatedPage.locator("text=/thanks")).toBeVisible();
  });

  test("should open create dialog and create new quick reply", async ({ authenticatedPage }) => {
    let quickReplies: unknown[] = [];

    await authenticatedPage.route("**/api/quick-replies**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET" && !url.includes("/search/")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: quickReplies,
            meta: { total: quickReplies.length, limit: 50, offset: 0 },
          }),
        });
      }
    });

    await authenticatedPage.route("**/api/quick-replies", (route, request) => {
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        const newQuickReply = {
          id: "qr-new",
          shortcut: body.shortcut,
          title: body.title,
          content: body.content,
          createdBy: "user-123",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        quickReplies.push(newQuickReply);
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ data: newQuickReply }),
        });
      }
    });

    const settingsPage = new SettingsPage(authenticatedPage);
    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Click Add New button
    await authenticatedPage.getByTestId("add-quick-reply-button").click();

    // Verify dialog is visible
    await expect(authenticatedPage.locator("text=Create Quick Reply")).toBeVisible();

    // Fill in the form
    await authenticatedPage.getByTestId("quick-reply-shortcut-input").fill("welcome");
    await authenticatedPage.getByTestId("quick-reply-title-input").fill("Welcome Message");
    await authenticatedPage.getByTestId("quick-reply-content-input").fill("Welcome to our service! How can I assist you today?");

    // Take screenshot of create dialog
    await authenticatedPage.screenshot({
      path: ".screenshots/quick-replies-03-create-dialog.png",
      fullPage: false,
    });

    // Click Create button
    await authenticatedPage.getByTestId("save-quick-reply-button").click();

    // Wait for dialog to close
    await authenticatedPage.waitForSelector('text="Create Quick Reply"', { state: "hidden" });

    // Verify the new quick reply appears in the list
    await expect(authenticatedPage.getByTestId("quick-reply-item-welcome")).toBeVisible({ timeout: 5000 });

    // Take screenshot after creation
    await authenticatedPage.screenshot({
      path: ".screenshots/quick-replies-04-after-create.png",
      fullPage: true,
    });
  });

  test("should show validation error for invalid shortcut", async ({ authenticatedPage }) => {
    await authenticatedPage.route("**/api/quick-replies**", (route, request) => {
      if (request.method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            meta: { total: 0, limit: 50, offset: 0 },
          }),
        });
      }
    });

    const settingsPage = new SettingsPage(authenticatedPage);
    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Click Add New button
    await authenticatedPage.getByTestId("add-quick-reply-button").click();

    // Fill with invalid shortcut (contains spaces)
    await authenticatedPage.getByTestId("quick-reply-shortcut-input").fill("invalid shortcut");
    await authenticatedPage.getByTestId("quick-reply-title-input").fill("Test");
    await authenticatedPage.getByTestId("quick-reply-content-input").fill("Test content");

    // Click Create button
    await authenticatedPage.getByTestId("save-quick-reply-button").click();

    // Verify validation error message
    await expect(authenticatedPage.locator("text=can only contain letters")).toBeVisible();

    // Take screenshot of validation error
    await authenticatedPage.screenshot({
      path: ".screenshots/quick-replies-05-validation-error.png",
      fullPage: false,
    });
  });
});
