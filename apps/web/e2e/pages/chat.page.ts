import { Page, Locator } from "@playwright/test";

/**
 * Page Object Model for the Chat Page
 * Provides comprehensive locators and methods for testing chat functionality
 */
export class ChatPage {
  readonly page: Page;

  // Chat List Sidebar
  readonly chatListNav: Locator;
  readonly chatsTab: Locator;
  readonly groupsTab: Locator;
  readonly settingsLink: Locator;
  readonly chatList: Locator;
  readonly searchInput: Locator;
  readonly welcomeMessage: Locator;

  // Assignment Filter Buttons
  readonly filterAll: Locator;
  readonly filterAssignedToMe: Locator;
  readonly filterUnassigned: Locator;
  readonly addContactButton: Locator;

  // Add Contact Dialog
  readonly addContactDialog: Locator;
  readonly addContactPhoneInput: Locator;
  readonly addContactNameInput: Locator;
  readonly addContactNotesInput: Locator;
  readonly addContactSubmitButton: Locator;
  readonly addContactCancelButton: Locator;

  // Message Area
  readonly messageHeader: Locator;
  readonly messageThread: Locator;
  readonly messageComposer: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly attachButton: Locator;

  // Reply Preview
  readonly replyPreview: Locator;
  readonly cancelReplyButton: Locator;

  // Context Menu
  readonly contextMenu: Locator;
  readonly contextMenuReply: Locator;
  readonly contextMenuForward: Locator;
  readonly contextMenuStar: Locator;
  readonly contextMenuDelete: Locator;

  // Contact Profile Panel
  readonly profilePanel: Locator;
  readonly profileHeader: Locator;
  readonly profileCloseButton: Locator;
  readonly profileAvatar: Locator;
  readonly profileName: Locator;
  readonly profilePhoneNumber: Locator;

  // Conversation Search
  readonly conversationSearchButton: Locator;
  readonly conversationSearchBar: Locator;
  readonly conversationSearchInput: Locator;
  readonly conversationSearchClose: Locator;
  readonly conversationSearchNext: Locator;
  readonly conversationSearchPrev: Locator;
  readonly conversationSearchCounter: Locator;

