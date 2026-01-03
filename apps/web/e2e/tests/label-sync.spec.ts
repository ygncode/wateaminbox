import { test, expect } from "@playwright/test";
import { SettingsPage } from "../pages";

/**
 * E2E Tests for WhatsApp Labels Sync feature
 * Tests the Labels management UI in the Settings page
 */

test.describe("WhatsApp Labels Sync", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ page }) => {
    settingsPage = new SettingsPage(page);

    // Mock authentication state
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "mock-access-token");
      localStorage.setItem("refresh_token", "mock-refresh-token");
      localStorage.setItem("company_id", "test-company-123");
    });

    // Mock notification preferences
    await page.route("**/api/notifications/preferences", (route) => {
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

    // Mock quick replies (empty)
    await page.route("**/api/quick-replies**", (route, request) => {
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

    // Mock tags endpoint
    await page.route("**/api/tags", (route, request) => {
      if (request.method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "tag-1",
                name: "VIP",
                color: "#3b82f6",
                createdBy: "user-123",
                createdAt: new Date().toISOString(),
              },
              {
                id: "tag-2",
                name: "New Lead",
                color: "#22c55e",
                createdBy: "user-123",
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        });
      }
    });
  });

  test("should display WhatsApp Labels section with empty state", async ({ page }) => {
    // Mock empty labels
    await page.route("**/api/labels", (route, request) => {
      if (request.method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        });
      }
    });

    // Mock label status
    await page.route("**/api/labels/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalLabels: 0,
          linkedLabels: 0,
          unlinkedLabels: 0,
          totalTags: 2,
          linkedTags: 0,
          lastSyncAt: null,
        }),
      });
    });

    // Mock tags with status
    await page.route("**/api/labels/tags/with-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Take screenshot of settings page with Labels section
    await page.screenshot({
      path: ".screenshots/label-sync-01-empty-state.png",
      fullPage: true,
    });

    // Verify WhatsApp Labels section is visible
    await expect(page.locator("text=WhatsApp Labels")).toBeVisible();

    // Verify Sync button is visible
    const syncButton = page.getByTestId("sync-labels-button");
    await expect(syncButton).toBeVisible();

    // Verify empty state message
    await expect(page.locator("text=No WhatsApp labels found")).toBeVisible();
  });

  test("should display list of WhatsApp labels", async ({ page }) => {
    // Mock labels data
    await page.route("**/api/labels", (route, request) => {
      const url = request.url();
      if (request.method() === "GET" && !url.includes("/status") && !url.includes("/tags")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "wa-label-1",
                labelId: "label-important",
                name: "Important",
                color: "#ef4444",
                predefinedId: 7,
                syncedTagId: null,
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: "wa-label-2",
                labelId: "label-urgent",
                name: "Urgent",
                color: "#ffa500",
                predefinedId: 1,
                syncedTagId: "tag-1",
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
      }
    });

    // Mock label status
    await page.route("**/api/labels/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalLabels: 2,
          linkedLabels: 1,
          unlinkedLabels: 1,
          totalTags: 2,
          linkedTags: 1,
          lastSyncAt: new Date().toISOString(),
        }),
      });
    });

    // Mock tags with status
    await page.route("**/api/labels/tags/with-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "tag-1",
              name: "VIP",
              color: "#3b82f6",
              whatsappLabelId: "label-urgent",
              syncedAt: new Date().toISOString(),
              linkedLabel: {
                labelId: "label-urgent",
                name: "Urgent",
                color: "#ffa500",
              },
            },
          ],
        }),
      });
    });

    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Wait for labels to load
    await page.waitForSelector('[data-testid="labels-list"]', { timeout: 10000 });

    // Take screenshot of labels list
    await page.screenshot({
      path: ".screenshots/label-sync-02-labels-list.png",
      fullPage: true,
    });

    // Verify label items are visible
    await expect(page.getByTestId("label-item-label-important")).toBeVisible();
    await expect(page.getByTestId("label-item-label-urgent")).toBeVisible();

    // Verify linked label shows indication
    await expect(page.locator("text=Linked to")).toBeVisible();
  });

  test("should trigger label sync from WhatsApp", async ({ page }) => {
    // Mock initial empty labels
    await page.route("**/api/labels", (route, request) => {
      const url = request.url();
      if (request.method() === "GET" && !url.includes("/status") && !url.includes("/tags")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        });
      }
    });

    // Mock label status
    await page.route("**/api/labels/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalLabels: 0,
          linkedLabels: 0,
          unlinkedLabels: 0,
          totalTags: 2,
          linkedTags: 0,
          lastSyncAt: null,
        }),
      });
    });

    // Mock tags with status
    await page.route("**/api/labels/tags/with-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    // Mock sync endpoint
    await page.route("**/api/labels/sync", (route, request) => {
      if (request.method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Label sync initiated. Labels will be updated shortly.",
            status: "syncing",
          }),
        });
      }
    });

    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Click sync button
    const syncButton = page.getByTestId("sync-labels-button");
    await syncButton.click();

    // Take screenshot during sync
    await page.screenshot({
      path: ".screenshots/label-sync-03-syncing.png",
      fullPage: true,
    });

    // Verify sync was triggered (button should show loading state briefly)
    await expect(syncButton).toBeEnabled({ timeout: 5000 });
  });

  test("should display stats summary cards", async ({ page }) => {
    // Mock labels with data
    await page.route("**/api/labels", (route, request) => {
      const url = request.url();
      if (request.method() === "GET" && !url.includes("/status") && !url.includes("/tags")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "wa-label-1",
                labelId: "label-1",
                name: "Label 1",
                color: "#ef4444",
                predefinedId: null,
                syncedTagId: "tag-1",
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
      }
    });

    // Mock label status with counts
    await page.route("**/api/labels/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalLabels: 5,
          linkedLabels: 3,
          unlinkedLabels: 2,
          totalTags: 8,
          linkedTags: 3,
          lastSyncAt: new Date(Date.now() - 300000).toISOString(), // 5 mins ago
        }),
      });
    });

    // Mock tags with status
    await page.route("**/api/labels/tags/with-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Wait for stats to load
    await page.waitForSelector("text=WhatsApp Labels", { timeout: 10000 });

    // Take screenshot of stats summary
    await page.screenshot({
      path: ".screenshots/label-sync-04-stats-summary.png",
      fullPage: true,
    });

    // Verify stats are displayed
    await expect(page.locator("text=5").first()).toBeVisible(); // Total labels
  });

  test("should open link tag dialog", async ({ page }) => {
    // Mock labels with unlinked label
    await page.route("**/api/labels", (route, request) => {
      const url = request.url();
      if (request.method() === "GET" && !url.includes("/status") && !url.includes("/tags")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "wa-label-1",
                labelId: "label-important",
                name: "Important",
                color: "#ef4444",
                predefinedId: 7,
                syncedTagId: null,
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
      }
    });

    // Mock label status
    await page.route("**/api/labels/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalLabels: 1,
          linkedLabels: 0,
          unlinkedLabels: 1,
          totalTags: 2,
          linkedTags: 0,
          lastSyncAt: new Date().toISOString(),
        }),
      });
    });

    // Mock tags with status
    await page.route("**/api/labels/tags/with-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await settingsPage.goto();
    await settingsPage.waitForPageLoad();

    // Wait for labels list
    await page.waitForSelector('[data-testid="labels-list"]', { timeout: 10000 });

    // Click link button on the unlinked label
    const linkButton = page.getByTestId("link-label-label-important");
    await linkButton.click();

    // Verify dialog is visible
    await expect(page.locator("text=Link Tag to Label")).toBeVisible();

    // Take screenshot of link dialog
    await page.screenshot({
      path: ".screenshots/label-sync-05-link-dialog.png",
      fullPage: false,
    });

    // Verify label name is shown in dialog
    await expect(page.locator("text=Important")).toBeVisible();

    // Verify select dropdown is visible
    const selectTrigger = page.getByTestId("select-tag-trigger");
    await expect(selectTrigger).toBeVisible();
  });
});
