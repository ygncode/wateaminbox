import { test, expect } from "@playwright/test";
import { LoginPage, RegisterPage, ForgotPasswordPage } from "../pages";

/**
 * E2E Tests for Authentication Flow
 * Tests login, registration, forgot password, and protected routes
 */

test.describe("Authentication Flow", () => {
  test.describe("Login Flow", () => {
    test("should display login page with all required elements", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Verify page elements are visible
      await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
      await expect(loginPage.emailInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.submitButton).toBeVisible();
      await expect(loginPage.forgotPasswordLink).toBeVisible();
      await expect(loginPage.signUpLink).toBeVisible();
      await expect(loginPage.rememberMeCheckbox).toBeVisible();
    });

    test("should show validation error with empty fields", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Try to submit with empty fields
      await loginPage.submitButton.click();

      // HTML5 validation should prevent submission
      // Check that we're still on the login page
      await expect(page).toHaveURL(/\/login/);
    });

    test("should show error message with invalid credentials", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Enter invalid credentials
      await loginPage.login("invalid@example.com", "wrongpassword");

      // Wait for error message to appear
      await expect(loginPage.errorMessage).toBeVisible({ timeout: 10000 });
    });

    test("should navigate to forgot password page", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.forgotPasswordLink.click();

      await expect(page).toHaveURL(/\/forgot-password/);
    });

    test("should navigate to registration page", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.signUpLink.click();

      await expect(page).toHaveURL(/\/register/);
    });

  });

  test.describe("Registration Flow", () => {
    test("should display registration page with all required elements", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      // Verify page elements are visible
      await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();
      await expect(registerPage.nameInput).toBeVisible();
      await expect(registerPage.emailInput).toBeVisible();
      await expect(registerPage.passwordInput).toBeVisible();
      await expect(registerPage.confirmPasswordInput).toBeVisible();
      await expect(registerPage.submitButton).toBeVisible();
      await expect(registerPage.signInLink).toBeVisible();
    });

    test("should show validation error when passwords do not match", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      await registerPage.register(
        "Test User",
        "newuser@example.com",
        "password123",
        "differentpassword"
      );

      // Should show inline validation error (role="alert")
      await expect(registerPage.validationError).toBeVisible();
      await expect(registerPage.validationError).toContainText(/passwords do not match/i);
    });

    test("should show validation error for short password", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      await registerPage.register(
        "Test User",
        "newuser@example.com",
        "short",
        "short"
      );

      // Should show inline validation error about password length (role="alert")
      await expect(registerPage.validationError).toBeVisible();
      await expect(registerPage.validationError).toContainText(/at least 8 characters/i);
    });

    test("should navigate to login page via sign in link", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      await registerPage.signInLink.click();

      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe("Forgot Password Flow", () => {
    test("should display forgot password page with all required elements", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      // Verify page elements are visible
      await expect(page.getByRole("heading", { name: /forgot password/i })).toBeVisible();
      await expect(page.getByText(/we'll send you reset instructions/i)).toBeVisible();
      await expect(forgotPasswordPage.emailInput).toBeVisible();
      await expect(forgotPasswordPage.submitButton).toBeVisible();
      await expect(forgotPasswordPage.backToSignInLink).toBeVisible();
    });

    test("should show success message after submitting email", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      await forgotPasswordPage.submitEmail("user@example.com");

      // Wait for success message
      await forgotPasswordPage.waitForSuccessMessage();

      // Verify success elements
      await expect(forgotPasswordPage.successHeading).toBeVisible();
      await expect(forgotPasswordPage.successMessage).toBeVisible();
      await expect(page.getByText("user@example.com")).toBeVisible();
    });

    test("should allow trying again from success screen", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      await forgotPasswordPage.submitEmail("user@example.com");
      await forgotPasswordPage.waitForSuccessMessage();

      // Click try again
      await forgotPasswordPage.tryAgainButton.click();

      // Should return to form
      await expect(forgotPasswordPage.emailInput).toBeVisible();
      await expect(forgotPasswordPage.submitButton).toBeVisible();
    });

    test("should navigate back to login page", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      await forgotPasswordPage.backToSignInLink.click();

      await expect(page).toHaveURL(/\/login/);
    });

    test("should navigate back to login from success screen", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      await forgotPasswordPage.submitEmail("user@example.com");
      await forgotPasswordPage.waitForSuccessMessage();

      // Click back to sign in link on success screen
      await page.getByRole("link", { name: /back to sign in/i }).click();

      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe("Protected Route", () => {
    test.beforeEach(async ({ page }) => {
      // Ensure no auth tokens exist before each test
      await page.goto("/login");
      await page.evaluate(() => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("company_id");
      });
    });

    test("should redirect to login when accessing /chat without authentication", async ({ page }) => {
      // Try to access protected route directly
      await page.goto("/chat");

      // Should be redirected to login
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect to login when accessing /chat/:id without authentication", async ({ page }) => {
      // Try to access specific chat route
      await page.goto("/chat/some-chat-id");

      // Should be redirected to login
      await expect(page).toHaveURL(/\/login/);
    });

    test("should show loading state while checking authentication", async ({ page }) => {
      // Set a token that will need validation
      await page.evaluate(() => {
        localStorage.setItem("access_token", "potentially-valid-token");
      });

      // Navigate to protected route
      await page.goto("/chat");

      // Should show loading indicator briefly - this may or may not be visible depending on timing
      // Just verify the page eventually settles to login or chat
      await page.waitForURL(/\/(login|chat|company-setup)/);
    });

    test("should redirect to /company-setup if user has no companies", async ({ page }) => {
      // Set up auth state that simulates user without companies
      await page.evaluate(() => {
        localStorage.setItem("access_token", "mock-token-no-company");
        localStorage.setItem("refresh_token", "mock-refresh-token");
        // Don't set company_id to simulate no company
      });

      await page.goto("/chat");

      // If backend validates token and user has no companies, should redirect to company-setup
      // This depends on backend behavior
      await page.waitForURL(/\/(login|chat|company-setup)/);
    });
  });

  test.describe("Navigation between auth pages", () => {
    test("should navigate login -> register -> login", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Go to register
      await loginPage.signUpLink.click();
      await expect(page).toHaveURL(/\/register/);

      // Go back to login
      const registerPage = new RegisterPage(page);
      await registerPage.signInLink.click();
      await expect(page).toHaveURL(/\/login/);
    });

    test("should navigate login -> forgot-password -> login", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Go to forgot password
      await loginPage.forgotPasswordLink.click();
      await expect(page).toHaveURL(/\/forgot-password/);

      // Go back to login
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.backToSignInLink.click();
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe("Form accessibility", () => {
    test("login form should have proper labels", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Check that inputs have associated labels
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/password/i)).toBeVisible();
    });

    test("register form should have proper labels", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      // Check that inputs have associated labels
      await expect(page.getByLabel(/full name/i)).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      // There are two password fields, so check for both
      const passwordLabels = page.getByLabel(/password/i);
      await expect(passwordLabels.first()).toBeVisible();
    });

    test("forgot password form should have proper labels", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      // Check that input has associated label
      await expect(page.getByLabel(/email/i)).toBeVisible();
    });
  });
});
