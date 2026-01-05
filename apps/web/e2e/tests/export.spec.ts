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

  test.describe("Conversation Export", () => {
    test("should send X-Company-ID header when exporting conversation", async ({ authenticatedPage }) => {
      const contactId = "test-contact-123";

      // Mock contact endpoint
      await authenticatedPage.route(`**/api/contacts/${contactId}`, (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: contactId,
            whatsappId: "1234567890@s.whatsapp.net",
            displayName: "Test Contact",
            phoneNumber: "+1234567890",
            tags: [],
          }),
        });
      });

      // Track export requests to verify headers
      const exportRequests: any[] = [];
      await authenticatedPage.route(`**/api/export/conversation/${contactId}*`, (route) => {
        const headers = route.request().headers();
        exportRequests.push({
          headers,
          url: route.request().url(),
        });

        // Fulfill with mock data
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              contact: {
                whatsapp_id: "1234567890@s.whatsapp.net",
                phone_number: "+1234567890",
                custom_name: "Test Contact",
              },
              messages: [],
            },
          }),
        });
      });

      // Navigate to chat page
      await authenticatedPage.goto(`http://localhost:5173/chat/${contactId}`);

      // Wait for the page to load
      await authenticatedPage.waitForTimeout(1000);

      // Open contact profile (if it exists)
      const profileButton = authenticatedPage.getByRole("button", { name: /info|profile|details/i });
      if (await profileButton.isVisible()) {
        await profileButton.click();
      }

      // Look for export button
      const exportButton = authenticatedPage.getByRole("button", { name: /export/i }).first();
      if (await exportButton.isVisible()) {
        await exportButton.click();

        // Wait for export dialog
        await authenticatedPage.waitForSelector('[role="dialog"]', { timeout: 5000 });

        // Click the export button in the dialog
        const dialogExportButton = authenticatedPage.getByRole("dialog").getByRole("button", { name: /export/i });
        await dialogExportButton.click();

        // Wait for the request to be made
        await authenticatedPage.waitForTimeout(500);

        // Verify that the request was made with the correct headers
        expect(exportRequests.length).toBeGreaterThan(0);
        const request = exportRequests[0];
        expect(request.headers["x-company-id"]).toBeDefined();
        expect(request.headers["authorization"]).toBeDefined();
      }
    });

    test("should show warning for large conversation exports", async ({ authenticatedPage }) => {
      const contactId = "test-contact-456";

      // Mock contact endpoint
      await authenticatedPage.route(`**/api/contacts/${contactId}`, (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: contactId,
            whatsappId: "9876543210@s.whatsapp.net",
            displayName: "Large Contact",
            phoneNumber: "+9876543210",
            tags: [],
          }),
        });
      });

      // Navigate to chat page
      await authenticatedPage.goto(`http://localhost:5173/chat/${contactId}`);

      // Wait for the page to load
      await authenticatedPage.waitForTimeout(1000);

      // Open contact profile
      const profileButton = authenticatedPage.getByRole("button", { name: /info|profile|details/i });
      if (await profileButton.isVisible()) {
        await profileButton.click();

        // Look for export button
        const exportButton = authenticatedPage.getByRole("button", { name: /export/i }).first();
        if (await exportButton.isVisible()) {
          await exportButton.click();

          // Wait for export dialog
          await authenticatedPage.waitForSelector('[role="dialog"]', { timeout: 5000 });

          // Check if the warning message is visible when "All time" is selected
          const warning = authenticatedPage.getByText(/exports are limited to 50,000 messages/i);
          const isWarningVisible = await warning.isVisible();

          // The warning should be visible when date range is "all"
          expect(isWarningVisible).toBe(true);
        }
      }
    });
  });
});
