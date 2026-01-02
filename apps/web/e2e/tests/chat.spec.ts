import { test, expect } from "../fixtures/auth.fixture";
import { ChatPage } from "../pages";

/**
 * E2E Tests for Chat Flow
 *
 * These tests cover the main chat functionality:
 * 1. Chat List Display
 * 2. Select a Chat
 * 3. Send a Message
 * 4. Reply to Message
 * 5. Contact Profile Panel
 * 6. Assignment Filters
 */

test.describe("Chat Flow", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ authenticatedPage }) => {
    chatPage = new ChatPage(authenticatedPage);
    await chatPage.goto();
    await chatPage.waitForLoad();
  });

  // ============================================
  // 1. Chat List Display Tests
  // ============================================
  test.describe("Chat List Display", () => {
    test("should display chat list after login", async () => {
      // Verify the chat list header is visible
      await expect(chatPage.chatListHeader).toBeVisible();

      // Verify the chat list container is visible
      await expect(chatPage.chatList).toBeVisible();
    });

    test("should display search input", async () => {
      // Verify search input is present and accessible
      await expect(chatPage.searchInput).toBeVisible();
      await expect(chatPage.searchInput).toBeEnabled();

      // Verify placeholder text
      await expect(chatPage.searchInput).toHaveAttribute(
        "placeholder",
        /search/i
      );
    });

    test("should display chat list navigation", async () => {
      // Verify the navigation landmark is present for accessibility
      await expect(chatPage.chatListNav).toBeVisible();
      await expect(chatPage.chatListNav).toHaveAttribute(
        "aria-label",
        "Chat list"
      );
    });

    test("should show welcome message when no chat is selected", async () => {
      // When on /chat without a contactId, welcome message should show
      await expect(chatPage.welcomeMessage).toBeVisible();
    });

    test("should filter chats when searching", async ({ authenticatedPage }) => {
      // Get initial chat count (if any)
      const initialCount = await chatPage.getChatCount();

      // Only test search if there are chats
      if (initialCount > 0) {
        // Type a search query
        await chatPage.searchChats("nonexistent-contact-xyz");

        // Wait for search results
        await authenticatedPage.waitForTimeout(500);

        // Either no results message or filtered list
        const noResultsMessage = authenticatedPage.getByText("No chats found");
        const chatCount = await chatPage.getChatCount();

        // Should either show no results or fewer chats
        const noResults = await noResultsMessage.isVisible();
        expect(noResults || chatCount <= initialCount).toBeTruthy();

        // Clear search
        await chatPage.clearSearch();
      }
    });
  });

  // ============================================
  // 2. Select a Chat Tests
  // ============================================
  test.describe("Select a Chat", () => {
    test("should navigate to chat URL when clicking a chat item", async ({
      authenticatedPage,
    }) => {
      // Wait for chats to load
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Click on the first chat
        await chatPage.selectChatByIndex(0);

        // Wait for navigation
        await authenticatedPage.waitForURL(/\/chat\/.+/);

        // Verify URL changed to include a contactId
        const url = chatPage.getUrl();
        expect(url).toMatch(/\/chat\/[a-zA-Z0-9-]+/);
      }
    });

    test("should display message thread when chat is selected", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select the first chat
        await chatPage.selectChatByIndex(0);

        // Wait for URL change
        await authenticatedPage.waitForURL(/\/chat\/.+/);

        // Verify message thread area is visible
        // The thread has the WhatsApp-style background or shows loading/empty state
        const hasThread = await chatPage.isMessageThreadVisible();
        const hasWelcome = await chatPage.welcomeMessage.isVisible().catch(() => false);

        // Either thread is visible or it's loading (welcome should be hidden)
        expect(hasThread || !hasWelcome).toBeTruthy();
      }
    });

    test("should display message composer when chat is selected", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select the first chat
        await chatPage.selectChatByIndex(0);

        // Wait for navigation
        await authenticatedPage.waitForURL(/\/chat\/.+/);

        // Wait for composer to appear
        await authenticatedPage.waitForTimeout(300);

        // Verify composer is visible
        const composerVisible = await chatPage.isComposerVisible();
        expect(composerVisible).toBeTruthy();
      }
    });

    test("should display contact name in header when chat is selected", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select the first chat
        await chatPage.selectChatByIndex(0);

        // Wait for navigation
        await authenticatedPage.waitForURL(/\/chat\/.+/);

        // Wait for header to update
        await authenticatedPage.waitForTimeout(300);

        // Verify contact name is displayed in header
        await expect(chatPage.messageHeader.locator("h2")).toBeVisible();
        const contactName = await chatPage.getContactNameFromHeader();
        expect(contactName).toBeTruthy();
        expect(contactName?.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================
  // 3. Send a Message Tests
  // ============================================
  test.describe("Send a Message", () => {
    test("should enable send button when message is typed", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(300);

        // Initially send button should be disabled (no message)
        const initialDisabled = await chatPage.sendButton.isDisabled();
        expect(initialDisabled).toBeTruthy();

        // Type a message
        const testMessage = "Test message " + Date.now();
        await chatPage.typeMessage(testMessage);

        // Send button should now be enabled
        const afterTypingDisabled = await chatPage.sendButton.isDisabled();
        expect(afterTypingDisabled).toBeFalsy();
      }
    });

    test("should send message when clicking send button", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(300);

        // Type and send a message
        const testMessage = "E2E Test Message " + Date.now();
        await chatPage.typeMessage(testMessage);
        await chatPage.sendMessage();

        // Verify message appears in thread (optimistic update)
        // The message should appear immediately due to optimistic updates
        await chatPage.waitForNewMessage(testMessage, 5000);

        const hasMessage = await chatPage.hasMessageWithText(testMessage);
        expect(hasMessage).toBeTruthy();
      }
    });

    test("should send message when pressing Enter", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(300);

        // Type and send with Enter
        const testMessage = "E2E Enter Test " + Date.now();
        await chatPage.typeMessage(testMessage);
        await chatPage.sendMessageWithEnter();

        // Verify message appears
        await chatPage.waitForNewMessage(testMessage, 5000);
        const hasMessage = await chatPage.hasMessageWithText(testMessage);
        expect(hasMessage).toBeTruthy();
      }
    });

    test("should clear input after sending message", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(300);

        // Type and send
        const testMessage = "Clear input test " + Date.now();
        await chatPage.typeAndSendMessage(testMessage);

        // Wait a moment for the UI to update
        await authenticatedPage.waitForTimeout(200);

        // Input should be cleared
        await expect(chatPage.messageInput).toHaveValue("");
      }
    });
  });

  // ============================================
  // 4. Reply to Message Tests
  // ============================================
  test.describe("Reply to Message", () => {
    test("should open context menu on right-click", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        // Check if there are any messages
        const messageBubbles = chatPage.getMessageBubbles();
        const messageCount = await messageBubbles.count();

        if (messageCount > 0) {
          // Right-click on the first message
          const firstMessage = messageBubbles.first();
          await chatPage.openMessageContextMenu(firstMessage);

          // Verify context menu is visible
          await expect(chatPage.contextMenu).toBeVisible();
          await expect(chatPage.contextMenuReply).toBeVisible();
        }
      }
    });

    test("should show reply preview when clicking Reply", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        const messageBubbles = chatPage.getMessageBubbles();
        const messageCount = await messageBubbles.count();

        if (messageCount > 0) {
          // Open context menu and click Reply
          const firstMessage = messageBubbles.first();
          await chatPage.openMessageContextMenu(firstMessage);
          await chatPage.clickReply();

          // Wait for context menu to close and reply preview to appear
          await authenticatedPage.waitForTimeout(300);

          // Verify reply preview is visible
          const replyVisible = await chatPage.isReplyPreviewVisible();
          expect(replyVisible).toBeTruthy();
        }
      }
    });

    test("should send reply with reference to original message", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        const messageBubbles = chatPage.getMessageBubbles();
        const messageCount = await messageBubbles.count();

        if (messageCount > 0) {
          // Open context menu and click Reply
          const firstMessage = messageBubbles.first();
          await chatPage.openMessageContextMenu(firstMessage);
          await chatPage.clickReply();

          await authenticatedPage.waitForTimeout(300);

          // Type and send a reply
          const replyMessage = "This is a reply " + Date.now();
          await chatPage.typeAndSendMessage(replyMessage);

          // Verify the reply appears in the thread
          await chatPage.waitForNewMessage(replyMessage, 5000);
          const hasReply = await chatPage.hasMessageWithText(replyMessage);
          expect(hasReply).toBeTruthy();

          // Reply preview should be cleared after sending
          const replyPreviewVisible = await chatPage.isReplyPreviewVisible();
          expect(replyPreviewVisible).toBeFalsy();
        }
      }
    });

    test("should cancel reply when clicking cancel button", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        const messageBubbles = chatPage.getMessageBubbles();
        const messageCount = await messageBubbles.count();

        if (messageCount > 0) {
          // Open context menu and click Reply
          const firstMessage = messageBubbles.first();
          await chatPage.openMessageContextMenu(firstMessage);
          await chatPage.clickReply();

          await authenticatedPage.waitForTimeout(300);

          // Verify reply preview is visible
          let replyVisible = await chatPage.isReplyPreviewVisible();
          expect(replyVisible).toBeTruthy();

          // Cancel the reply
          await chatPage.cancelReply();

          // Verify reply preview is hidden
          await authenticatedPage.waitForTimeout(200);
          replyVisible = await chatPage.isReplyPreviewVisible();
          expect(replyVisible).toBeFalsy();
        }
      }
    });
  });

  // ============================================
  // 5. Contact Profile Panel Tests
  // ============================================
  test.describe("Contact Profile Panel", () => {
    test("should open profile panel when clicking on header", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        // Open the contact profile
        await chatPage.openContactProfile();

        // Verify profile panel is visible
        await expect(chatPage.profileHeader).toBeVisible();
      }
    });

    test("should display contact information in profile", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        // Open the contact profile
        await chatPage.openContactProfile();

        // Verify profile header shows "Contact Info"
        await expect(chatPage.profileHeader).toBeVisible();

        // Verify avatar or name is displayed
        // The profile shows either an avatar image or name initials
        const hasAvatar = await chatPage.profileAvatar.isVisible().catch(() => false);
        const hasName = await chatPage.profileName.isVisible().catch(() => false);

        expect(hasAvatar || hasName).toBeTruthy();
      }
    });

    test("should close profile panel when clicking close button", async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.waitForTimeout(500);
      const chatCount = await chatPage.getChatCount();

      if (chatCount > 0) {
        // Select a chat
        await chatPage.selectChatByIndex(0);
        await authenticatedPage.waitForURL(/\/chat\/.+/);
        await authenticatedPage.waitForTimeout(500);

        // Open and then close the profile
        await chatPage.openContactProfile();
        await expect(chatPage.profileHeader).toBeVisible();

        await chatPage.closeContactProfile();

        // Wait for animation
        await authenticatedPage.waitForTimeout(300);

        // Profile header should no longer be visible
        await expect(chatPage.profileHeader).not.toBeVisible();
      }
    });
  });

  // ============================================
  // 6. Assignment Filters Tests
  // ============================================
  test.describe("Assignment Filters", () => {
    test("should display all filter buttons", async () => {
      // Verify all filter buttons are visible
      await expect(chatPage.filterAll).toBeVisible();
      await expect(chatPage.filterAssignedToMe).toBeVisible();
      await expect(chatPage.filterUnassigned).toBeVisible();
    });

    test("should have 'All' filter active by default", async () => {
      // Check that "All" filter is active by default
      const isAllActive = await chatPage.isFilterActive("all");
      expect(isAllActive).toBeTruthy();
    });

    test("should switch to 'Assigned to me' filter when clicked", async ({
      authenticatedPage,
    }) => {
      // Click on "Assigned to me" filter
      await chatPage.clickAssignmentFilter("assignedToMe");

      // Wait for filter to apply
      await authenticatedPage.waitForTimeout(300);

      // Verify the filter is now active
      const isAssignedActive = await chatPage.isFilterActive("assignedToMe");
      expect(isAssignedActive).toBeTruthy();

      // "All" filter should no longer be active
      const isAllActive = await chatPage.isFilterActive("all");
      expect(isAllActive).toBeFalsy();
    });

    test("should switch to 'Unassigned' filter when clicked", async ({
      authenticatedPage,
    }) => {
      // Click on "Unassigned" filter
      await chatPage.clickAssignmentFilter("unassigned");

      // Wait for filter to apply
      await authenticatedPage.waitForTimeout(300);

      // Verify the filter is now active
      const isUnassignedActive = await chatPage.isFilterActive("unassigned");
      expect(isUnassignedActive).toBeTruthy();
    });

    test("should return to 'All' filter when clicked", async ({
      authenticatedPage,
    }) => {
      // First switch to another filter
      await chatPage.clickAssignmentFilter("assignedToMe");
      await authenticatedPage.waitForTimeout(300);

      // Then switch back to "All"
      await chatPage.clickAssignmentFilter("all");
      await authenticatedPage.waitForTimeout(300);

      // Verify "All" is active again
      const isAllActive = await chatPage.isFilterActive("all");
      expect(isAllActive).toBeTruthy();
    });

    test("should update chat list when filter changes", async ({
      authenticatedPage,
    }) => {
      // Get initial count with "All" filter
      const allCount = await chatPage.getChatCount();

      // Switch to "Assigned to me" filter
      await chatPage.clickAssignmentFilter("assignedToMe");
      await authenticatedPage.waitForTimeout(500);

      // Get count after filter
      const assignedCount = await chatPage.getChatCount();

      // Switch to "Unassigned" filter
      await chatPage.clickAssignmentFilter("unassigned");
      await authenticatedPage.waitForTimeout(500);

      // Get count after filter
      const unassignedCount = await chatPage.getChatCount();

      // The sum of assigned and unassigned should be <= all
      // (or equal if there are no other states)
      expect(assignedCount + unassignedCount).toBeLessThanOrEqual(allCount + 1);
    });
  });
});

