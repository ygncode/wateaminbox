import { Page, Locator } from "@playwright/test";
import { BasePage } from "./base.page";

/**
 * Home Page Object Model
 * Represents the main landing/home page of the WhatsApp Web app
 */
export class HomePage extends BasePage {
  // Define locators
  readonly header: Locator;
  readonly chatList: Locator;
  readonly searchInput: Locator;
  readonly newChatButton: Locator;

  constructor(page: Page) {
    super(page);

    // Initialize locators - adjust selectors based on actual app structure
    this.header = page.locator("header");
    this.chatList = page.getByTestId("chat-list");
    this.searchInput = page.getByPlaceholder(/search/i);
    this.newChatButton = page.getByRole("button", { name: /new chat/i });
  }

  /**
   * Navigate to home page
   */
  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  /**
   * Wait for the home page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Search for a chat
   */
  async searchChat(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  /**
   * Click on a chat item by name
   */
  async selectChat(chatName: string): Promise<void> {
    await this.page.getByRole("button", { name: chatName }).click();
  }

  /**
   * Check if the page is visible
   */
  async isVisible(): Promise<boolean> {
    return await this.header.isVisible();
  }
}
