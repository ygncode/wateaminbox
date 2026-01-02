import { Page, Locator } from "@playwright/test";

/**
 * Base Page Object Model class
 * All page objects should extend this class
 */
export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to the page
   */
  abstract goto(): Promise<void>;

  /**
   * Wait for the page to be fully loaded
   */
  abstract waitForPageLoad(): Promise<void>;

  /**
   * Get a locator by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Get a locator by role
   */
  getByRole(
    role: Parameters<Page["getByRole"]>[0],
    options?: Parameters<Page["getByRole"]>[1]
  ): Locator {
    return this.page.getByRole(role, options);
  }

  /**
   * Get a locator by text
   */
  getByText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  /**
   * Get a locator by placeholder
   */
  getByPlaceholder(text: string | RegExp): Locator {
    return this.page.getByPlaceholder(text);
  }

  /**
   * Take a screenshot
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png` });
  }
}
