import { test, expect } from "@playwright/test";
import { SettingsPage } from "../pages";

/**
 * E2E Tests for Internationalization (i18n)
 * Tests language switching and translation functionality
 */

test.describe("Internationalization (i18n)", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ page }) => {
    settingsPage = new SettingsPage(page);

    // Mock API responses needed for the settings page
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

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "user-123",
            email: "test@example.com",
            name: "Test User",
          },
        }),
      });
    });

    await page.route("**/api/quick-replies*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, limit: 50 } }),
      });
    });

    await page.route("**/api/labels*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.route("**/api/catalogs*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.route("**/api/users/me/companies*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ id: "test-company-id", name: "Test Company", role: "owner" }],
        }),
      });
    });
  });

  test.describe("Language Switcher Component", () => {
    test("should display language switcher on settings page", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Clear any saved language preference and reload
      await page.evaluate(() => {
        localStorage.removeItem("whatsapp-web-language");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Should show the Language section
      await expect(page.locator("text=Language").first()).toBeVisible();

      // Should show the language selector dropdown
      const languageSelector = page.locator('button[role="combobox"]').filter({ hasText: /English|简体中文/ });
      await expect(languageSelector).toBeVisible();
    });

    test("should default to English language", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Clear any saved language preference and reload
      await page.evaluate(() => {
        localStorage.removeItem("whatsapp-web-language");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Settings title should be in English
      await expect(page.locator("h1")).toContainText("Settings");

      // Language dropdown should show English selected
      const languageSelector = page.locator('button[role="combobox"]').filter({ hasText: "English" });
      await expect(languageSelector).toBeVisible();
    });

    test("should show available language options", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Clear any saved language preference and reload
      await page.evaluate(() => {
        localStorage.removeItem("whatsapp-web-language");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Click on language selector
      const languageSelector = page.locator('button[role="combobox"]').filter({ hasText: /English|简体中文/ });
      await languageSelector.click();

      // Should show both language options
      await expect(page.getByRole("option", { name: "English" })).toBeVisible();
      await expect(page.getByRole("option", { name: "简体中文" })).toBeVisible();
    });

    test("should switch to Chinese when selected", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Clear any saved language preference and reload
      await page.evaluate(() => {
        localStorage.removeItem("whatsapp-web-language");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Click on language selector
      const languageSelector = page.locator('button[role="combobox"]').filter({ hasText: /English|简体中文/ });
      await languageSelector.click();

      // Select Chinese
      await page.getByRole("option", { name: "简体中文" }).click();

      // Wait for UI to update
      await page.waitForTimeout(500);

      // Settings title should now be in Chinese
      await expect(page.locator("h1")).toContainText("设置");

      // The dropdown should now show Chinese
      await expect(page.locator('button[role="combobox"]').filter({ hasText: "简体中文" })).toBeVisible();
    });

    test("should switch back to English when selected", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set Chinese language and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "zh-CN");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Page should be in Chinese initially
      await expect(page.locator("h1")).toContainText("设置");

      // Click on language selector
      const languageSelector = page.locator('button[role="combobox"]').filter({ hasText: "简体中文" });
      await languageSelector.click();

      // Select English
      await page.getByRole("option", { name: "English" }).click();

      // Wait for UI to update
      await page.waitForTimeout(500);

      // Settings title should now be in English
      await expect(page.locator("h1")).toContainText("Settings");
    });
  });

  test.describe("Language Persistence", () => {
    test("should persist language choice to localStorage", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Clear any saved language preference and reload
      await page.evaluate(() => {
        localStorage.removeItem("whatsapp-web-language");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Switch to Chinese
      const languageSelector = page.locator('button[role="combobox"]').filter({ hasText: /English|简体中文/ });
      await languageSelector.click();
      await page.getByRole("option", { name: "简体中文" }).click();

      // Wait for storage to be updated
      await page.waitForTimeout(500);

      // Check localStorage
      const savedLanguage = await page.evaluate(() => {
        return localStorage.getItem("whatsapp-web-language");
      });
      expect(savedLanguage).toBe("zh-CN");
    });

    test("should load saved language on page reload", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set Chinese language and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "zh-CN");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Page should load in Chinese
      await expect(page.locator("h1")).toContainText("设置");
    });
  });

  test.describe("Translation Coverage", () => {
    test("should translate Settings page UI elements to Chinese", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set Chinese language and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "zh-CN");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Verify key UI elements are translated
      await expect(page.locator("h1")).toContainText("设置");
      await expect(page.locator("text=语言").first()).toBeVisible();
      await expect(page.locator("text=通知").first()).toBeVisible();
      await expect(page.locator("text=键盘快捷键").first()).toBeVisible();
    });

    test("should translate quick replies section to Chinese", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set Chinese language and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "zh-CN");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Look for translated quick replies section
      await expect(page.locator("text=快捷回复").first()).toBeVisible();
    });

    test("should translate WhatsApp Labels section to Chinese", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set Chinese language and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "zh-CN");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Look for translated WhatsApp Labels section
      await expect(page.locator("text=WhatsApp 标签").first()).toBeVisible();
    });

    test("should translate Product Catalogs section to Chinese", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set Chinese language and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "zh-CN");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Look for translated Product Catalogs section
      await expect(page.locator("text=产品目录").first()).toBeVisible();
    });
  });

  test.describe("Edge Cases", () => {
    test("should fallback to English for invalid language", async ({ page }) => {
      await settingsPage.goto();
      await settingsPage.waitForPageLoad();

      // Set an invalid language code and reload
      await page.evaluate(() => {
        localStorage.setItem("whatsapp-web-language", "invalid-lang");
      });
      await page.reload();
      await settingsPage.waitForPageLoad();

      // Should fallback to English
      await expect(page.locator("h1")).toContainText("Settings");
    });
  });
});