  constructor(page: Page) {
    this.page = page;

    // Chat List Sidebar Locators
    this.chatListNav = page.getByRole("navigation", { name: "Chat list" });
    this.chatsTab = page.getByRole("tab").filter({ hasText: /chats/i });
    this.groupsTab = page.getByRole("tab").filter({ hasText: /groups/i });
    this.settingsLink = page.getByRole("link", { name: "Settings" });
    this.chatList = page.getByRole("listbox", { name: /conversations/i });
    this.searchInput = page.getByPlaceholder(/search/i);
    this.welcomeMessage = page.getByText(/select a conversation/i);

    // Assignment Filter Buttons
    this.filterAll = page.getByRole("button", { name: "All", exact: true });
    this.filterAssignedToMe = page.getByRole("button", { name: "Assigned to me" });
    this.filterUnassigned = page.getByRole("button", { name: "Unassigned" });
    this.addContactButton = page.getByTestId("add-contact-button");

    // Add Contact Dialog Locators
    this.addContactDialog = page.getByRole("dialog");
    this.addContactPhoneInput = page.getByTestId("add-contact-phone");
    this.addContactNameInput = page.getByTestId("add-contact-name");
    this.addContactNotesInput = page.getByTestId("add-contact-notes");
    this.addContactSubmitButton = page.getByTestId("add-contact-submit");
    this.addContactCancelButton = page.getByRole("button", { name: "Cancel" });

    // Message Area Locators
    this.messageHeader = page.locator("header").filter({ has: page.locator("h2") });
    this.messageThread = page.locator('[class*="bg-\\[\\#e5ddd5\\]"]');
    this.messageComposer = page.locator(".safe-area-bottom").filter({ has: page.locator("textarea") });
    this.messageInput = page.getByPlaceholder(/type a message/i);
    this.sendButton = page.getByRole("button", { name: /send/i });
    this.attachButton = page.getByRole("button", { name: "Attach file" });

    // Reply Preview Locators
    this.replyPreview = page.locator(".border-l-4.border-whatsapp-green");
    this.cancelReplyButton = page.getByRole("button", { name: "Cancel reply" });

    // Context Menu Locators
    this.contextMenu = page.locator(".shadow-lg.py-1");
    this.contextMenuReply = this.contextMenu.getByRole("button", { name: "Reply" });
    this.contextMenuForward = this.contextMenu.getByRole("button", { name: "Forward" });
    this.contextMenuStar = this.contextMenu.getByRole("button", { name: /star|unstar/i });
    this.contextMenuDelete = this.contextMenu.getByRole("button", { name: "Delete" });

    // Contact Profile Panel Locators
    this.profilePanel = page.locator("aside");
    this.profileHeader = page.getByText("Contact Info");
    this.profileCloseButton = page.getByRole("button", { name: /close/i });
    this.profileAvatar = page.locator(".h-32.w-32");
    this.profileName = page.locator(".text-xl.font-semibold");
    this.profilePhoneNumber = page.locator("text=Phone").locator("..");

    // Conversation Search Locators
    this.conversationSearchButton = page.getByRole("button", { name: /search/i }).first();
    this.conversationSearchBar = page.locator(".bg-gray-100.border-b");
    this.conversationSearchInput = page.getByPlaceholder(/search in conversation/i);
    this.conversationSearchClose = page.getByLabel("Close search");
    this.conversationSearchNext = page.getByLabel("Next result");
    this.conversationSearchPrev = page.getByLabel("Previous result");
    this.conversationSearchCounter = this.conversationSearchBar.locator(".text-sm.text-gray-500");
  }

  /**
   * Navigate to the chat page
   */
  async goto() {
    await this.page.goto("/chat");
  }

  /**
   * Navigate to a specific chat by contact ID
   */
  async gotoChat(contactId: string) {
    await this.page.goto(`/chat/${contactId}`);
  }

  /**
   * Wait for the chat page to be fully loaded
   */
  async waitForLoad() {
    await this.chatListNav.waitFor({ state: "visible" });
  }

