import { Page, Locator } from "@playwright/test";
import { BasePage } from "./base.page";

/**
 * Dashboard Page Object Model
 * Represents the analytics dashboard page
 */
export class DashboardPage extends BasePage {
  // Main elements
  readonly heading: Locator;
  readonly statsCards: Locator;

  // Export buttons
  readonly fullBackupButton: Locator;
  readonly exportContactsButton: Locator;
  readonly exportMessagesButton: Locator;

  // Date range buttons
  readonly dateRange7d: Locator;
  readonly dateRange30d: Locator;
  readonly dateRange90d: Locator;

  // Charts
  readonly messageTrendChart: Locator;
  readonly newContactsChart: Locator;
  readonly hourlyActivityChart: Locator;
  readonly newContactsChartTitle: Locator;
  readonly newContactsChartBars: Locator;
  readonly newContactsChartSummary: Locator;

  // Resolution Rate section
  readonly resolutionRateSection: Locator;
  readonly resolutionRateTitle: Locator;
  readonly resolutionOpenCard: Locator;
  readonly resolutionPendingCard: Locator;
  readonly resolutionResolvedCard: Locator;
  readonly resolutionRateCard: Locator;

  // Export dialog
  readonly exportDialog: Locator;
  readonly exportDialogTitle: Locator;
  readonly exportDialogDescription: Locator;
  readonly exportDialogBackupInfo: Locator;
  readonly exportDialogDateSelect: Locator;
  readonly exportDialogDownloadButton: Locator;
  readonly exportDialogCancelButton: Locator;
  readonly exportDialogLoadingSpinner: Locator;

  constructor(page: Page) {
    super(page);

    // Initialize locators
    this.heading = page.getByRole("heading", { name: "Dashboard" });
    this.statsCards = page.locator(".bg-white.rounded-lg.border");

    // Export buttons
    this.fullBackupButton = page.getByRole("button", { name: /full backup/i });
    this.exportContactsButton = page.getByRole("button", { name: /export contacts/i });
    this.exportMessagesButton = page.getByRole("button", { name: /export messages/i });

    // Date range buttons
    this.dateRange7d = page.getByRole("button", { name: "7 Days" });
    this.dateRange30d = page.getByRole("button", { name: "30 Days" });
    this.dateRange90d = page.getByRole("button", { name: "90 Days" });

    // Charts - find by heading text within parent containers
    this.messageTrendChart = page.locator(".bg-white.rounded-lg").filter({ hasText: "Message Trend" });
    this.newContactsChart = page.locator(".bg-white.rounded-lg").filter({ hasText: "New Contacts" });
    this.hourlyActivityChart = page.locator(".bg-white.rounded-lg").filter({ hasText: "Hourly Activity" });
    this.newContactsChartTitle = this.newContactsChart.getByRole("heading", { name: "New Contacts" });
    this.newContactsChartBars = this.newContactsChart.locator(".bg-purple-400, .bg-gray-100");
    this.newContactsChartSummary = this.newContactsChart.locator(".text-xs.text-gray-500");

    // Resolution Rate section
    this.resolutionRateSection = page.locator(".bg-white.rounded-lg").filter({ hasText: "Resolution Rate" });
    this.resolutionRateTitle = this.resolutionRateSection.getByRole("heading", { name: "Resolution Rate" });
    this.resolutionOpenCard = this.resolutionRateSection.locator(".bg-gray-50").filter({ hasText: "Open" });
    this.resolutionPendingCard = this.resolutionRateSection.locator(".bg-gray-50").filter({ hasText: "Pending" });
    this.resolutionResolvedCard = this.resolutionRateSection.locator(".bg-gray-50").filter({ hasText: "Resolved" });
    this.resolutionRateCard = this.resolutionRateSection.locator(".bg-gray-50").filter({ hasText: /Resolution Rate|%/ });

    // Export dialog
    this.exportDialog = page.getByRole("dialog");
    this.exportDialogTitle = page.getByRole("heading", { name: /full backup|export/i });
    this.exportDialogDescription = page.locator("[role=dialog] p.text-muted-foreground");
    this.exportDialogBackupInfo = page.locator("[role=dialog] .bg-muted");
    this.exportDialogDateSelect = page.getByRole("combobox");
    this.exportDialogDownloadButton = page.getByRole("button", { name: /download backup|export/i });
    this.exportDialogCancelButton = page.getByRole("button", { name: /cancel/i });
    this.exportDialogLoadingSpinner = page.locator("[role=dialog] .animate-spin");
  }

  /**
   * Navigate to dashboard page
   */
  async goto(): Promise<void> {
    await this.page.goto("/dashboard");
  }

  /**
   * Wait for the dashboard to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    await this.heading.waitFor({ state: "visible" });
  }

  /**
   * Click the Full Backup button
   */
  async clickFullBackup(): Promise<void> {
    await this.fullBackupButton.click();
  }

  /**
   * Click the Export Contacts button
   */
  async clickExportContacts(): Promise<void> {
    await this.exportContactsButton.click();
  }

  /**
   * Click the Export Messages button
   */
  async clickExportMessages(): Promise<void> {
    await this.exportMessagesButton.click();
  }

  /**
   * Wait for export dialog to appear
   */
  async waitForExportDialog(): Promise<void> {
    await this.exportDialog.waitFor({ state: "visible" });
  }

  /**
   * Close export dialog via Cancel button
   */
  async closeExportDialog(): Promise<void> {
    await this.exportDialogCancelButton.click();
    await this.exportDialog.waitFor({ state: "hidden" });
  }

  /**
   * Select date range in export dialog
   */
  async selectDateRange(range: "7d" | "30d" | "90d" | "all"): Promise<void> {
    await this.exportDialogDateSelect.click();
    const optionName = range === "7d" ? "Last 7 days" :
                       range === "30d" ? "Last 30 days" :
                       range === "90d" ? "Last 90 days" :
                       "All time";
    await this.page.getByRole("option", { name: optionName }).click();
  }

  /**
   * Click download/export button in dialog
   */
  async clickDownload(): Promise<void> {
    await this.exportDialogDownloadButton.click();
  }

  /**
   * Check if export dialog is visible
   */
  async isExportDialogVisible(): Promise<boolean> {
    return await this.exportDialog.isVisible();
  }

  /**
   * Take screenshot of the page
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `.screenshots/${name}.png`,
      fullPage: false,
    });
  }
}
