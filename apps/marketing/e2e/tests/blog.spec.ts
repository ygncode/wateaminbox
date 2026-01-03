import { test, expect } from "@playwright/test";

test.describe("Blog Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/blog");
  });

  test.describe("Page Structure", () => {
    test("should display blog page title", async ({ page }) => {
      await expect(page.locator("h1")).toContainText("Blog");
    });

    test("should display blog description", async ({ page }) => {
      await expect(page.locator("p.text-lg.text-gray-600").first()).toContainText(
        "Latest news, product updates, guides, and insights"
      );
    });

    test("should display category filter", async ({ page }) => {
      const categoryFilter = page.locator('[data-testid="category-filter"]');
      await expect(categoryFilter).toBeVisible();
    });

    test("should have all category buttons", async ({ page }) => {
      const categories = [
        "All",
        "Product Update",
        "Guide",
        "Analytics",
        "Security",
        "Tips & Tricks",
        "Getting Started",
      ];

      for (const category of categories) {
        const button = page.locator(`[data-testid="category-filter"] button`, {
          hasText: category,
        });
        await expect(button).toBeVisible();
      }
    });
  });

  test.describe("Featured Post", () => {
    test("should display featured post section", async ({ page }) => {
      const featuredPost = page.locator('[data-testid="featured-post"]');
      await expect(featuredPost).toBeVisible();
    });

    test("should display featured badge", async ({ page }) => {
      const featuredPost = page.locator('[data-testid="featured-post"]');
      await expect(featuredPost.locator("span", { hasText: "Featured" })).toBeVisible();
    });

    test("should display featured post title", async ({ page }) => {
      const featuredPost = page.locator('[data-testid="featured-post"]');
      await expect(featuredPost.locator("h2 a")).toContainText(
        "Introducing WhatsApp Business Labels Sync"
      );
    });

    test("should have read article button", async ({ page }) => {
      const featuredPost = page.locator('[data-testid="featured-post"]');
      await expect(featuredPost.locator("a", { hasText: "Read Article" })).toBeVisible();
    });

    test("should link to correct blog post", async ({ page }) => {
      const featuredPost = page.locator('[data-testid="featured-post"]');
      const link = featuredPost.locator("h2 a");
      await expect(link).toHaveAttribute(
        "href",
        "/blog/introducing-whatsapp-business-labels-sync"
      );
    });
  });

  test.describe("Blog Grid", () => {
    test("should display blog grid", async ({ page }) => {
      const blogGrid = page.locator('[data-testid="blog-grid"]');
      await expect(blogGrid).toBeVisible();
    });

    test("should display 5 blog posts in grid (excluding featured)", async ({ page }) => {
      const blogGrid = page.locator('[data-testid="blog-grid"]');
      const articles = blogGrid.locator("article");
      await expect(articles).toHaveCount(5);
    });

    test("should display Team Collaboration post", async ({ page }) => {
      const post = page.locator('[data-testid="blog-post-team-collaboration-best-practices"]');
      await expect(post).toBeVisible();
      await expect(post.locator("h2")).toContainText(
        "Team Collaboration Best Practices for WhatsApp Business"
      );
    });

    test("should display Customer Engagement Metrics post", async ({ page }) => {
      const post = page.locator(
        '[data-testid="blog-post-understanding-customer-engagement-metrics"]'
      );
      await expect(post).toBeVisible();
      await expect(post.locator("h2")).toContainText(
        "Understanding Customer Engagement Metrics"
      );
    });

    test("should display Security Best Practices post", async ({ page }) => {
      const post = page.locator('[data-testid="blog-post-security-best-practices-whatsapp-web"]');
      await expect(post).toBeVisible();
      await expect(post.locator("h2")).toContainText(
        "Security Best Practices for WhatsApp Web"
      );
    });

    test("should display Quick Replies post", async ({ page }) => {
      const post = page.locator('[data-testid="blog-post-quick-replies-boost-productivity"]');
      await expect(post).toBeVisible();
      await expect(post.locator("h2")).toContainText(
        "How Quick Replies Can Boost Your Team's Productivity"
      );
    });

    test("should display Getting Started post", async ({ page }) => {
      const post = page.locator('[data-testid="blog-post-getting-started-with-whatsapp-web"]');
      await expect(post).toBeVisible();
      await expect(post.locator("h2")).toContainText(
        "Getting Started with WhatsApp Web Platform"
      );
    });

    test("each blog post should have category badge", async ({ page }) => {
      const posts = page.locator('[data-testid="blog-grid"] article');
      const count = await posts.count();

      for (let i = 0; i < count; i++) {
        const badge = posts.nth(i).locator("span.rounded-full").first();
        await expect(badge).toBeVisible();
      }
    });

    test("each blog post should have read time", async ({ page }) => {
      const posts = page.locator('[data-testid="blog-grid"] article');
      const count = await posts.count();

      for (let i = 0; i < count; i++) {
        await expect(posts.nth(i)).toContainText("min read");
      }
    });

    test("each blog post should have Read more link", async ({ page }) => {
      const posts = page.locator('[data-testid="blog-grid"] article');
      const count = await posts.count();

      for (let i = 0; i < count; i++) {
        const link = posts.nth(i).locator("a", { hasText: "Read more" });
        await expect(link).toBeVisible();
      }
    });
  });

  test.describe("Newsletter Section", () => {
    test("should display newsletter section", async ({ page }) => {
      const newsletter = page.locator('[data-testid="newsletter-section"]');
      await expect(newsletter).toBeVisible();
    });

    test("should display newsletter title", async ({ page }) => {
      const newsletter = page.locator('[data-testid="newsletter-section"]');
      await expect(newsletter.locator("h2")).toContainText(
        "Stay updated with our newsletter"
      );
    });

    test("should display newsletter form", async ({ page }) => {
      const form = page.locator('[data-testid="newsletter-form"]');
      await expect(form).toBeVisible();
    });

    test("should have email input", async ({ page }) => {
      const input = page.locator('[data-testid="newsletter-email-input"]');
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute("type", "email");
      await expect(input).toHaveAttribute("placeholder", "Enter your email");
    });

    test("should have subscribe button", async ({ page }) => {
      const button = page.locator('[data-testid="newsletter-submit-button"]');
      await expect(button).toBeVisible();
      await expect(button).toContainText("Subscribe");
    });

    test("should display no spam notice", async ({ page }) => {
      const newsletter = page.locator('[data-testid="newsletter-section"]');
      await expect(newsletter).toContainText("No spam, unsubscribe at any time");
    });
  });

  test.describe("Pagination", () => {
    test("should display pagination", async ({ page }) => {
      const pagination = page.locator('[data-testid="pagination"]');
      await expect(pagination).toBeVisible();
    });

    test("should have Previous button disabled on first page", async ({ page }) => {
      const prevButton = page.locator('[data-testid="pagination"] button', {
        hasText: "Previous",
      });
      await expect(prevButton).toBeDisabled();
    });

    test("should display page numbers", async ({ page }) => {
      const pagination = page.locator('[data-testid="pagination"]');
      await expect(pagination.locator("button", { hasText: "1" })).toBeVisible();
      await expect(pagination.locator("button", { hasText: "2" })).toBeVisible();
    });

    test("should have Next button", async ({ page }) => {
      const nextButton = page.locator('[data-testid="pagination"] button', {
        hasText: "Next",
      });
      await expect(nextButton).toBeVisible();
    });
  });
});

