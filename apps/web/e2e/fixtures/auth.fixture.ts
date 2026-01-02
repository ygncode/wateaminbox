import { test as base, Page } from "@playwright/test";
import { LoginPage, ChatPage } from "../pages";

/**
 * Test credentials for authentication tests
 * In a real scenario, these would come from environment variables
 */
export const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "test@example.com",
  password: process.env.TEST_USER_PASSWORD || "testpassword123",
  name: "Test User",
  id: "test-user-123",
};

/**
 * Mock token for testing (simulates JWT structure)
 */
const MOCK_ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNzA0MDY3MjAwLCJleHAiOjE3MzU2ODk2MDB9.mock-signature";
const MOCK_REFRESH_TOKEN = "mock-refresh-token-for-testing";
const MOCK_COMPANY_ID = "test-company-id";

/**
 * Extended test with authentication fixtures
 */
export const test = base.extend<{
  loginPage: LoginPage;
  chatPage: ChatPage;
  authenticatedPage: Page;
}>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  chatPage: async ({ page }, use) => {
    const chatPage = new ChatPage(page);
    await use(chatPage);
  },

  /**
   * Provides a page that is already authenticated
   * Uses localStorage manipulation to set auth tokens for faster test setup
   *
   * The tokens are set in localStorage matching the keys used in:
   * - apps/web/src/lib/api.ts (TOKEN_STORAGE_KEY, REFRESH_TOKEN_STORAGE_KEY, COMPANY_ID_STORAGE_KEY)
   */
  authenticatedPage: async ({ page }, use) => {
    // First navigate to any page to establish the origin for localStorage
    await page.goto("/");

    // Set up mock authentication state in localStorage
    // These keys match what's used in apps/web/src/lib/api.ts
    await page.evaluate(
      ({ accessToken, refreshToken, companyId }) => {
        // Set auth tokens - these match the storage keys in api.ts
        localStorage.setItem("auth_token", accessToken);
        localStorage.setItem("refresh_token", refreshToken);
        localStorage.setItem("company_id", companyId);
      },
      {
        accessToken: MOCK_ACCESS_TOKEN,
        refreshToken: MOCK_REFRESH_TOKEN,
        companyId: MOCK_COMPANY_ID,
      }
    );

    // Reload to apply the authentication state
    await page.reload();

    await use(page);

    // Cleanup after test
    await clearAuthState(page);
  },
});

export { expect } from "@playwright/test";

/**
 * Helper function to perform login through the UI
 * Use this for integration tests that need to test the actual login flow
 */
export async function loginViaUI(
  page: Page,
  email: string = TEST_USER.email,
  password: string = TEST_USER.password
) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(email, password);
  await loginPage.waitForLoginComplete();
}

/**
 * Helper function to clear authentication state
 */
export async function clearAuthState(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("company_id");
  });
}

/**
 * Helper function to set custom auth tokens
 * Useful for testing specific authentication scenarios
 */
export async function setAuthTokens(
  page: Page,
  accessToken: string,
  refreshToken: string,
  companyId: string
) {
  await page.evaluate(
    ({ accessToken, refreshToken, companyId }) => {
      localStorage.setItem("auth_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      localStorage.setItem("company_id", companyId);
    },
    { accessToken, refreshToken, companyId }
  );
}
