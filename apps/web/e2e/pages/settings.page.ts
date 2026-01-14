import { Page, Locator } from "@playwright/test";
import { BasePage } from "./base.page";

/**
 * Settings Page Object Model
 * Represents the settings page with notification preferences
 */
export class SettingsPage extends BasePage {
  // User profile
  readonly signOutButton: Locator;
  readonly backToChatLink: Locator;

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

    // User profile locators
    this.signOutButton = page.getByRole("button", { name: /sign out/i });
    this.backToChatLink = page.getByRole("link", { name: /back to chat/i });

    // Notification section - use heading or landmark
    this.notificationSection = page.getByRole("region", { name: /notification/i }).or(page.getByText("Notification Settings").first());

    // Use getByLabel for form controls (most robust)
    // If labels aren't properly associated, use getByTestId as fallback
    this.desktopNotificationsToggle = page.getByLabel(/desktop notification/i)
      .or(page.getByTestId("desktop-notifications-toggle"))
      .or(page.getByRole("switch", { name: /desktop notification/i }));

    this.soundEnabledToggle = page.getByLabel(/notification sound/i)
      .or(page.getByTestId("sound-enabled-toggle"))
      .or(page.getByRole("switch", { name: /sound/i }));

    // Sound select - use label association
    this.soundSelect = page.getByLabel(/^sound$/i)
      .or(page.getByTestId("sound-select"))
      .or(page.getByRole("combobox").first());

    this.quietHoursToggle = page.getByLabel(/quiet hours/i)
      .or(page.getByTestId("quiet-hours-toggle"))
      .or(page.getByRole("switch", { name: /quiet hours/i }));

    this.quietHoursStartInput = page.getByLabel(/start time/i)
      .or(page.getByTestId("quiet-hours-start"))
      .or(page.locator('input[type="time"]').first());

    this.quietHoursEndInput = page.getByLabel(/end time/i)
      .or(page.getByTestId("quiet-hours-end"))
      .or(page.locator('input[type="time"]').last());

    this.testNotificationButton = page.getByRole("button", { name: /send test notification/i });
    this.loadingIndicator = page.getByText("Loading preferences...");
    this.syncingIndicator = page.getByText("Syncing...");
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

  /**
   * Sign out from the application
   */
  async signOut(): Promise<void> {
    await this.signOutButton.click();
  }

  /**
   * Navigate back to chat page
   */
  async goBackToChat(): Promise<void> {
    await this.backToChatLink.click();
  }
}