test.describe("Blog Post Pages", () => {
  test.describe("Labels Sync Post", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/blog/introducing-whatsapp-business-labels-sync");
    });

    test("should display blog post title", async ({ page }) => {
      await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
        "Introducing WhatsApp Business Labels Sync"
      );
    });

    test("should display Product Update category", async ({ page }) => {
      await expect(page.locator("span.rounded-full").first()).toContainText(
        "Product Update"
      );
    });

    test("should display blog content", async ({ page }) => {
      const content = page.locator('[data-testid="blog-post-content"]');
      await expect(content).toBeVisible();
      await expect(content).toContainText("What is Labels Sync?");
      await expect(content).toContainText("Bidirectional Sync");
      await expect(content).toContainText("API Access");
    });

    test("should have back to blog link", async ({ page }) => {
      const backLink = page.locator("a", { hasText: "Back to Blog" });
      await expect(backLink).toBeVisible();
      await expect(backLink).toHaveAttribute("href", "/blog");
    });

    test("should display related articles", async ({ page }) => {
      await expect(page.locator("h3", { hasText: "Related Articles" })).toBeVisible();
    });
  });

  test.describe("Team Collaboration Post", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/blog/team-collaboration-best-practices");
    });

    test("should display blog post title", async ({ page }) => {
      await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
        "Team Collaboration Best Practices for WhatsApp Business"
      );
    });

    test("should display Guide category", async ({ page }) => {
      await expect(page.locator("span.rounded-full").first()).toContainText("Guide");
    });

    test("should display content about roles", async ({ page }) => {
      const content = page.locator('[data-testid="blog-post-content"]');
      await expect(content).toContainText("Understanding Roles and Permissions");
      await expect(content).toContainText("Owner");
      await expect(content).toContainText("Admin");
      await expect(content).toContainText("Member");
    });
  });

  test.describe("Customer Engagement Post", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/blog/understanding-customer-engagement-metrics");
    });

    test("should display blog post title", async ({ page }) => {
      await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
        "Understanding Customer Engagement Metrics"
      );
    });

    test("should display Analytics category", async ({ page }) => {
      await expect(page.locator("span.rounded-full").first()).toContainText("Analytics");
    });

    test("should display engagement metrics content", async ({ page }) => {
      const content = page.locator('[data-testid="blog-post-content"]');
      await expect(content).toContainText("Engagement Score");
      await expect(content).toContainText("Active Contacts Rate");
      await expect(content).toContainText("Response Rate");
    });
  });

  test.describe("Security Post", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/blog/security-best-practices-whatsapp-web");
    });

    test("should display blog post title", async ({ page }) => {
      await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
        "Security Best Practices for WhatsApp Web"
      );
    });

    test("should display Security category", async ({ page }) => {
      await expect(page.locator("span.rounded-full").first()).toContainText("Security");
    });

    test("should display security content", async ({ page }) => {
      const content = page.locator('[data-testid="blog-post-content"]');
      await expect(content).toContainText("Account Security");
      await expect(content).toContainText("Data Protection");
      await expect(content).toContainText("Multi-Tenant Isolation");
    });
  });

  test.describe("Quick Replies Post", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/blog/quick-replies-boost-productivity");
    });

    test("should display blog post title", async ({ page }) => {
      await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
        "How Quick Replies Can Boost Your Team's Productivity"
      );
    });

    test("should display Tips & Tricks category", async ({ page }) => {
      await expect(page.locator("span.rounded-full").first()).toContainText("Tips & Tricks");
    });

    test("should display quick reply examples", async ({ page }) => {
      const content = page.locator('[data-testid="blog-post-content"]');
      await expect(content).toContainText("/greeting");
      await expect(content).toContainText("/thanks");
      await expect(content).toContainText("Customer Service Templates");
    });
  });

  test.describe("Getting Started Post", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/blog/getting-started-with-whatsapp-web");
    });

    test("should display blog post title", async ({ page }) => {
      await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
        "Getting Started with WhatsApp Web Platform"
      );
    });

    test("should display Getting Started category", async ({ page }) => {
      await expect(page.locator("span.rounded-full").first()).toContainText("Getting Started");
    });

    test("should display step-by-step guide", async ({ page }) => {
      const content = page.locator('[data-testid="blog-post-content"]');
      await expect(content).toContainText("Step 1: Create Your Account");
      await expect(content).toContainText("Step 2: Set Up Your Company");
      await expect(content).toContainText("Step 3: Connect Your WhatsApp");
      await expect(content).toContainText("Step 4: Your First Conversation");
    });

    test("should display continue learning section", async ({ page }) => {
      await expect(page.locator("h3", { hasText: "Continue Learning" })).toBeVisible();
    });
  });
});

