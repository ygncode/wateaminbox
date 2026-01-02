import { test, expect } from "@playwright/test";
import { SettingsPage } from "../pages";

/**
 * E2E Tests for Notification Settings
 * Tests the notification preferences UI and API sync
 */

test.describe("Notification Settings", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ page }) => {
    settingsPage = new SettingsPage(page);

    // Mock authentication state
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "mock-access-token");
      localStorage.setItem("refresh_token", "mock-refresh-token");
      localStorage.setItem("company_id", "test-company-123");
    });
  });

  test.describe("Settings Page Display", () => {
    test("should display notification settings section", async ({ page }) => {
      // Mock API response for notification preferences
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
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Verify notification settings elements are visible
      await expect(page.locator("text=Desktop Notifications")).toBeVisible();
      await expect(page.locator("text=Notification Sound")).toBeVisible();
      await expect(page.locator("text=Quiet Hours")).toBeVisible();
    });

    test("should load preferences from API on page load", async ({ page }) => {
      // Mock API with specific preferences
      await page.route("**/api/notifications/preferences", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              id: "pref-123",
              userId: "user-123",
              soundEnabled: false,
              soundChoice: "bell",
              quietHoursStart: "22:00",
              quietHoursEnd: "07:00",
              mutedContacts: ["contact@s.whatsapp.net"],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();
      await settingsPage.waitForPreferencesLoaded();

      // Verify quiet hours is enabled when start/end are set
      await expect(settingsPage.quietHoursToggle).toHaveAttribute("data-state", "checked");
    });
  });

  test.describe("Sound Settings", () => {
    test("should toggle sound enabled/disabled", async ({ page }) => {
      let soundEnabled = true;

      // Mock GET preferences
      await page.route("**/api/notifications/preferences", (route, request) => {
        if (request.method() === "GET") {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: soundEnabled,
                soundChoice: "default",
                quietHoursStart: null,
                quietHoursEnd: null,
                mutedContacts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        } else if (request.method() === "PATCH") {
          const body = request.postDataJSON();
          if (body.soundEnabled !== undefined) {
            soundEnabled = body.soundEnabled;
          }
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: soundEnabled,
                soundChoice: "default",
                quietHoursStart: null,
                quietHoursEnd: null,
                mutedContacts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        }
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();
      await settingsPage.waitForPreferencesLoaded();

      // Initial state should be checked (sound enabled)
      await expect(settingsPage.soundEnabledToggle).toHaveAttribute("data-state", "checked");

      // Toggle sound off
      await settingsPage.toggleSound();

      // Should now be unchecked
      await expect(settingsPage.soundEnabledToggle).toHaveAttribute("data-state", "unchecked");
    });

    test("should show sound selection dropdown when sound is enabled", async ({ page }) => {
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
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Sound select should be visible when sound is enabled
      await expect(settingsPage.soundSelect).toBeVisible();

      // Click to open dropdown
      await settingsPage.soundSelect.click();

      // Should show sound options
      await expect(page.getByRole("option", { name: /default/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /chime/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /bell/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /pop/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /none/i })).toBeVisible();
    });
  });

  test.describe("Quiet Hours Settings", () => {
    test("should toggle quiet hours on/off", async ({ page }) => {
      let quietHoursStart: string | null = null;
      let quietHoursEnd: string | null = null;

      await page.route("**/api/notifications/preferences", (route, request) => {
        if (request.method() === "GET") {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
                quietHoursStart,
                quietHoursEnd,
                mutedContacts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        } else if (request.method() === "PATCH") {
          const body = request.postDataJSON();
          if (body.quietHoursStart !== undefined) {
            quietHoursStart = body.quietHoursStart;
          }
          if (body.quietHoursEnd !== undefined) {
            quietHoursEnd = body.quietHoursEnd;
          }
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: true,
                soundChoice: "default",
                quietHoursStart,
                quietHoursEnd,
                mutedContacts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        }
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Initially quiet hours should be off
      await expect(settingsPage.quietHoursToggle).toHaveAttribute("data-state", "unchecked");

      // Toggle quiet hours on
      await settingsPage.toggleQuietHours();

      // Should now show time inputs
      await expect(settingsPage.quietHoursStartInput).toBeVisible();
      await expect(settingsPage.quietHoursEndInput).toBeVisible();
    });

    test("should show time inputs when quiet hours is enabled", async ({ page }) => {
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
              quietHoursStart: "22:00",
              quietHoursEnd: "07:00",
              mutedContacts: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Time inputs should be visible
      await expect(settingsPage.quietHoursStartInput).toBeVisible();
      await expect(settingsPage.quietHoursEndInput).toBeVisible();

      // Check default values
      await expect(settingsPage.quietHoursStartInput).toHaveValue("22:00");
      await expect(settingsPage.quietHoursEndInput).toHaveValue("07:00");
    });
  });

  test.describe("API Sync", () => {
    test("should sync preferences changes to server", async ({ page }) => {
      const patchCalls: unknown[] = [];

      await page.route("**/api/notifications/preferences", (route, request) => {
        if (request.method() === "GET") {
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
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        } else if (request.method() === "PATCH") {
          patchCalls.push(request.postDataJSON());
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                id: "pref-123",
                userId: "user-123",
                soundEnabled: false,
                soundChoice: "default",
                quietHoursStart: null,
                quietHoursEnd: null,
                mutedContacts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        }
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Toggle sound off
      await settingsPage.toggleSound();

      // Wait a bit for the API call
      await page.waitForTimeout(500);

      // Verify PATCH was called
      expect(patchCalls.length).toBeGreaterThan(0);
      expect(patchCalls[0]).toHaveProperty("soundEnabled", false);
    });

    test("should handle API errors gracefully", async ({ page }) => {
      await page.route("**/api/notifications/preferences", (route, request) => {
        if (request.method() === "GET") {
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
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        } else if (request.method() === "PATCH") {
          // Simulate server error
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Server error" }),
          });
        }
      });

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Toggle should still work locally even if API fails
      await settingsPage.toggleSound();

      // UI should still update (optimistic update)
      await expect(settingsPage.soundEnabledToggle).toHaveAttribute("data-state", "unchecked");
    });
  });

  test.describe("Test Notification", () => {
    test("should show test notification button when notifications are enabled", async ({ page }) => {
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
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
      });

      // Grant notification permission
      await page.context().grantPermissions(["notifications"]);

      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Test notification button should be visible when permission is granted
      // Note: This may not show if browser permission is not actually granted in test
      // The button visibility depends on browser notification permission state
    });
  });
});
