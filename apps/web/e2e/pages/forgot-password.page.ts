import { Page, Locator } from "@playwright/test";

/**
 * Page Object Model for the Forgot Password Page
 */
export class ForgotPasswordPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly backToSignInLink: Locator;
  readonly successHeading: Locator;
  readonly successMessage: Locator;
  readonly tryAgainButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator("#email");
    this.submitButton = page.getByRole("button", { name: /reset password/i });
    this.errorMessage = page.locator(".bg-red-50");
    this.backToSignInLink = page.getByRole("link", { name: /back to sign in/i });
    this.successHeading = page.getByRole("heading", { name: /check your email/i });
    this.successMessage = page.getByText(/we've sent a password reset link/i);
    this.tryAgainButton = page.getByRole("button", { name: /try again/i });
  }

  async goto() {
    await this.page.goto("/forgot-password");
  }

  async submitEmail(email: string) {
    await this.emailInput.fill(email);
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