test.describe("Blog Navigation", () => {
  test("should navigate from blog list to blog post", async ({ page }) => {
    await page.goto("/blog");
    const post = page.locator('[data-testid="blog-post-team-collaboration-best-practices"]');
    await post.locator("a", { hasText: "Read more" }).click();
    await expect(page).toHaveURL("/blog/team-collaboration-best-practices");
    await expect(page.locator('[data-testid="blog-post-title"]')).toContainText(
      "Team Collaboration"
    );
  });

  test("should navigate back to blog list from post", async ({ page }) => {
    await page.goto("/blog/security-best-practices-whatsapp-web");
    await page.locator("a", { hasText: "Back to Blog" }).last().click();
    await expect(page).toHaveURL(/\/blog\/?$/);
    await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
  });

  test("should navigate to featured post", async ({ page }) => {
    await page.goto("/blog");
    const featuredPost = page.locator('[data-testid="featured-post"]');
    await featuredPost.locator("a", { hasText: "Read Article" }).click();
    await expect(page).toHaveURL("/blog/introducing-whatsapp-business-labels-sync");
  });
});

test.describe("Responsive Design", () => {
  test("should be responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/blog");

    // Should still show blog title
    await expect(page.locator("h1")).toContainText("Blog");

    // Featured post should be visible
    await expect(page.locator('[data-testid="featured-post"]')).toBeVisible();

    // Blog grid should stack on mobile
    const blogGrid = page.locator('[data-testid="blog-grid"]');
    await expect(blogGrid).toBeVisible();

    // Newsletter should be visible
    await expect(page.locator('[data-testid="newsletter-section"]')).toBeVisible();
  });

  test("should show blog grid in columns on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/blog");

    const blogGrid = page.locator('[data-testid="blog-grid"]');
    await expect(blogGrid).toBeVisible();

    // Grid should have 3 columns on desktop (lg:grid-cols-3)
    await expect(blogGrid).toHaveClass(/lg:grid-cols-3/);
  });
});
