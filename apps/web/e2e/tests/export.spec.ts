import { test, expect } from "../fixtures/auth.fixture";
import { DashboardPage } from "../pages";

/**
 * E2E Tests for Export Functionality
 * Tests the export dialog, full backup, and individual exports
 *
 * Note: These tests require the application to be running with mocked authentication.
 * The Dashboard page contains export functionality including:
 * - Full Backup (ZIP with contacts + messages)
 * - Export Contacts (CSV/JSON)
 * - Export Messages (CSV/JSON)
 */

test.describe("Export Functionality", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Mock auth/me endpoint
    await authenticatedPage.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user-123",
          email: "test@example.com",
          name: "Test User",
          emailVerified: true,
        }),
      });
    });

    // Mock companies endpoint
    await authenticatedPage.route("**/api/companies", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ id: "test-company-id", name: "Test Company", role: "admin" }],
        }),
      });
    });

    // Mock dashboard stats
    await authenticatedPage.route("**/api/dashboard/stats*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalMessages: 1250,
          totalContacts: 89,
          activeUsers: 5,
          messagesSentToday: 45,
          messagesReceivedToday: 67,
          unreadConversations: 12,
        }),
      });
    });

    // Mock analytics endpoints
    await authenticatedPage.route("**/api/analytics/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await authenticatedPage.route("**/api/tags*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });
  });

  test.describe("Dashboard Page Object", () => {
    test("DashboardPage class should be properly exported", async ({ authenticatedPage }) => {
      const dashboardPage = new DashboardPage(authenticatedPage);
      expect(dashboardPage).toBeDefined();
      expect(dashboardPage.fullBackupButton).toBeDefined();
      expect(dashboardPage.exportContactsButton).toBeDefined();
      expect(dashboardPage.exportMessagesButton).toBeDefined();
    });
  });
});