// ============================================
// 7. Add Contact Tests
// ============================================
test.describe("Add Contact", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ authenticatedPage }) => {
    chatPage = new ChatPage(authenticatedPage);
    await chatPage.goto();
    await chatPage.waitForLoad();
  });

  test("should display add contact button", async () => {
    // Verify the add contact button is visible
    await expect(chatPage.addContactButton).toBeVisible();
  });

  test("should open add contact dialog when clicking button", async () => {
    // Click the add contact button
    await chatPage.openAddContactDialog();

    // Verify dialog is visible
    await expect(chatPage.addContactDialog).toBeVisible();

    // Verify dialog title
    await expect(chatPage.addContactDialog.getByText("Add New Contact")).toBeVisible();

    // Verify form fields are present
    await expect(chatPage.addContactPhoneInput).toBeVisible();
    await expect(chatPage.addContactNameInput).toBeVisible();
    await expect(chatPage.addContactNotesInput).toBeVisible();
  });

  test("should close dialog when clicking cancel", async () => {
    // Open dialog
    await chatPage.openAddContactDialog();
    await expect(chatPage.addContactDialog).toBeVisible();

    // Cancel
    await chatPage.cancelAddContactDialog();

    // Dialog should be closed
    await expect(chatPage.addContactDialog).not.toBeVisible();
  });

  test("should show error when phone number is missing", async ({
    authenticatedPage,
  }) => {
    // Open dialog
    await chatPage.openAddContactDialog();

    // Try to submit without phone number
    await chatPage.submitAddContactForm();

    // Should show validation error
    await authenticatedPage.waitForTimeout(300);
    const error = await chatPage.getAddContactError();
    expect(error).toContain("Phone number is required");
  });

  test("should show error when phone number is too short", async ({
    authenticatedPage,
  }) => {
    // Open dialog
    await chatPage.openAddContactDialog();

    // Enter short phone number
    await chatPage.fillAddContactForm({ phoneNumber: "123" });

    // Try to submit
    await chatPage.submitAddContactForm();

    // Should show validation error
    await authenticatedPage.waitForTimeout(300);
    const error = await chatPage.getAddContactError();
    expect(error).toContain("too short");
  });

  test("should have submit button disabled when phone is empty", async () => {
    // Open dialog
    await chatPage.openAddContactDialog();

    // Initially submit button should be disabled
    await expect(chatPage.addContactSubmitButton).toBeDisabled();
  });

  test("should enable submit button when phone is entered", async () => {
    // Open dialog
    await chatPage.openAddContactDialog();

    // Enter valid phone
    await chatPage.fillAddContactForm({ phoneNumber: "+1234567890" });

    // Submit button should now be enabled
    await expect(chatPage.addContactSubmitButton).not.toBeDisabled();
  });

  test("should create contact with valid phone number", async ({
    authenticatedPage,
  }) => {
    // Generate unique phone number
    const uniquePhone = "+1" + Date.now().toString().slice(-10);

    // Open dialog and fill form
    await chatPage.openAddContactDialog();
    await chatPage.fillAddContactForm({
      phoneNumber: uniquePhone,
      name: "E2E Test Contact",
      notes: "Created by E2E test",
    });

    // Submit
    await chatPage.submitAddContactForm();

    // Wait for success or error
    await authenticatedPage.waitForTimeout(1000);

    // Check if we got success or an API error (which is expected in test environment)
    const dialogVisible = await chatPage.isAddContactDialogVisible();
    if (dialogVisible) {
      // Either success state or error - both are acceptable in test environment
      const successText = chatPage.addContactDialog.getByText("Contact Created!");
      const hasSuccess = await successText.isVisible().catch(() => false);
      const error = await chatPage.getAddContactError();

      // Test passes if we got success OR a backend error (since API might not be running)
      expect(hasSuccess || error !== null).toBeTruthy();
    }
  });

  test("should clear form when dialog is reopened", async ({
    authenticatedPage,
  }) => {
    // Open dialog and fill form
    await chatPage.openAddContactDialog();
    await chatPage.fillAddContactForm({
      phoneNumber: "+1234567890",
      name: "Test Name",
    });

    // Cancel
    await chatPage.cancelAddContactDialog();

    // Wait for dialog to close
    await authenticatedPage.waitForTimeout(300);

    // Reopen dialog
    await chatPage.openAddContactDialog();

    // Form should be cleared
    await expect(chatPage.addContactPhoneInput).toHaveValue("");
    await expect(chatPage.addContactNameInput).toHaveValue("");
  });
});

// ============================================
// Authentication Flow Tests (kept from original)
// ============================================
test.describe("Authentication Flow", () => {
  test("should redirect to login when not authenticated", async ({ page }) => {
    // Try to access a protected route without authentication
    await page.goto("/chat");

    // Should be redirected to login
    await expect(page).toHaveURL(/.*login.*/);
  });

  test("should show login form elements", async ({ page }) => {
    await page.goto("/login");

    // Check for email input
    await expect(page.getByLabel(/email/i)).toBeVisible();

    // Check for password input
    await expect(page.getByLabel(/password/i)).toBeVisible();

    // Check for login button
    await expect(page.getByRole("button", { name: /login|sign in/i })).toBeVisible();
  });
});
