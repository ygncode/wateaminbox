import { Page, Locator } from "@playwright/test";
import { BasePage } from "./base.page";

/**
 * Settings Page Object Model
 * Represents the settings page with notification preferences
 */
export class SettingsPage extends BasePage {
  // Notification settings locators
  readonly notificationSection: Locator;
  readonly desktopNotificationsToggle: Locator;
  readonly soundEnabledToggle: Locator;
  readonly soundSelect: Locator;
  readonly quietHoursToggle: Locator;
  readonly quietHoursStartInput: Locator;
  readonly quietHoursEndInput: Locator;
  readonly testNotificationButton: Locator;
  readonly loadingIndicator: Locator;
  readonly syncingIndicator: Locator;

  constructor(page: Page) {
    super(page);

    // Initialize locators
    this.notificationSection = page.locator("text=Notification Settings").first();
    this.desktopNotificationsToggle = page
      .locator("text=Desktop Notifications")
      .locator("xpath=../../../..")
      .locator('button[role="checkbox"]');
    this.soundEnabledToggle = page
      .locator("text=Notification Sound")
      .locator("xpath=../../../..")
      .locator('button[role="checkbox"]');
    this.soundSelect = page.locator('button[role="combobox"]');
    this.quietHoursToggle = page
      .locator("text=Quiet Hours")
      .locator("xpath=../../../..")
      .locator('button[role="checkbox"]');
    this.quietHoursStartInput = page.locator('input[type="time"]').first();
    this.quietHoursEndInput = page.locator('input[type="time"]').last();
    this.testNotificationButton = page.getByRole("button", { name: /send test notification/i });
    this.loadingIndicator = page.locator("text=Loading preferences...");
    this.syncingIndicator = page.locator("text=Syncing...");
  }

  /**
   * Navigate to settings page
   */
  async goto(): Promise<void> {
    await this.page.goto("/settings");
  }

  /**
   * Wait for the settings page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Wait for preferences to finish loading
   */
  async waitForPreferencesLoaded(): Promise<void> {
    // Wait for loading indicator to disappear
    await this.loadingIndicator.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {
      // Loading may have already finished
    });
  }

  /**
   * Wait for sync to complete
   */
  async waitForSyncComplete(): Promise<void> {
    // Wait for syncing indicator to appear and then disappear
    await this.syncingIndicator.waitFor({ state: "visible", timeout: 5000 }).catch(() => {
      // Sync may be very fast or already complete
    });
    await this.syncingIndicator.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {
      // Already hidden
    });
  }

  /**
   * Toggle desktop notifications
   */
  async toggleDesktopNotifications(): Promise<void> {
    await this.desktopNotificationsToggle.click();
    await this.waitForSyncComplete();
  }

  /**
   * Toggle notification sound
   */
  async toggleSound(): Promise<void> {
    await this.soundEnabledToggle.click();
    await this.waitForSyncComplete();
  }

  /**
   * Select a notification sound
   */
  async selectSound(sound: string): Promise<void> {
    await this.soundSelect.click();
    await this.page.getByRole("option", { name: new RegExp(sound, "i") }).click();
    await this.waitForSyncComplete();
  }

  /**
   * Toggle quiet hours
   */
  async toggleQuietHours(): Promise<void> {
    await this.quietHoursToggle.click();
    await this.waitForSyncComplete();
  }

  /**
   * Set quiet hours start time
   */
  async setQuietHoursStart(time: string): Promise<void> {
    await this.quietHoursStartInput.fill(time);
    await this.quietHoursStartInput.blur();
    await this.waitForSyncComplete();
  }

  /**
   * Set quiet hours end time
   */
  async setQuietHoursEnd(time: string): Promise<void> {
    await this.quietHoursEndInput.fill(time);
    await this.quietHoursEndInput.blur();
    await this.waitForSyncComplete();
  }

  /**
   * Click test notification button
   */
  async sendTestNotification(): Promise<void> {
    await this.testNotificationButton.click();
  }

  /**
   * Check if sound toggle is enabled
   */
  async isSoundEnabled(): Promise<boolean> {
    return await this.soundEnabledToggle.getAttribute("data-state") === "checked";
  }

  /**
   * Check if quiet hours is enabled
   */
  async isQuietHoursEnabled(): Promise<boolean> {
    return await this.quietHoursToggle.getAttribute("data-state") === "checked";
  }

  /**
   * Get current sound choice from select
   */
  async getCurrentSound(): Promise<string> {
    return await this.soundSelect.innerText();
  }
}
