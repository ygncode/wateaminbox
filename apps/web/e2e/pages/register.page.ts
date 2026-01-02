import { Page, Locator } from "@playwright/test";

/**
 * Page Object Model for the Registration Page
 */
export class RegisterPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly signInLink: Locator;
  readonly successHeading: Locator;
  readonly goToLoginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.locator("#name");
    this.emailInput = page.locator("#email");
    this.passwordInput = page.locator("#password");
    this.confirmPasswordInput = page.locator("#confirmPassword");
    this.submitButton = page.getByRole("button", { name: /create account/i });
    this.errorMessage = page.locator(".bg-red-50");
    this.signInLink = page.getByRole("link", { name: /sign in/i });
    this.successHeading = page.getByRole("heading", { name: /check your email/i });
    this.goToLoginButton = page.getByRole("link", { name: /go to login/i });
  }

  async goto() {
    await this.page.goto("/register");
  }

  async register(name: string, email: string, password: string, confirmPassword: string) {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword);
    await this.submitButton.click();
  }

  async waitForSuccessMessage() {
    await this.successHeading.waitFor({ state: "visible" });
  }

  async getErrorMessage() {
    await this.errorMessage.waitFor({ state: "visible" });
    return this.errorMessage.textContent();
  }
}
