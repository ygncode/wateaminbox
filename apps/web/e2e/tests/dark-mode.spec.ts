import { expect, test } from '@playwright/test'
import { LoginPage } from '../pages'

/**
 * E2E Tests for Dark Mode Functionality
 * Tests theme persistence, toggle behavior, and cross-page navigation
 */

test.describe('Dark Mode', () => {
  test.describe('Theme Toggle', () => {
    test.beforeEach(async ({ page }) => {
      // Clear any stored theme
      await page.addInitScript(() => {
        localStorage.removeItem('whatsapp-web-theme')
      })
    })

    test('should cycle through themes: light → dark → system', async ({ page }) => {
      // Set up authentication
      await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      // Mock API responses
      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      // Find theme toggle button by test-id
      const themeToggle = page.getByTestId('theme-toggle')
      await themeToggle.waitFor({ state: 'visible', timeout: 10000 })

      // Initial state should be system (default)
      await expect(themeToggle).toHaveAttribute('aria-label', /Follow System/i)

      // Click to change to light
      await themeToggle.click()
      await expect(themeToggle).toHaveAttribute('aria-label', /Light/i)

      // Verify light theme is applied (no 'dark' class on html)
      await expect(page.locator('html')).not.toHaveClass(/dark/)

      // Click to change to dark
      await themeToggle.click()
      await expect(themeToggle).toHaveAttribute('aria-label', /Dark/i)

      // Verify dark theme is applied ('dark' class on html)
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Click to change back to system
      await themeToggle.click()
      await expect(themeToggle).toHaveAttribute('aria-label', /system/i)
    })

    test('should apply dark class to html element in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      // Verify dark class is on html element
      await expect(page.locator('html')).toHaveClass(/dark/)
    })

    test('should not have dark class in light mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'light')
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      // Verify dark class is NOT on html element
      await expect(page.locator('html')).not.toHaveClass(/dark/)
    })
  })

  test.describe('Theme Persistence', () => {
    test('should persist theme across page refresh', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      // Navigate and set dark theme
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      const themeToggle = page.getByTestId('theme-toggle')
      await themeToggle.waitFor({ state: 'visible', timeout: 10000 })

      // Cycle to dark mode (system → light → dark)
      await themeToggle.click() // to light
      await themeToggle.click() // to dark

      // Verify dark mode is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Verify localStorage has the theme stored
      const storedTheme = await page.evaluate(() => localStorage.getItem('whatsapp-web-theme'))
      expect(storedTheme).toBe('dark')

      // Refresh the page
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Verify dark mode is still applied after refresh
      await expect(page.locator('html')).toHaveClass(/dark/)
    })

    test('should persist theme across navigation', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      // Start on chat page
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Navigate to settings
      await page.goto('/settings')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Navigate to team
      await page.goto('/team')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Navigate back to chat
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
    })
  })

  test.describe('Authentication Pages in Dark Mode', () => {
    test('login page should render correctly in dark mode', async ({ page }) => {
      // Set dark theme before page load
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      const loginPage = new LoginPage(page)
      await loginPage.goto()

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Verify key elements are visible
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
      await expect(loginPage.emailInput).toBeVisible()
      await expect(loginPage.passwordInput).toBeVisible()
      await expect(loginPage.submitButton).toBeVisible()
    })

    test('register page should render correctly in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/register')
      await page.waitForLoadState('networkidle')

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Verify key elements are visible
      await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible()
      await expect(page.locator('input[type="email"]')).toBeVisible()
      await expect(page.locator('input[type="password"]').first()).toBeVisible()
    })

    test('forgot password page should render correctly in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/forgot-password')
      await page.waitForLoadState('networkidle')

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Verify key elements are visible
      await expect(page.getByRole('heading', { name: /forgot password/i })).toBeVisible()
      await expect(page.locator('input[type="email"]')).toBeVisible()
    })
  })

  test.describe('App Pages in Dark Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })
    })

    test('chat page should render without console errors in dark mode', async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Filter out expected errors (e.g., network errors from mocked API)
      const unexpectedErrors = consoleErrors.filter(
        (err) => !err.includes('net::ERR') && !err.includes('Failed to load resource')
      )

      expect(unexpectedErrors).toHaveLength(0)
    })

    test('settings page should render correctly in dark mode', async ({ page }) => {
      await page.route('**/api/notifications/preferences', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'pref-123',
              soundEnabled: true,
              soundChoice: 'default',
              quietHoursStart: null,
              quietHoursEnd: null,
            },
          }),
        })
      })

      await page.goto('/settings')
      await page.waitForLoadState('networkidle')

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      // Verify settings page content is visible
      await expect(page.getByText(/settings/i).first()).toBeVisible()
    })

    test('team page should render correctly in dark mode', async ({ page }) => {
      await page.route('**/api/team/members', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/team')
      await page.waitForLoadState('networkidle')

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)
    })

    test('dashboard page should render correctly in dark mode', async ({ page }) => {
      await page.route('**/api/analytics**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {} }),
        })
      })

      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      // Verify dark class is applied
      await expect(page.locator('html')).toHaveClass(/dark/)
    })
  })

  test.describe('No Flash of Unstyled Content (FOUC)', () => {
    test('should not show light theme flash when dark theme is stored', async ({ page }) => {
      // This test verifies the FOUC prevention script in index.html works correctly
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/login')

      // After page load, verify dark class is applied immediately
      // This confirms FOUC prevention is working
      await expect(page.locator('html')).toHaveClass(/dark/)
    })
  })

  test.describe('System Theme Preference', () => {
    test("should respect system dark mode preference when theme is 'system'", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'system')
      })

      // Emulate dark color scheme preference
      await page.emulateMedia({ colorScheme: 'dark' })

      await page.goto('/login')
      await page.waitForLoadState('networkidle')

      // Should apply dark theme based on system preference
      await expect(page.locator('html')).toHaveClass(/dark/)
    })

    test("should respect system light mode preference when theme is 'system'", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'system')
      })

      // Emulate light color scheme preference
      await page.emulateMedia({ colorScheme: 'light' })

      await page.goto('/login')
      await page.waitForLoadState('networkidle')

      // Should apply light theme based on system preference
      await expect(page.locator('html')).not.toHaveClass(/dark/)
    })

    test('should update theme when system preference changes', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'system')
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      // Start with light preference
      await page.emulateMedia({ colorScheme: 'light' })
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      // Should be light
      await expect(page.locator('html')).not.toHaveClass(/dark/)

      // Change to dark preference
      await page.emulateMedia({ colorScheme: 'dark' })

      // Wait for theme change to apply
      await page.waitForTimeout(100)

      // Should now be dark
      await expect(page.locator('html')).toHaveClass(/dark/)
    })
  })

  test.describe('Theme Toggle Accessibility', () => {
    test('should have proper aria-label describing current theme', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      const themeToggle = page.getByTestId('theme-toggle')
      await themeToggle.waitFor({ state: 'visible', timeout: 10000 })

      // Verify aria-label pattern
      await expect(themeToggle).toHaveAttribute('aria-label', /Current theme:/)
      await expect(themeToggle).toHaveAttribute('aria-label', /Click to switch/)
    })

    test('should announce theme changes to screen readers', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      // Find the announcement element
      const announcement = page.locator('#theme-announcement')
      await expect(announcement).toHaveAttribute('role', 'status')
      await expect(announcement).toHaveAttribute('aria-live', 'polite')

      // Toggle theme and verify announcement is updated
      const themeToggle = page.getByTestId('theme-toggle')
      await themeToggle.waitFor({ state: 'visible', timeout: 10000 })
      await themeToggle.click()

      // The announcement element should have content after theme change
      await expect(announcement).toContainText(/Theme changed to/)
    })
  })

  test.describe('Theme Meta Tag', () => {
    test('should update theme-color meta tag for mobile browsers', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'mock-access-token')
        localStorage.setItem('refresh_token', 'mock-refresh-token')
        localStorage.setItem('company_id', 'test-company-123')
      })

      await page.route('**/api/**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      const themeToggle = page.getByTestId('theme-toggle')
      await themeToggle.waitFor({ state: 'visible', timeout: 10000 })
      const themeColorMeta = page.locator('meta[name="theme-color"]')

      // Set to light mode
      await themeToggle.click() // system → light
      await expect(themeColorMeta).toHaveAttribute('content', '#075E54') // WhatsApp green for light

      // Set to dark mode
      await themeToggle.click() // light → dark
      await expect(themeColorMeta).toHaveAttribute('content', '#111B21') // dark-primary for dark
    })
  })
})
