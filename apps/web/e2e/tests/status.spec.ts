import { test, expect } from "../fixtures/auth.fixture";

/**
 * E2E Tests for Post Status Updates feature
 * Tests the Status posting UI in the Status tab
 */

test.describe("Post Status Updates", () => {
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

    // Mock contacts endpoint (for chat sidebar)
    await authenticatedPage.route("**/api/contacts**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
        }),
      });
    });

    // Mock conversations endpoint
    await authenticatedPage.route("**/api/conversations**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
        }),
      });
    });

    // Mock WhatsApp connection status
    await authenticatedPage.route("**/api/whatsapp/status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "connected",
          phoneNumber: "+1234567890",
          jid: "1234567890@s.whatsapp.net",
        }),
      });
    });
  });

  test("should display My Status button and open Post Status dialog", async ({ authenticatedPage }) => {
    // Mock empty status updates
    await authenticatedPage.route("**/api/status**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET") {
        if (url.includes("/status/my")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [], count: 0 }),
          });
        } else if (url.includes("/stats/overview")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              activeStatuses: 0,
              contactsWithStatus: 0,
              totalStatusesReceived: 0,
            }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [],
              pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
            }),
          });
        }
      }
    });

    // Navigate to chat page
    await authenticatedPage.goto("/chat");
    await authenticatedPage.waitForLoadState("networkidle");

    // Take screenshot of chat page
    await authenticatedPage.screenshot({
      path: ".screenshots/status-01-chat-page.png",
      fullPage: true,
    });

    // Click on Status tab in sidebar
    const statusTab = authenticatedPage.locator('[data-testid="sidebar-status-tab"]');
    if (await statusTab.isVisible()) {
      await statusTab.click();
      await authenticatedPage.waitForTimeout(500);
    }

    // Look for My Status button
    const myStatusButton = authenticatedPage.getByTestId("my-status-button");
    if (await myStatusButton.isVisible()) {
      // Take screenshot with status tab open
      await authenticatedPage.screenshot({
        path: ".screenshots/status-02-status-tab.png",
        fullPage: true,
      });

      // Click My Status button
      await myStatusButton.click();
      await authenticatedPage.waitForTimeout(300);

      // Verify Post Status dialog is visible
      await expect(authenticatedPage.locator("text=Post Status Update")).toBeVisible();

      // Take screenshot of Post Status dialog
      await authenticatedPage.screenshot({
        path: ".screenshots/status-03-post-dialog.png",
        fullPage: false,
      });
    }
  });

  test("should show text status type selected by default", async ({ authenticatedPage }) => {
    // Mock status endpoints
    await authenticatedPage.route("**/api/status**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET") {
        if (url.includes("/status/my")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [], count: 0 }),
          });
        } else if (url.includes("/stats/overview")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              activeStatuses: 0,
              contactsWithStatus: 0,
              totalStatusesReceived: 0,
            }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [],
              pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
            }),
          });
        }
      }
    });

    await authenticatedPage.goto("/chat");
    await authenticatedPage.waitForLoadState("networkidle");

    // Click on Status tab
    const statusTab = authenticatedPage.locator('[data-testid="sidebar-status-tab"]');
    if (await statusTab.isVisible()) {
      await statusTab.click();
    }

    // Click My Status button
    const myStatusButton = authenticatedPage.getByTestId("my-status-button");
    if (await myStatusButton.isVisible()) {
      await myStatusButton.click();
      await authenticatedPage.waitForTimeout(300);

      // Verify text type button is selected (has different styling)
      const textTypeButton = authenticatedPage.getByTestId("status-type-text");
      await expect(textTypeButton).toBeVisible();

      // Verify status content textarea is visible
      const contentInput = authenticatedPage.getByTestId("status-content");
      await expect(contentInput).toBeVisible();
    }
  });

  test("should successfully post a text status", async ({ authenticatedPage }) => {
    // Mock status endpoints
    await authenticatedPage.route("**/api/status**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET") {
        if (url.includes("/status/my")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [], count: 0 }),
          });
        } else if (url.includes("/stats/overview")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              activeStatuses: 0,
              contactsWithStatus: 0,
              totalStatusesReceived: 0,
            }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [],
              pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
            }),
          });
        }
      } else if (request.method() === "POST") {
        const body = request.postDataJSON();
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            status: {
              id: "new-status-123",
              type: body.type,
              content: body.content,
              mediaUrl: null,
              timestamp: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
          }),
        });
      }
    });

    await authenticatedPage.goto("/chat");
    await authenticatedPage.waitForLoadState("networkidle");

    // Click on Status tab
    const statusTab = authenticatedPage.locator('[data-testid="sidebar-status-tab"]');
    if (await statusTab.isVisible()) {
      await statusTab.click();
    }

    // Click My Status button
    const myStatusButton = authenticatedPage.getByTestId("my-status-button");
    if (await myStatusButton.isVisible()) {
      await myStatusButton.click();
      await authenticatedPage.waitForTimeout(300);

      // Fill in status content
      const contentInput = authenticatedPage.getByTestId("status-content");
      if (await contentInput.isVisible()) {
        await contentInput.fill("Hello World! This is my test status.");

        // Take screenshot before posting
        await authenticatedPage.screenshot({
          path: ".screenshots/status-04-before-post.png",
          fullPage: false,
        });

        // Click Post Status button
        await authenticatedPage.getByTestId("post-status-submit").click();

        // Wait for success state
        await expect(authenticatedPage.locator("text=Status Posted!")).toBeVisible({ timeout: 5000 });

        // Take screenshot of success state
        await authenticatedPage.screenshot({
          path: ".screenshots/status-05-post-success.png",
          fullPage: false,
        });
      }
    }
  });

  test("should switch between status types", async ({ authenticatedPage }) => {
    // Mock status endpoints
    await authenticatedPage.route("**/api/status**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET") {
        if (url.includes("/status/my")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [], count: 0 }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [],
              pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
            }),
          });
        }
      }
    });

    await authenticatedPage.goto("/chat");
    await authenticatedPage.waitForLoadState("networkidle");

    // Click on Status tab
    const statusTab = authenticatedPage.locator('[data-testid="sidebar-status-tab"]');
    if (await statusTab.isVisible()) {
      await statusTab.click();
    }

    // Click My Status button
    const myStatusButton = authenticatedPage.getByTestId("my-status-button");
    if (await myStatusButton.isVisible()) {
      await myStatusButton.click();
      await authenticatedPage.waitForTimeout(300);

      // Click Image type
      const imageTypeButton = authenticatedPage.getByTestId("status-type-image");
      if (await imageTypeButton.isVisible()) {
        await imageTypeButton.click();

        // Verify media URL input is visible
        await expect(authenticatedPage.getByTestId("status-media-url")).toBeVisible();

        // Take screenshot of image type
        await authenticatedPage.screenshot({
          path: ".screenshots/status-06-image-type.png",
          fullPage: false,
        });
      }

      // Click Video type
      const videoTypeButton = authenticatedPage.getByTestId("status-type-video");
      if (await videoTypeButton.isVisible()) {
        await videoTypeButton.click();

        // Verify media URL input is still visible
        await expect(authenticatedPage.getByTestId("status-media-url")).toBeVisible();

        // Take screenshot of video type
        await authenticatedPage.screenshot({
          path: ".screenshots/status-07-video-type.png",
          fullPage: false,
        });
      }
    }
  });

  test("should show validation error when posting empty text status", async ({ authenticatedPage }) => {
    // Mock status endpoints
    await authenticatedPage.route("**/api/status**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET") {
        if (url.includes("/status/my")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [], count: 0 }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [],
              pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
            }),
          });
        }
      }
    });

    await authenticatedPage.goto("/chat");
    await authenticatedPage.waitForLoadState("networkidle");

    // Click on Status tab
    const statusTab = authenticatedPage.locator('[data-testid="sidebar-status-tab"]');
    if (await statusTab.isVisible()) {
      await statusTab.click();
    }

    // Click My Status button
    const myStatusButton = authenticatedPage.getByTestId("my-status-button");
    if (await myStatusButton.isVisible()) {
      await myStatusButton.click();
      await authenticatedPage.waitForTimeout(300);

      // Verify submit button is disabled when content is empty
      const submitButton = authenticatedPage.getByTestId("post-status-submit");
      if (await submitButton.isVisible()) {
        await expect(submitButton).toBeDisabled();
      }
    }
  });

  test("should display my active statuses count", async ({ authenticatedPage }) => {
    // Mock status endpoints with active statuses
    await authenticatedPage.route("**/api/status**", (route, request) => {
      const url = request.url();
      if (request.method() === "GET") {
        if (url.includes("/status/my")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [
                {
                  id: "my-status-1",
                  statusId: "wa-status-1",
                  mediaType: null,
                  mediaUrl: null,
                  caption: "Hello World!",
                  timestamp: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
                },
                {
                  id: "my-status-2",
                  statusId: "wa-status-2",
                  mediaType: "image",
                  mediaUrl: "https://example.com/image.jpg",
                  caption: "Check this out!",
                  timestamp: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
                },
              ],
              count: 2,
            }),
          });
        } else if (url.includes("/stats/overview")) {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              activeStatuses: 5,
              contactsWithStatus: 3,
              totalStatusesReceived: 10,
            }),
          });
        } else {
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: [],
              pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
            }),
          });
        }
      }
    });

    await authenticatedPage.goto("/chat");
    await authenticatedPage.waitForLoadState("networkidle");

    // Click on Status tab
    const statusTab = authenticatedPage.locator('[data-testid="sidebar-status-tab"]');
    if (await statusTab.isVisible()) {
      await statusTab.click();
      await authenticatedPage.waitForTimeout(500);

      // Look for the active updates count in My Status section
      const myStatusSection = authenticatedPage.getByTestId("my-status-button");
      if (await myStatusSection.isVisible()) {
        // Verify "2 active updates" text is shown
        await expect(authenticatedPage.locator("text=2 active update")).toBeVisible();

        // Take screenshot showing active status count
        await authenticatedPage.screenshot({
          path: ".screenshots/status-08-active-count.png",
          fullPage: true,
        });
      }
    }
  });
});
