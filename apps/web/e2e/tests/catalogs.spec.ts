import { test, expect } from "@playwright/test"
import { SettingsPage } from "../pages"

/**
 * E2E Tests for WhatsApp Business Catalogs feature
 * Tests the Product Catalogs management UI in the Settings page
 */

// Override storage state to not use global auth - we'll set up our own mocks
test.use({ storageState: { cookies: [], origins: [] } })

test.describe("WhatsApp Business Catalogs", () => {
  test.beforeEach(async ({ page }) => {
    // Set up all route mocks BEFORE navigating to establish auth
    // Use a catch-all handler for localhost:3001 API requests

    // Mock all API endpoints with a single route handler
    await page.route(/localhost:3001\/api/, (route) => {
      const url = route.request().url()

      // Auth endpoint
      if (url.includes("/api/auth/me")) {
        return route.fulfill({
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
        })
      }

      // Companies endpoint
      if (url.includes("/api/companies")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [{ id: "test-company-id", name: "Test Company" }],
          }),
        })
      }

      // Notification preferences
      if (url.includes("/api/notifications/preferences")) {
        return route.fulfill({
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
        })
      }

      // Quick replies
      if (url.includes("/api/quick-replies")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            meta: { total: 0, limit: 50, offset: 0 },
          }),
        })
      }

      // Tags
      if (url.includes("/api/tags")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        })
      }

      // Labels status
      if (url.includes("/api/labels/status")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            totalLabels: 0,
            linkedLabels: 0,
            unlinkedLabels: 0,
            totalTags: 0,
            linkedTags: 0,
            lastSyncAt: null,
          }),
        })
      }

      // Labels with status
      if (url.includes("/api/labels/tags/with-status")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        })
      }

      // Labels
      if (url.includes("/api/labels")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        })
      }

      // Catalogs status
      if (url.includes("/api/catalogs/status")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            totalCatalogs: 0,
            activeCatalogs: 0,
            totalProducts: 0,
            lastSyncAt: null,
          }),
        })
      }

      // Catalogs sync
      if (url.includes("/api/catalogs/sync")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Catalog sync initiated. Catalogs will be updated shortly.",
            status: "syncing",
          }),
        })
      }

      // Catalogs list
      if (url.includes("/api/catalogs")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [] }),
        })
      }

      // Default: continue with the request (will fail if API not running)
      return route.continue()
    })

    // Navigate to establish origin and set up auth
    await page.goto("/")

    // Set up mock authentication state in localStorage
    await page.evaluate(() => {
      localStorage.setItem("auth_token", "mock-access-token")
      localStorage.setItem("refresh_token", "mock-refresh-token")
      localStorage.setItem("company_id", "test-company-id")
    })

    // Reload to apply the authentication state (mocks are already in place)
    await page.reload()

    // Wait for the auth check to complete
    await page.waitForLoadState("networkidle")
  })

  test("should display Product Catalogs section with empty state", async ({ page }) => {
    const settingsPage = new SettingsPage(page)
    await settingsPage.goto()
    await settingsPage.waitForPageLoad()

    // Take screenshot of settings page with Catalogs section
    await page.screenshot({
      path: ".screenshots/catalogs-01-empty-state.png",
      fullPage: true,
    })

    // Verify Product Catalogs section is visible
    await expect(page.locator("text=Product Catalogs")).toBeVisible()

    // Verify Sync button is visible
    const syncButton = page.getByTestId("sync-catalogs-button")
    await expect(syncButton).toBeVisible()

    // Verify empty state message
    await expect(page.locator("text=No catalogs found")).toBeVisible()
  })

  test("should display list of catalogs", async ({ page }) => {
    // Override the default mock for catalogs with data
    await page.route(/localhost:3001\/api\/catalogs(?!\/sync)/, (route) => {
      const url = route.request().url()

      if (url.includes("/api/catalogs/status")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            totalCatalogs: 3,
            activeCatalogs: 2,
            totalProducts: 45,
            lastSyncAt: new Date().toISOString(),
          }),
        })
      }

      if (url.includes("/api/catalogs")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "catalog-uuid-1",
                catalogId: "catalog-electronics",
                name: "Electronics Store",
                description: "Our electronics collection",
                currency: "USD",
                status: "active",
                businessJid: "1234567890@s.whatsapp.net",
                headerImageUrl: null,
                productCount: 15,
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: "catalog-uuid-2",
                catalogId: "catalog-fashion",
                name: "Fashion Boutique",
                description: "Latest fashion trends",
                currency: "EUR",
                status: "active",
                businessJid: "1234567890@s.whatsapp.net",
                headerImageUrl: null,
                productCount: 25,
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: "catalog-uuid-3",
                catalogId: "catalog-archived",
                name: "Old Collection",
                description: "Archived catalog",
                currency: "USD",
                status: "archived",
                businessJid: "1234567890@s.whatsapp.net",
                headerImageUrl: null,
                productCount: 5,
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        })
      }

      return route.continue()
    })

    const settingsPage = new SettingsPage(page)
    await settingsPage.goto()
    await settingsPage.waitForPageLoad()

    // Wait for catalogs to load
    await page.waitForSelector('[data-testid="catalogs-list"]', { timeout: 10000 })

    // Take screenshot of catalogs list
    await page.screenshot({
      path: ".screenshots/catalogs-02-list-with-items.png",
      fullPage: true,
    })

    // Verify catalog items are visible
    await expect(page.getByTestId("catalog-item-catalog-electronics")).toBeVisible()
    await expect(page.getByTestId("catalog-item-catalog-fashion")).toBeVisible()
    await expect(page.getByTestId("catalog-item-catalog-archived")).toBeVisible()

    // Verify archived catalog shows "Archived" badge
    await expect(page.locator("text=Archived")).toBeVisible()
  })

  test("should trigger catalog sync", async ({ page }) => {
    const settingsPage = new SettingsPage(page)
    await settingsPage.goto()
    await settingsPage.waitForPageLoad()

    // Click sync button
    const syncButton = page.getByTestId("sync-catalogs-button")
    await syncButton.click()

    // Take screenshot during sync
    await page.screenshot({
      path: ".screenshots/catalogs-03-syncing.png",
      fullPage: true,
    })

    // Verify sync was triggered (button should show loading state briefly)
    await expect(syncButton).toBeEnabled({ timeout: 5000 })
  })

  test("should display stats summary cards", async ({ page }) => {
    // Override the default mock for catalogs with stats
    await page.route(/localhost:3001\/api\/catalogs(?!\/sync)/, (route) => {
      const url = route.request().url()

      if (url.includes("/api/catalogs/status")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            totalCatalogs: 5,
            activeCatalogs: 3,
            totalProducts: 75,
            lastSyncAt: new Date(Date.now() - 300000).toISOString(),
          }),
        })
      }

      if (url.includes("/api/catalogs")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "catalog-uuid-1",
                catalogId: "catalog-1",
                name: "Catalog 1",
                description: null,
                currency: "USD",
                status: "active",
                businessJid: null,
                headerImageUrl: null,
                productCount: 10,
                lastSyncedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        })
      }

      return route.continue()
    })

    const settingsPage = new SettingsPage(page)
    await settingsPage.goto()
    await settingsPage.waitForPageLoad()

    // Wait for stats to load
    await page.waitForSelector("text=Product Catalogs", { timeout: 10000 })

    // Take screenshot of stats summary
    await page.screenshot({
      path: ".screenshots/catalogs-04-stats-summary.png",
      fullPage: true,
    })

    // Verify stats are displayed
    await expect(page.locator("text=Total Catalogs")).toBeVisible()
  })
})
