import { test, expect } from "@playwright/test";

test.describe("Documentation Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/docs");
  });

  test.describe("Page Structure", () => {
    test("should display documentation page title", async ({ page }) => {
      await expect(page.locator("h1")).toContainText("Documentation");
    });

    test("should display sidebar navigation", async ({ page }) => {
      const sidebar = page.locator("aside nav");
      await expect(sidebar).toBeVisible();
      await expect(sidebar.locator("h2")).toContainText("Documentation");
    });

    test("should have all sidebar navigation links", async ({ page }) => {
      const navLinks = page.locator("aside nav ul li a");
      await expect(navLinks).toHaveCount(8);

      const expectedLinks = [
        "Getting Started",
        "Installation",
        "Configuration",
        "Connecting WhatsApp",
        "Team Management",
        "Features",
        "API Reference",
        "FAQ",
      ];

      for (let i = 0; i < expectedLinks.length; i++) {
        await expect(navLinks.nth(i)).toContainText(expectedLinks[i]);
      }
    });
  });

  test.describe("Getting Started Section", () => {
    test("should display getting started section", async ({ page }) => {
      const section = page.locator("#getting-started");
      await expect(section).toBeVisible();
      await expect(section.locator("h2")).toContainText("Getting Started");
    });

    test("should display 4 setup steps", async ({ page }) => {
      const steps = page.locator("#getting-started .rounded-lg.bg-gray-50");
      await expect(steps).toHaveCount(4);

      await expect(steps.nth(0)).toContainText("Step 1: Create an Account");
      await expect(steps.nth(1)).toContainText("Step 2: Create or Join a Company");
      await expect(steps.nth(2)).toContainText("Step 3: Connect Your WhatsApp");
      await expect(steps.nth(3)).toContainText("Step 4: Start Collaborating");
    });
  });

  test.describe("Installation Section", () => {
    test("should display installation section", async ({ page }) => {
      const section = page.locator("#installation");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("Installation");
    });

    test("should list prerequisites", async ({ page }) => {
      const section = page.locator("#installation");
      await expect(section).toContainText("Bun");
      await expect(section).toContainText("Go");
      await expect(section).toContainText("Docker");
      await expect(section).toContainText("Git");
    });

    test("should display quick start code block", async ({ page }) => {
      const codeBlock = page.locator("#installation pre code");
      await expect(codeBlock.first()).toBeVisible();
      await expect(codeBlock.first()).toContainText("git clone");
      await expect(codeBlock.first()).toContainText("bun install");
      await expect(codeBlock.first()).toContainText("docker-compose up -d");
    });

    test("should display services table", async ({ page }) => {
      const table = page.locator("#installation table");
      await expect(table).toBeVisible();

      // Check service names
      await expect(table).toContainText("Web App");
      await expect(table).toContainText("API Server");
      await expect(table).toContainText("PostgreSQL");
      await expect(table).toContainText("NATS");
      await expect(table).toContainText("Meilisearch");
      await expect(table).toContainText("MinIO");
    });
  });

  test.describe("Configuration Section", () => {
    test("should display configuration section", async ({ page }) => {
      const section = page.locator("#configuration");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("Configuration");
    });

    test("should display web app configuration code", async ({ page }) => {
      const section = page.locator("#configuration");
      await expect(section).toContainText("VITE_API_URL");
      await expect(section).toContainText("VITE_WS_URL");
    });

    test("should display API server configuration code", async ({ page }) => {
      const section = page.locator("#configuration");
      await expect(section).toContainText("DATABASE_URL");
      await expect(section).toContainText("JWT_SECRET");
      await expect(section).toContainText("NATS_URL");
      await expect(section).toContainText("RESEND_API_KEY");
      await expect(section).toContainText("STORAGE_BUCKET");
    });

    test("should display production considerations", async ({ page }) => {
      const section = page.locator("#configuration");
      await expect(section).toContainText("Production Considerations");
      await expect(section).toContainText("SSL/TLS");
      await expect(section).toContainText("Cloudflare R2");
    });
  });

  test.describe("Connecting WhatsApp Section", () => {
    test("should display connecting WhatsApp section", async ({ page }) => {
      const section = page.locator("#connecting-whatsapp");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("Connecting WhatsApp");
    });

    test("should display QR code connection steps", async ({ page }) => {
      const section = page.locator("#connecting-whatsapp");
      await expect(section).toContainText("Navigate to Settings");
      await expect(section).toContainText("Connect WhatsApp");
      await expect(section).toContainText("Scan the QR code");
    });

    test("should display important notes", async ({ page }) => {
      const section = page.locator("#connecting-whatsapp");
      await expect(section).toContainText("Important Notes");
      await expect(section).toContainText("QR code expires after 60 seconds");
    });

    test("should display connection status indicators", async ({ page }) => {
      const section = page.locator("#connecting-whatsapp");
      await expect(section).toContainText("Connected");
      await expect(section).toContainText("Reconnecting");
      await expect(section).toContainText("Disconnected");
    });
  });

  test.describe("Team Management Section", () => {
    test("should display team management section", async ({ page }) => {
      const section = page.locator("#team-management");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("Team Management");
    });

    test("should display roles and permissions table", async ({ page }) => {
      const table = page.locator("#team-management table");
      await expect(table).toBeVisible();

      // Check headers
      await expect(table).toContainText("Owner");
      await expect(table).toContainText("Admin");
      await expect(table).toContainText("Member");

      // Check permissions
      await expect(table).toContainText("View all chats");
      await expect(table).toContainText("Send messages");
      await expect(table).toContainText("Assign contacts");
      await expect(table).toContainText("Manage team");
    });

    test("should display inviting team members steps", async ({ page }) => {
      const section = page.locator("#team-management");
      await expect(section).toContainText("Inviting Team Members");
      await expect(section).toContainText("Navigate to Team");
      await expect(section).toContainText("Invite Member");
    });

    test("should display contact assignment info", async ({ page }) => {
      const section = page.locator("#team-management");
      await expect(section).toContainText("Contact Assignment");
      await expect(section).toContainText("Self-assign");
      await expect(section).toContainText("Auto-assign");
      await expect(section).toContainText("Transfer");
    });
  });

  test.describe("Features Section", () => {
    test("should display features section", async ({ page }) => {
      const section = page.locator("#features");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("Features");
    });

    test("should display feature cards grid", async ({ page }) => {
      const featureCards = page.locator("#features .grid .rounded-lg.border");
      await expect(featureCards).toHaveCount(8);
    });

    test("should display messaging features", async ({ page }) => {
      const section = page.locator("#features");
      await expect(section).toContainText("Messaging");
      await expect(section).toContainText("Reply to specific messages");
      await expect(section).toContainText("Forward messages");
      await expect(section).toContainText("Message reactions");
    });

    test("should display keyboard shortcuts table", async ({ page }) => {
      const table = page.locator("#features table");
      await expect(table).toBeVisible();

      await expect(table).toContainText("Ctrl/Cmd + N");
      await expect(table).toContainText("Ctrl/Cmd + F");
      await expect(table).toContainText("Escape");
      await expect(table).toContainText("Enter");
      await expect(table).toContainText("Arrow Up/Down");
    });
  });

  test.describe("API Reference Section", () => {
    test("should display API reference section", async ({ page }) => {
      const section = page.locator("#api-reference");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("API Reference");
    });

    test("should display authentication header example", async ({ page }) => {
      const section = page.locator("#api-reference");
      await expect(section).toContainText("Authorization: Bearer");
      await expect(section).toContainText("X-Company-ID");
    });

    test("should display core API endpoints", async ({ page }) => {
      const section = page.locator("#api-reference");
      await expect(section).toContainText("/api/auth/register");
      await expect(section).toContainText("/api/auth/login");
      await expect(section).toContainText("/api/contacts");
      await expect(section).toContainText("/api/messages");
      await expect(section).toContainText("/api/search");
      await expect(section).toContainText("/api/whatsapp/status");
      await expect(section).toContainText("/api/export/full");
    });

    test("should display WebSocket events", async ({ page }) => {
      const section = page.locator("#api-reference");
      await expect(section).toContainText("WebSocket Events");
      await expect(section).toContainText("message:new");
      await expect(section).toContainText("message:status");
      await expect(section).toContainText("contact:update");
      await expect(section).toContainText("whatsapp:status");
    });
  });

  test.describe("FAQ Section", () => {
    test("should display FAQ section", async ({ page }) => {
      const section = page.locator("#faq");
      await expect(section).toBeVisible();
      await expect(section.locator("h2").first()).toContainText("Frequently Asked Questions");
    });

    test("should display FAQ items", async ({ page }) => {
      const faqItems = page.locator("#faq .rounded-lg.border");
      await expect(faqItems).toHaveCount(8);
    });

    test("should display common FAQ questions", async ({ page }) => {
      const section = page.locator("#faq");
      await expect(section).toContainText("How many team members can I add?");
      await expect(section).toContainText("Can I use WhatsApp Business?");
      await expect(section).toContainText("What happens if I disconnect?");
      await expect(section).toContainText("Is my data secure?");
      await expect(section).toContainText("Can I export my data?");
      await expect(section).toContainText("What languages are supported?");
      await expect(section).toContainText("How do I self-host?");
      await expect(section).toContainText("Is there rate limiting?");
    });
  });

  test.describe("Navigation", () => {
    test("should navigate to sections via sidebar links", async ({ page }) => {
      // Click on Installation link
      await page.click('aside nav a[href="#installation"]');
      await expect(page).toHaveURL(/.*#installation/);

      // Check the section is visible
      const installSection = page.locator("#installation");
      await expect(installSection).toBeInViewport();
    });

    test("should have scroll-to offset for sections", async ({ page }) => {
      // Navigate to FAQ section
      await page.click('aside nav a[href="#faq"]');

      // Wait for scroll
      await page.waitForTimeout(500);

      // Check FAQ section is visible
      const faqSection = page.locator("#faq");
      await expect(faqSection).toBeInViewport();
    });
  });

  test.describe("Need Help Section", () => {
    test("should display need help section", async ({ page }) => {
      const section = page.locator('main section:last-child');
      await expect(section.locator("h2")).toContainText("Need Help?");
    });

    test("should display contact support button", async ({ page }) => {
      const contactButton = page.locator('a:has-text("Contact Support")');
      await expect(contactButton).toBeVisible();
      await expect(contactButton).toHaveAttribute("href", /mailto:/);
    });

    test("should display report issue button", async ({ page }) => {
      const issueButton = page.locator('a:has-text("Report an Issue")');
      await expect(issueButton).toBeVisible();
      await expect(issueButton).toHaveAttribute("href", /github.*issues/);
    });
  });

  test.describe("Responsive Design", () => {
    test("should hide sidebar on mobile", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const sidebar = page.locator("aside");
      await expect(sidebar).not.toBeVisible();
    });

    test("should show sidebar on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      const sidebar = page.locator("aside");
      await expect(sidebar).toBeVisible();
    });
  });
});
