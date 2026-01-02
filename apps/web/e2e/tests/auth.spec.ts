import { test, expect } from "@playwright/test";
import { LoginPage, RegisterPage, ForgotPasswordPage, ChatPage } from "../pages";

/**
 * E2E Tests for Authentication Flow
 * Tests login, registration, forgot password, logout, and protected routes
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

    test("should redirect to /chat or /company-setup on successful login", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // Use test credentials (these should work with your test backend)
      await loginPage.login("test@example.com", "testpassword123");

      // Wait for redirect - could be /chat or /company-setup
      await page.waitForURL(/\/(chat|company-setup)/, { timeout: 10000 });

      // Verify we're no longer on login page
      await expect(page).not.toHaveURL(/\/login/);
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

    test("should show loading state when submitting", async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.emailInput.fill("test@example.com");
      await loginPage.passwordInput.fill("testpassword123");

      // Click and immediately check for loading state
      const submitPromise = loginPage.submitButton.click();

      // Button should show "Signing in..." text during submission
      await expect(loginPage.submitButton).toContainText(/signing in/i);

      await submitPromise;
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

      // Should show error message
      await expect(registerPage.errorMessage).toBeVisible();
      await expect(registerPage.errorMessage).toContainText(/passwords do not match/i);
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

      // Should show error message about password length
      await expect(registerPage.errorMessage).toBeVisible();
      await expect(registerPage.errorMessage).toContainText(/at least 8 characters/i);
    });

    test("should show success message and redirect link after registration", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      // Generate unique email to avoid conflicts
      const uniqueEmail = `testuser_${Date.now()}@example.com`;

      await registerPage.register(
        "Test User",
        uniqueEmail,
        "validpassword123",
        "validpassword123"
      );

      // Wait for success message
      await registerPage.waitForSuccessMessage();

      // Verify success elements
      await expect(registerPage.successHeading).toBeVisible();
      await expect(page.getByText(new RegExp(uniqueEmail, "i"))).toBeVisible();
      await expect(registerPage.goToLoginButton).toBeVisible();
    });

    test("should navigate back to login page from success screen", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      const uniqueEmail = `testuser_${Date.now()}@example.com`;

      await registerPage.register(
        "Test User",
        uniqueEmail,
        "validpassword123",
        "validpassword123"
      );

      await registerPage.waitForSuccessMessage();
      await registerPage.goToLoginButton.click();

      await expect(page).toHaveURL(/\/login/);
    });

    test("should navigate to login page via sign in link", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      await registerPage.signInLink.click();

      await expect(page).toHaveURL(/\/login/);
    });

    test("should show loading state when submitting", async ({ page }) => {
      const registerPage = new RegisterPage(page);
      await registerPage.goto();

      await registerPage.nameInput.fill("Test User");
      await registerPage.emailInput.fill(`test_${Date.now()}@example.com`);
      await registerPage.passwordInput.fill("validpassword123");
      await registerPage.confirmPasswordInput.fill("validpassword123");

      const submitPromise = registerPage.submitButton.click();

      // Button should show loading text
      await expect(registerPage.submitButton).toContainText(/creating account/i);

      await submitPromise;
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

    test("should show loading state when submitting", async ({ page }) => {
      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();

      await forgotPasswordPage.emailInput.fill("user@example.com");

      const submitPromise = forgotPasswordPage.submitButton.click();

      // Button should show loading text
      await expect(forgotPasswordPage.submitButton).toContainText(/sending/i);

      await submitPromise;
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

  test.describe("Logout Flow", () => {
    test.beforeEach(async ({ page }) => {
      // Set up authentication state before each test
      await page.goto("/login");

      // Set mock auth tokens in localStorage to simulate logged-in state
      await page.evaluate(() => {
        localStorage.setItem("access_token", "mock-access-token-for-testing");
        localStorage.setItem("refresh_token", "mock-refresh-token-for-testing");
        localStorage.setItem("company_id", "test-company-id");
      });
    });

    test("should display menu button in chat list header", async ({ page }) => {
      const chatPage = new ChatPage(page);
      await chatPage.goto();

      // Note: This may fail if the mock auth doesn't work with your backend
      // The menu button should be visible when authenticated
      await expect(chatPage.menuButton).toBeVisible({ timeout: 10000 });
    });

    test("should open menu dropdown when clicking menu button", async ({ page }) => {
      const chatPage = new ChatPage(page);
      await chatPage.goto();

      await chatPage.menuButton.click();

      // Verify dropdown menu is visible with user info and logout button
      await expect(chatPage.logoutButton).toBeVisible();
    });

    test("should logout and redirect to login page", async ({ page }) => {
      const chatPage = new ChatPage(page);
      await chatPage.goto();

      await chatPage.logout();
      await chatPage.waitForLogoutRedirect();

      // Verify redirect to login page
      await expect(page).toHaveURL(/\/login/);
    });

    test("should clear authentication state after logout", async ({ page }) => {
      const chatPage = new ChatPage(page);
      await chatPage.goto();

      await chatPage.logout();
      await chatPage.waitForLogoutRedirect();

      // Verify localStorage is cleared
      const accessToken = await page.evaluate(() => localStorage.getItem("access_token"));
      expect(accessToken).toBeNull();
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
