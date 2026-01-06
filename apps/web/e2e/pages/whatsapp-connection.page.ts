import { Page, Locator, expect } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Page Object for WhatsApp Connection functionality
 *
 * Handles the QR code connection flow, connected state management,
 * and multi-connection scenarios.
 */
export class WhatsAppConnectionPage extends BasePage {
  // Connection panel elements
  readonly connectionPanel: Locator
  readonly connectButton: Locator
  readonly addConnectionButton: Locator
  readonly disconnectButton: Locator
  readonly refreshButton: Locator

  // QR Code elements
  readonly qrCodeImage: Locator
  readonly qrCodeContainer: Locator
  readonly qrCountdown: Locator
  readonly qrLoadingSpinner: Locator

  // Status elements
  readonly connectedStatus: Locator
  readonly disconnectedStatus: Locator
  readonly connectingStatus: Locator
  readonly errorStatus: Locator
  readonly phoneNumber: Locator

  // Error elements
  readonly errorMessage: Locator
  readonly retryButton: Locator
  readonly maxConnectionsError: Locator

  // Multi-connection elements
  readonly connectionsList: Locator
  readonly connectionItem: Locator

  constructor(page: Page) {
    super(page)

    // Connection panel
    this.connectionPanel = page.locator('[data-testid="whatsapp-connection-panel"]')
    this.connectButton = page.locator('button:has-text("Connect"), button:has-text("Connect Device")')
    this.addConnectionButton = page.locator('button:has-text("Add Connection")')
    this.disconnectButton = page.locator('button:has-text("Disconnect")')
    this.refreshButton = page.locator('button:has-text("Refresh"), button:has-text("Retry")')

    // QR Code
    this.qrCodeImage = page.locator('[data-testid="qr-code-image"], img[alt*="QR"]')
    this.qrCodeContainer = page.locator('[data-testid="qr-code-container"]')
    this.qrCountdown = page.locator('[data-testid="qr-countdown"]')
    this.qrLoadingSpinner = page.locator('[data-testid="qr-loading"]')

    // Status
    this.connectedStatus = page.locator('text=Connected, [data-testid="status-connected"]')
    this.disconnectedStatus = page.locator('text=Disconnected, text=Not Connected')
    this.connectingStatus = page.locator('text=Connecting')
    this.errorStatus = page.locator('[data-testid="status-error"]')
    this.phoneNumber = page.locator('[data-testid="phone-number"]')

    // Errors
    this.errorMessage = page.locator('[data-testid="error-message"], [role="alert"]')
    this.retryButton = page.locator('button:has-text("Retry"), button:has-text("Try Again")')
    this.maxConnectionsError = page.locator('text=maximum, text=limit reached')

    // Multi-connection
    this.connectionsList = page.locator('[data-testid="connections-list"]')
    this.connectionItem = page.locator('[data-testid="connection-item"]')
  }

  /**
   * Navigate to the settings page where WhatsApp connection is managed
   */
  async goto(): Promise<void> {
    await this.page.goto('/settings')
  }

  /**
   * Wait for the connection panel to be visible
   */
  async waitForPageLoad(): Promise<void> {
    // Wait for either connect button or connected status to be visible
    await Promise.race([
      this.connectButton.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
      this.connectedStatus.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
      this.addConnectionButton.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
    ])
  }

  /**
   * Click the Connect button to initiate connection
   */
  async clickConnect(): Promise<void> {
    const button = this.connectButton.first()
    await button.waitFor({ state: 'visible' })
    await button.click()
  }

  /**
   * Click Add Connection button (multi-connection mode)
   */
  async clickAddConnection(): Promise<void> {
    await this.addConnectionButton.click()
  }

  /**
   * Wait for QR code to be displayed
   */
  async waitForQRCode(timeout: number = 30000): Promise<void> {
    await this.qrCodeImage.waitFor({ state: 'visible', timeout })
  }

