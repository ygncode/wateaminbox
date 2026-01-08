import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { LoginPage } from '../pages'

/**
 * E2E Accessibility Tests for Dark Mode
 * Verifies WCAG AA compliance for all pages in both light and dark modes
 *
 * Uses axe-core to check:
 * - Color contrast ratios (4.5:1 for normal text, 3:1 for large text)
 * - Focus indicators visibility
 * - Form validation accessibility
 * - Interactive elements accessibility
 */

interface AxeResults {
  violations: {
    id: string
    impact: string
    description: string
    nodes: { html: string; failureSummary: string }[]
  }[]
}

// Helper to format violations for readable output
function formatViolations(violations: AxeResults['violations']): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `  - ${n.html}\n    ${n.failureSummary}`).join('\n')
      return `[${v.impact}] ${v.id}: ${v.description}\n${nodes}`
    })
    .join('\n\n')
}

test.describe('Accessibility Audit - Dark Mode', () => {
  test.describe('Authentication Pages', () => {
    test('login page should have no accessibility violations in light mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'light')
      })

      await page.goto('/login')
      await page.waitForLoadState('networkidle')

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      // Filter out known issues or minor violations if necessary
      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (criticalViolations.length > 0) {
        console.log('Critical accessibility violations found:')
        console.log(formatViolations(criticalViolations))
      }

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })

    test('login page should have no accessibility violations in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/login')
      await page.waitForLoadState('networkidle')

      // Verify dark mode is applied
      await expect(page.locator('html')).toHaveClass(/dark/)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (criticalViolations.length > 0) {
        console.log('Critical accessibility violations in dark mode:')
        console.log(formatViolations(criticalViolations))
      }

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations in dark mode`
      ).toHaveLength(0)
    })

    test('register page should have no accessibility violations in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/register')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('html')).toHaveClass(/dark/)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })

    test('forgot password page should have no accessibility violations in dark mode', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/forgot-password')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('html')).toHaveClass(/dark/)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })
  })

  test.describe('App Pages', () => {
    test.beforeEach(async ({ page }) => {
      // Set up authentication
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
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
    })

    test('chat page should have no critical accessibility violations in dark mode', async ({
      page,
    }) => {
      await page.goto('/chat')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('html')).toHaveClass(/dark/)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (criticalViolations.length > 0) {
        console.log('Chat page accessibility violations:')
        console.log(formatViolations(criticalViolations))
      }

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })

    test('settings page should have no critical accessibility violations in dark mode', async ({
      page,
    }) => {
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

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (criticalViolations.length > 0) {
        console.log('Settings page accessibility violations:')
        console.log(formatViolations(criticalViolations))
      }

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })

    test('team page should have no critical accessibility violations in dark mode', async ({
      page,
    }) => {
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

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (criticalViolations.length > 0) {
        console.log('Team page accessibility violations:')
        console.log(formatViolations(criticalViolations))
      }

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })

    test('dashboard page should have no critical accessibility violations in dark mode', async ({
      page,
    }) => {
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

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      if (criticalViolations.length > 0) {
        console.log('Dashboard page accessibility violations:')
        console.log(formatViolations(criticalViolations))
      }

      expect(
        criticalViolations,
        `Found ${criticalViolations.length} critical/serious accessibility violations`
      ).toHaveLength(0)
    })
  })

  test.describe('Focus Indicators', () => {
    test('interactive elements should have visible focus indicators in dark mode', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      const loginPage = new LoginPage(page)
      await loginPage.goto()

      await expect(page.locator('html')).toHaveClass(/dark/)

      // Tab through form elements and verify focus is visible
      await page.keyboard.press('Tab')

      // Get the currently focused element
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        const style = window.getComputedStyle(el)
        return {
          tagName: el.tagName,
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
        }
      })

      // Verify the focused element has some visible focus indicator
      // (outline, box-shadow, or ring)
      expect(focusedElement).not.toBeNull()
      const hasVisibleFocus =
        (focusedElement?.outlineWidth !== '0px' && focusedElement?.outlineStyle !== 'none') ||
        (focusedElement?.boxShadow && focusedElement?.boxShadow !== 'none')

      expect(hasVisibleFocus).toBe(true)
    })
  })

  test.describe('Color Contrast', () => {
    test('text should meet WCAG AA contrast requirements in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      await page.goto('/login')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('html')).toHaveClass(/dark/)

      // Run color-contrast specific check
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()

      // Log any contrast issues
      if (results.violations.length > 0) {
        console.log('Color contrast violations:')
        console.log(formatViolations(results.violations))
      }

      // Check specifically for critical contrast issues
      const criticalContrastIssues = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      expect(
        criticalContrastIssues,
        `Found ${criticalContrastIssues.length} critical color contrast issues`
      ).toHaveLength(0)
    })
  })

  test.describe('Form Validation Accessibility', () => {
    test('error messages should be accessible in dark mode', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      const loginPage = new LoginPage(page)
      await loginPage.goto()

      await expect(page.locator('html')).toHaveClass(/dark/)

      // Try to login with invalid credentials to trigger error
      await loginPage.login('invalid@example.com', 'wrongpassword')

      // Wait for error message to appear
      await expect(loginPage.errorMessage).toBeVisible({ timeout: 10000 })

      // Run accessibility check on the error state
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .include('[role="alert"]')
        .analyze()

      // Verify error message has proper role and is announced
      const errorElement = await page.locator('[role="alert"]').first()
      if (await errorElement.isVisible()) {
        await expect(errorElement).toHaveAttribute('role', 'alert')
      }

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      )

      expect(criticalViolations).toHaveLength(0)
    })
  })

  test.describe('Keyboard Navigation', () => {
    test('all interactive elements should be keyboard accessible in dark mode', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem('whatsapp-web-theme', 'dark')
      })

      const loginPage = new LoginPage(page)
      await loginPage.goto()

      await expect(page.locator('html')).toHaveClass(/dark/)

      // Get all interactive elements
      const interactiveElements = await page.locator('a, button, input, select, textarea').all()

      // Track elements that receive focus
      const focusableElements: string[] = []

      // Tab through all elements
      for (let i = 0; i < interactiveElements.length + 5; i++) {
        await page.keyboard.press('Tab')

        const focused = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return null
          return el.tagName.toLowerCase()
        })

        if (focused && !focusableElements.includes(focused)) {
          focusableElements.push(focused)
        }
      }

      // Verify we can tab through form elements
      expect(focusableElements).toContain('input')
      expect(focusableElements).toContain('button')
    })
  })
})
