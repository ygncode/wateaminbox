import { test as base, Page } from '@playwright/test'
import { WhatsAppConnectionPage } from '../pages'

/**
 * Mock WhatsApp connection data
 */
export const MOCK_CONNECTION = {
  id: 'mock-connection-123',
  phoneNumber: '+1234567890',
  jid: '1234567890@s.whatsapp.net',
  status: 'connected',
  name: 'Test Connection',
}

/**
 * Mock QR code (base64 placeholder)
 */
export const MOCK_QR_CODE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * Mock access token for authenticated tests
 */
const MOCK_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNzA0MDY3MjAwLCJleHAiOjE3MzU2ODk2MDB9.mock-signature'
const MOCK_REFRESH_TOKEN = 'mock-refresh-token-for-testing'
const MOCK_COMPANY_ID = 'test-company-id'
const MOCK_USER_ID = 'test-user-123'

/**
 * Extended test with WhatsApp connection fixtures
 */
export const test = base.extend<{
  whatsappPage: WhatsAppConnectionPage
  whatsappConnectedPage: Page
  whatsappDisconnectedPage: Page
}>({
  /**
   * WhatsApp connection page object
   */
  whatsappPage: async ({ page }, use) => {
    const whatsappPage = new WhatsAppConnectionPage(page)
    await use(whatsappPage)
  },

  /**
   * Page with WhatsApp already connected (mocked)
   */
  whatsappConnectedPage: async ({ page }, use) => {
    // Set up authentication
    await page.addInitScript(
      ({ accessToken, refreshToken, companyId }) => {
        localStorage.setItem('auth_token', accessToken)
        localStorage.setItem('refresh_token', refreshToken)
        localStorage.setItem('company_id', companyId)
      },
      {
        accessToken: MOCK_ACCESS_TOKEN,
        refreshToken: MOCK_REFRESH_TOKEN,
        companyId: MOCK_COMPANY_ID,
      }
    )

    // Mock auth endpoint
    await page.route('**/api/auth/me', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: MOCK_USER_ID,
            email: 'test@example.com',
            name: 'Test User',
          },
        }),
      })
    })

    // Mock companies endpoint
    await page.route('**/api/companies', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/companies' && route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: MOCK_COMPANY_ID,
                name: 'Test Company',
                role: 'owner',
              },
            ],
          }),
        })
      } else {
        route.continue()
      }
    })

    // Mock WhatsApp connections - return connected state
    await page.route('**/api/whatsapp/connections**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: MOCK_CONNECTION.id,
              phoneNumber: MOCK_CONNECTION.phoneNumber,
              jid: MOCK_CONNECTION.jid,
              status: 'connected',
              name: MOCK_CONNECTION.name,
              connectedAt: new Date().toISOString(),
              lastSyncAt: new Date().toISOString(),
            },
          ],
        }),
      })
    })

    // Mock WhatsApp status - connected
    await page.route('**/api/whatsapp/status**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isConnected: true,
          phoneNumber: MOCK_CONNECTION.phoneNumber,
          jid: MOCK_CONNECTION.jid,
        }),
      })
    })

    // Mock contacts endpoint
    await page.route('**/api/contacts**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, limit: 50, offset: 0 },
        }),
      })
    })

    // Mock messages endpoint
    await page.route('**/api/messages**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, limit: 50, offset: 0 },
        }),
      })
    })

    await use(page)
  },

  /**
   * Page with WhatsApp disconnected (mocked)
   */
  whatsappDisconnectedPage: async ({ page }, use) => {
    // Set up authentication
    await page.addInitScript(
      ({ accessToken, refreshToken, companyId }) => {
        localStorage.setItem('auth_token', accessToken)
        localStorage.setItem('refresh_token', refreshToken)
        localStorage.setItem('company_id', companyId)
      },
      {
        accessToken: MOCK_ACCESS_TOKEN,
        refreshToken: MOCK_REFRESH_TOKEN,
        companyId: MOCK_COMPANY_ID,
      }
    )

    // Mock auth endpoint
    await page.route('**/api/auth/me', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: MOCK_USER_ID,
            email: 'test@example.com',
            name: 'Test User',
          },
        }),
      })
    })

    // Mock companies endpoint
    await page.route('**/api/companies', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/companies' && route.request().method() === 'GET') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: MOCK_COMPANY_ID,
                name: 'Test Company',
                role: 'owner',
              },
            ],
          }),
        })
      } else {
        route.continue()
      }
    })

    // Mock WhatsApp connections - empty (not connected)
    await page.route('**/api/whatsapp/connections**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
        }),
      })
    })

    // Mock WhatsApp status - disconnected
    await page.route('**/api/whatsapp/status**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isConnected: false,
        }),
      })
    })

    // Mock contacts endpoint
    await page.route('**/api/contacts**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, limit: 50, offset: 0 },
        }),
      })
    })

    // Mock messages endpoint
    await page.route('**/api/messages**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          meta: { total: 0, limit: 50, offset: 0 },
        }),
      })
    })

    await use(page)
  },
})

export { expect } from '@playwright/test'

/**
 * Helper to set up QR code generation mock
 */
export async function mockQRCodeGeneration(page: Page, qrCode: string = MOCK_QR_CODE): Promise<void> {
  await page.route('**/api/whatsapp/connections', async (route) => {
    if (route.request().method() === 'POST') {
      // Return pending connection with WebSocket URL
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: MOCK_CONNECTION.id,
            status: 'pending',
            websocketUrl: `/ws?company=${MOCK_COMPANY_ID}&connection=${MOCK_CONNECTION.id}`,
          },
        }),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Helper to set up connection success mock
 */
export async function mockConnectionSuccess(page: Page): Promise<void> {
  await page.route('**/api/whatsapp/connections/*', async (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: MOCK_CONNECTION.id,
            phoneNumber: MOCK_CONNECTION.phoneNumber,
            jid: MOCK_CONNECTION.jid,
            status: 'connected',
            connectedAt: new Date().toISOString(),
          },
        }),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Helper to set up max connections error mock
 */
export async function mockMaxConnectionsError(page: Page): Promise<void> {
  await page.route('**/api/whatsapp/connections', async (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: "You've reached the maximum number of WhatsApp connections",
        }),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Helper to set up connection error mock
 */
export async function mockConnectionError(page: Page, errorMessage: string): Promise<void> {
  await page.route('**/api/whatsapp/connections', async (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: errorMessage,
        }),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Helper to set up disconnect mock
 */
export async function mockDisconnect(page: Page): Promise<void> {
  await page.route('**/api/whatsapp/connections/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
        }),
      })
    } else {
      route.continue()
    }
  })
}
