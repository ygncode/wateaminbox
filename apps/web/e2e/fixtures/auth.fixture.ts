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
    // Set up mock authentication state in localStorage BEFORE any navigation
    // This ensures the auth state is available when React mounts
    await page.addInitScript(
      ({ accessToken, refreshToken, companyId }) => {
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

    // Mock all API responses - set up BEFORE navigation
    // Use string patterns that match the full URL to avoid over-matching
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: TEST_USER.id,
            email: TEST_USER.email,
            name: TEST_USER.name,
          },
        }),
      });
    });

    // Mock companies endpoint - returns array of companies with role
    // Use exact path match to avoid matching /companies/invitations etc
    await page.route("**/api/companies", (route) => {
      // Only handle GET requests to /companies (not sub-paths)
      const url = new URL(route.request().url());
      if (url.pathname === "/api/companies" && route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: MOCK_COMPANY_ID,
                name: "Test Company",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                role: "owner",
              },
            ],
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock contacts/chats endpoint with empty data
    await page.route("**/api/contacts**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, limit: 50, offset: 0 },
        }),
      });
    });

    // Mock messages endpoint
    await page.route("**/api/messages**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, limit: 50, offset: 0 },
        }),
      });
    });

    // Mock WhatsApp connections endpoint
    await page.route("**/api/whatsapp/connections**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [],
        }),
      });
    });

    // Mock WhatsApp status endpoint
    await page.route("**/api/whatsapp/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isConnected: false,
          isConnecting: false,
          qrCode: null,
        }),
      });
    });

    // Mock notifications endpoint
    await page.route("**/api/notifications**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/count")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: { count: 0 } }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: [] }),
        });
      }
    });

    // Mock tags endpoint
    await page.route("**/api/tags**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
    });

    // Mock analytics endpoint
    await page.route("**/api/analytics**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            totalMessages: 0,
            totalContacts: 0,
            activeChats: 0,
          },
        }),
      });
    });

    // Mock WebSocket upgrade - just continue (don't mock WebSocket)
    await page.route("**/api/ws**", (route) => {
      route.continue();
    });

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
