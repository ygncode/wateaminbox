import { Page, Locator } from "@playwright/test";

/**
 * Page Object Model for the Login Page
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly forgotPasswordLink: Locator;
  readonly signUpLink: Locator;
  readonly rememberMeCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator("#email");
    this.passwordInput = page.locator("#password");
    this.submitButton = page.getByRole("button", { name: /sign in/i });
    // Error messages should use role="alert" - fallback to class if not present
    this.errorMessage = page.locator('[role="alert"], .bg-red-50').first();
    this.forgotPasswordLink = page.getByRole("link", { name: /forgot password/i });
    this.signUpLink = page.getByRole("link", { name: /sign up/i });
    this.rememberMeCheckbox = page.getByRole("checkbox");
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async waitForLoginComplete() {
    // Wait for navigation away from login page
    await this.page.waitForURL(/\/(chat|company-setup)/);
  }

  async getErrorMessage() {
    await this.errorMessage.waitFor({ state: "visible" });
    return this.errorMessage.textContent();
  }
}