  /**
   * Check if QR code is visible
   */
  async isQRCodeVisible(): Promise<boolean> {
    return this.qrCodeImage.isVisible()
  }

  /**
   * Wait for connected status
   */
  async waitForConnected(timeout: number = 60000): Promise<void> {
    await this.connectedStatus.first().waitFor({ state: 'visible', timeout })
  }

  /**
   * Check if connected
   */
  async isConnected(): Promise<boolean> {
    return this.connectedStatus.first().isVisible()
  }

  /**
   * Disconnect the WhatsApp connection
   */
  async disconnect(): Promise<void> {
    await this.disconnectButton.click()
  }

  /**
   * Get the displayed phone number
   */
  async getDisplayedPhoneNumber(): Promise<string> {
    const text = await this.phoneNumber.textContent()
    return text?.trim() || ''
  }

  /**
   * Refresh/retry the QR code
   */
  async refreshQRCode(): Promise<void> {
    await this.refreshButton.click()
  }

  /**
   * Check if loading spinner is visible
   */
  async isLoading(): Promise<boolean> {
    return this.qrLoadingSpinner.isVisible() || this.connectingStatus.isVisible()
  }

  /**
   * Wait for loading to complete
   */
  async waitForLoadingComplete(timeout: number = 10000): Promise<void> {
    await this.qrLoadingSpinner.waitFor({ state: 'hidden', timeout }).catch(() => {})
    await this.connectingStatus.waitFor({ state: 'hidden', timeout }).catch(() => {})
  }

  /**
   * Get error message text
   */
  async getErrorMessage(): Promise<string | null> {
    const isVisible = await this.errorMessage.isVisible()
    if (!isVisible) return null
    return this.errorMessage.textContent()
  }

  /**
   * Check if max connections error is displayed
   */
  async hasMaxConnectionsError(): Promise<boolean> {
    return this.maxConnectionsError.isVisible()
  }

  /**
   * Get list of connections (multi-connection mode)
   */
  async getConnectionCount(): Promise<number> {
    return this.connectionItem.count()
  }

  /**
   * Click retry button
   */
  async retry(): Promise<void> {
    await this.retryButton.click()
  }

  /**
   * Get QR countdown time (if visible)
   */
  async getQRCountdown(): Promise<string | null> {
    const isVisible = await this.qrCountdown.isVisible()
    if (!isVisible) return null
    return this.qrCountdown.textContent()
  }

  /**
   * Simulate WebSocket QR event (for testing without real backend)
   * This injects a mock event into the page's WebSocket handler
   */
  async simulateQREvent(connectionId: string, qrCode: string): Promise<void> {
    await this.page.evaluate(
      ({ connectionId, qrCode }) => {
        const event = new CustomEvent('whatsapp:qr', {
          detail: {
            connectionId,
            qrCode,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        })
        window.dispatchEvent(event)
      },
      { connectionId, qrCode }
    )
  }

  /**
   * Simulate WebSocket connected event
   */
  async simulateConnectedEvent(
    connectionId: string,
    phoneNumber: string,
    jid: string
  ): Promise<void> {
    await this.page.evaluate(
      ({ connectionId, phoneNumber, jid }) => {
        const event = new CustomEvent('whatsapp:connected', {
          detail: {
            connectionId,
            phoneNumber,
            jid,
          },
        })
        window.dispatchEvent(event)
      },
      { connectionId, phoneNumber, jid }
    )
  }

  /**
   * Simulate WebSocket disconnected event
   */
  async simulateDisconnectedEvent(connectionId: string, reason?: string): Promise<void> {
    await this.page.evaluate(
      ({ connectionId, reason }) => {
        const event = new CustomEvent('whatsapp:disconnected', {
          detail: {
            connectionId,
            reason: reason || 'User disconnected',
          },
        })
        window.dispatchEvent(event)
      },
      { connectionId, reason }
    )
  }
}