  /**
   * Wait for the page network activity to settle
   */
  async waitForPageLoad() {
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Search for chats
   */
  async searchChats(query: string) {
    await this.searchInput.fill(query);
    // Wait for debounce
    await this.page.waitForTimeout(300);
  }

  /**
   * Clear the search input
   */
  async clearSearch() {
    const clearButton = this.page.getByRole("button", { name: "Clear search" });
    if (await clearButton.isVisible()) {
      await clearButton.click();
    } else {
      await this.searchInput.clear();
    }
  }

  /**
   * Click on a chat item by contact name
   */
  async selectChatByName(contactName: string) {
    const chatItem = this.chatList.getByRole("option").filter({ hasText: contactName });
    await chatItem.click();
  }

  /**
   * Click on a chat item by index (0-based)
   */
  async selectChatByIndex(index: number) {
    const chatItems = this.chatList.getByRole("option");
    await chatItems.nth(index).click();
  }

  /**
   * Get the number of visible chat items
   */
  async getChatCount(): Promise<number> {
    const chatItems = this.chatList.getByRole("option");
    return chatItems.count();
  }

  /**
   * Click an assignment filter button
   */
  async clickAssignmentFilter(filter: "all" | "assignedToMe" | "unassigned") {
    switch (filter) {
      case "all":
        await this.filterAll.click();
        break;
      case "assignedToMe":
        await this.filterAssignedToMe.click();
        break;
      case "unassigned":
        await this.filterUnassigned.click();
        break;
    }
    // Wait for filter to apply
    await this.page.waitForTimeout(300);
  }

  /**
   * Type a message in the composer
   */
  async typeMessage(message: string) {
    await this.messageInput.fill(message);
  }

  /**
   * Send a message by clicking the send button
   */
  async sendMessage() {
    await this.sendButton.click();
  }

  /**
   * Send a message by pressing Enter
   */
  async sendMessageWithEnter() {
    await this.messageInput.press("Enter");
  }

  /**
   * Type and send a message
   */
  async typeAndSendMessage(message: string) {
    await this.typeMessage(message);
    await this.sendMessage();
  }

  /**
   * Get all message bubbles in the thread
   */
  getMessageBubbles(): Locator {
    return this.page.locator(".rounded-lg.shadow-sm");
  }

  /**
   * Get the last message bubble
   */
  getLastMessageBubble(): Locator {
    return this.getMessageBubbles().last();
  }

  /**
   * Right-click on a message to open context menu
   */
  async openMessageContextMenu(messageLocator: Locator) {
    await messageLocator.click({ button: "right" });
    await this.contextMenu.waitFor({ state: "visible" });
  }

  /**
   * Click reply in the context menu
   */
  async clickReply() {
    await this.contextMenuReply.click();
  }

  /**
   * Cancel the current reply
   */
  async cancelReply() {
    await this.cancelReplyButton.click();
  }

  /**
   * Open the contact profile panel by clicking on the header
   */
  async openContactProfile() {
    // Click on the contact info button in the header (avatar + name area)
    const headerButton = this.messageHeader.locator("button").first();
    await headerButton.click();
    // Wait for profile panel to open
    await this.profileHeader.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Close the contact profile panel
   */
  async closeContactProfile() {
    await this.profileCloseButton.click();
  }

  /**
   * Get the currently displayed contact name from the header
   */
  async getContactNameFromHeader(): Promise<string | null> {
    const nameElement = this.messageHeader.locator("h2");
    return nameElement.textContent();
  }

  /**
   * Check if a message with specific text exists in the thread
   */
  async hasMessageWithText(text: string): Promise<boolean> {
    const message = this.page.getByText(text);
    return message.isVisible();
  }

  /**
   * Wait for a new message to appear in the thread
   */
  async waitForNewMessage(messageText: string, timeout: number = 5000) {
    await this.page.getByText(messageText).waitFor({
      state: "visible",
      timeout
    });
  }

  /**
   * Check if the message composer is visible
   */
  async isComposerVisible(): Promise<boolean> {
    return this.messageInput.isVisible();
  }

  /**
   * Check if the message thread is visible
   */
  async isMessageThreadVisible(): Promise<boolean> {
    // Check for the WhatsApp-style background
    const thread = this.page.locator('[class*="bg-\\[\\#e5ddd5\\]"]');
    return thread.isVisible();
  }

  /**
   * Check if reply preview is visible
   */
  async isReplyPreviewVisible(): Promise<boolean> {
    return this.replyPreview.isVisible();
  }

  /**
   * Get the current URL
   */
  getUrl(): string {
    return this.page.url();
  }

  /**
   * Check if a specific filter button is active (has the active class)
   */
  async isFilterActive(filter: "all" | "assignedToMe" | "unassigned"): Promise<boolean> {
    let button: Locator;
    switch (filter) {
      case "all":
        button = this.filterAll;
        break;
      case "assignedToMe":
        button = this.filterAssignedToMe;
        break;
      case "unassigned":
        button = this.filterUnassigned;
        break;
    }
    const classes = await button.getAttribute("class");
    // Active filter has the teal-green background
    return classes?.includes("bg-whatsapp-teal-green") ?? false;
  }

  // ============================================
  // Add Contact Dialog Methods
  // ============================================

  /**
   * Open the add contact dialog
   */
  async openAddContactDialog() {
    await this.addContactButton.click();
    await this.addContactDialog.waitFor({ state: "visible" });
  }

  /**
   * Fill the add contact form
   */
  async fillAddContactForm(data: {
    phoneNumber: string;
    name?: string;
    notes?: string;
  }) {
    await this.addContactPhoneInput.fill(data.phoneNumber);
    if (data.name) {
      await this.addContactNameInput.fill(data.name);
    }
    if (data.notes) {
      await this.addContactNotesInput.fill(data.notes);
    }
  }

  /**
   * Submit the add contact form
   */
  async submitAddContactForm() {
    await this.addContactSubmitButton.click();
  }

  /**
   * Cancel the add contact dialog
   */
  async cancelAddContactDialog() {
    await this.addContactCancelButton.click();
  }

  /**
   * Add a new contact with the provided data
   */
  async addContact(data: {
    phoneNumber: string;
    name?: string;
    notes?: string;
  }) {
    await this.openAddContactDialog();
    await this.fillAddContactForm(data);
    await this.submitAddContactForm();
  }

  /**
   * Check if the add contact dialog is visible
   */
  async isAddContactDialogVisible(): Promise<boolean> {
    return this.addContactDialog.isVisible();
  }

  /**
   * Get the error message from the add contact dialog
   * Checks both server errors (bg-red-50 alert) and field validation errors (text-red-500)
   */
  async getAddContactError(): Promise<string | null> {
    // Check for server error (displayed in alert box)
    const serverError = this.addContactDialog.locator(".bg-red-50");
    if (await serverError.isVisible()) {
      return serverError.textContent();
    }
    // Check for field validation error (displayed below input with role="alert")
    const fieldError = this.addContactDialog.locator('[role="alert"]');
    if (await fieldError.isVisible()) {
      return fieldError.textContent();
    }
    // Also check for dark mode variant
    const darkFieldError = this.addContactDialog.locator(".text-red-500, .text-red-400");
    if (await darkFieldError.first().isVisible()) {
      return darkFieldError.first().textContent();
    }
    return null;
  }

  /**
   * Wait for the success state in the add contact dialog
   */
  async waitForAddContactSuccess() {
    await this.addContactDialog.getByText("Contact Created!").waitFor({
      state: "visible",
      timeout: 5000,
    });
  }

  // ============================================
  // Conversation Search Methods
  // ============================================

  /**
   * Open the conversation search bar
   */
  async openConversationSearch() {
    await this.conversationSearchButton.click();
    await this.conversationSearchBar.waitFor({ state: "visible" });
  }

  /**
   * Close the conversation search bar
   */
  async closeConversationSearch() {
    await this.conversationSearchClose.click();
    await this.conversationSearchBar.waitFor({ state: "hidden" });
  }

  /**
   * Search for messages within the current conversation
   */
  async searchInConversation(query: string) {
    await this.conversationSearchInput.fill(query);
    // Wait for debounce
    await this.page.waitForTimeout(400);
  }

  /**
   * Clear the conversation search input
   */
  async clearConversationSearch() {
    const clearButton = this.conversationSearchBar.getByLabel("Clear search");
    if (await clearButton.isVisible()) {
      await clearButton.click();
    } else {
      await this.conversationSearchInput.clear();
    }
  }

  /**
   * Navigate to the next search result
   */
  async nextSearchResult() {
    await this.conversationSearchNext.click();
  }

  /**
   * Navigate to the previous search result
   */
  async prevSearchResult() {
    await this.conversationSearchPrev.click();
  }

  /**
   * Get the search result counter text (e.g., "1 of 5")
   */
  async getSearchResultCounter(): Promise<string | null> {
    return this.conversationSearchCounter.textContent();
  }

  /**
   * Check if the conversation search bar is visible
   */
  async isConversationSearchVisible(): Promise<boolean> {
    return this.conversationSearchBar.isVisible();
  }

  /**
   * Check if a message is highlighted (from search)
   */
  async isMessageHighlighted(messageId: string): Promise<boolean> {
    const message = this.page.locator(`[data-message-id="${messageId}"]`);
    if (await message.isVisible()) {
      const classes = await message.getAttribute("class");
      return classes?.includes("ring-yellow-400") ?? false;
    }
    return false;
  }
}
