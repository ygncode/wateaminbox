import { describe, expect, test } from "bun:test";
import type { CustomerChat } from "@/lib/api/contacts";
import { shouldOfferChatSwitcher } from "./ChatSwitcher";

const chat = (chatId: string): CustomerChat => ({
  chatId,
  conversationId: null,
  contactId: chatId,
  channel: "whatsapp",
  provider: "whatsapp_linked_device",
  accountId: null,
  accountName: null,
  address: null,
  jid: null,
  connection: null,
  displayName: null,
  avatarUrl: null,
  lastMessageAt: null,
  unreadCount: 0,
});

describe("shouldOfferChatSwitcher", () => {
  test("renders nothing for the ordinary single-thread customer", () => {
    // The composer is the most-used surface in the product; a control that
    // never has a second option is noise there.
    expect(shouldOfferChatSwitcher([])).toBe(false);
    expect(shouldOfferChatSwitcher([chat("a")])).toBe(false);
  });

  test("appears once a merged customer has more than one thread", () => {
    expect(shouldOfferChatSwitcher([chat("a"), chat("b")])).toBe(true);
  });
});
