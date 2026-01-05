import { expect, test } from '@playwright/test'

/**
 * Visual Regression Tests for Dark Mode
 * Captures screenshots of all pages in light and dark modes for comparison
 *
 * Run with: bunx playwright test visual-regression.spec.ts --update-snapshots
 * to update baseline screenshots
 *
 * Run with: bunx playwright test visual-regression.spec.ts
 * to compare against baselines
 */

test.describe('Visual Regression - Authentication Pages', () => {
  test.describe('Light Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'light')
      })
    })

    test('login page - light mode', async ({ page }) => {
      await page.goto('/login')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot('login-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('register page - light mode', async ({ page }) => {
      await page.goto('/register')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot('register-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('forgot password page - light mode', async ({ page }) => {
      await page.goto('/forgot-password')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot('forgot-password-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })
  })

  test.describe('Dark Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })
    })

    test('login page - dark mode', async ({ page }) => {
      await page.goto('/login')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('login-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('register page - dark mode', async ({ page }) => {
      await page.goto('/register')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('register-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('forgot password page - dark mode', async ({ page }) => {
      await page.goto('/forgot-password')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('forgot-password-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })
  })
})

test.describe('Visual Regression - App Pages', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses
    await page.route('**/api/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    // Set up authentication
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'mock-access-token')
      localStorage.setItem('refresh_token', 'mock-refresh-token')
      localStorage.setItem('company_id', 'test-company-123')
    })
  })

  test.describe('Light Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'light')
      })
    })

    test('chat page - light mode', async ({ page }) => {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot('chat-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('settings page - light mode', async ({ page }) => {
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
      await expect(page).toHaveScreenshot('settings-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('team page - light mode', async ({ page }) => {
      await page.route('**/api/team/members', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/team')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot('team-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('dashboard page - light mode', async ({ page }) => {
      await page.route('**/api/analytics**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {} }),
        })
      })

      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot('dashboard-light.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })
  })

  test.describe('Dark Mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })
    })

    test('chat page - dark mode', async ({ page }) => {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('chat-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('settings page - dark mode', async ({ page }) => {
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
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('settings-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('team page - dark mode', async ({ page }) => {
      await page.route('**/api/team/members', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      })

      await page.goto('/team')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('team-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('dashboard page - dark mode', async ({ page }) => {
      await page.route('**/api/analytics**', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {} }),
        })
      })

      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('dashboard-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })
  })
})

test.describe('Visual Regression - Theme Transition', () => {
  test('should switch themes without visual glitches', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'mock-access-token')
      localStorage.setItem('refresh_token', 'mock-refresh-token')
      localStorage.setItem('company_id', 'test-company-123')
      localStorage.setItem('whatsapp-web-theme', 'light')
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

    // Screenshot in light mode
    await expect(page).toHaveScreenshot('theme-transition-1-light.png', {
      animations: 'disabled',
    })

    // Toggle to dark mode
    const themeToggle = page.locator('button[aria-label*="Current theme"]')
    await themeToggle.click() // to dark (from system or light)
    await themeToggle.click() // ensure we're in dark

    // Wait for transition
    await page.waitForTimeout(300)

    // Screenshot in dark mode
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page).toHaveScreenshot('theme-transition-2-dark.png', {
      animations: 'disabled',
    })

    // Toggle back to light
    await themeToggle.click() // to system
    await themeToggle.click() // to light

    // Wait for transition
    await page.waitForTimeout(300)

    // Screenshot back in light mode - should match original
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page).toHaveScreenshot('theme-transition-3-light-again.png', {
      animations: 'disabled',
    })
  })
})

test.describe('Visual Regression - Mobile Views', () => {
  test.describe('Dark Mode Mobile', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })
    })

    test('login page - mobile dark mode', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 }) // iPhone SE
      await page.goto('/login')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('login-mobile-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })

    test('chat page - mobile dark mode', async ({ page }) => {
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

      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page).toHaveScreenshot('chat-mobile-dark.png', {
        fullPage: true,
        animations: 'disabled',
      })
    })
  })
})
