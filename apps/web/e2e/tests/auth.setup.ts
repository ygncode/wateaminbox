import { test as setup } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

/**
 * Global setup for authentication
 * This runs before all tests that depend on the "setup" project
 */
setup("authenticate", async ({ page }) => {
  // Navigate to the app
  await page.goto("/");

  // Set up mock authentication state in localStorage
  // This simulates a logged-in user for all subsequent tests
  await page.evaluate(() => {
    const mockToken = {
      accessToken: `mock-access-token-${Date.now()}`,
      refreshToken: `mock-refresh-token-${Date.now()}`,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    const mockUser = {
      id: "test-user-123",
      email: "test@example.com",
      name: "Test User",
    };

    localStorage.setItem("auth_token", mockToken.accessToken);
    localStorage.setItem("refresh_token", mockToken.refreshToken);
    localStorage.setItem("company_id", "test-company-id");
    localStorage.setItem("user", JSON.stringify(mockUser));
  });

  // Save storage state for use by other tests
  await page.context().storageState({ path: authFile });
});
