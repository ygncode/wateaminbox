import { describe, expect, it } from "bun:test";
import type { Chat } from "../../types/chat";
import { chatMatchesSearch } from "./chat-search";

function chat(contact: Partial<Chat["contact"]>): Chat {
  return {
    id: "chat-1",
    contact: {
      id: "contact-1",
      name: "",
      phoneNumber: "",
      ...contact,
    },
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    conversationStatus: "open",
    activeCaseId: null,
  };
}

// The production shape: a push name outranks the phone number in the
// display-name chain, so `name` never contains the digits the user typed.
const pushNamed = chat({
  name: "Software",
  phoneNumber: "917981075978",
  jid: "917981075978@s.whatsapp.net",
});

describe("chatMatchesSearch", () => {
  it("keeps every row for an empty search", () => {
    expect(chatMatchesSearch(pushNamed, "")).toBe(true);
    expect(chatMatchesSearch(pushNamed, "   ")).toBe(true);
  });

  it("matches the display name case-insensitively", () => {
    expect(chatMatchesSearch(pushNamed, "soft")).toBe(true);
    expect(chatMatchesSearch(pushNamed, "Software")).toBe(true);
    expect(chatMatchesSearch(pushNamed, "chrome")).toBe(false);
  });

  it("matches a phone number the display name does not contain", () => {
    expect(chatMatchesSearch(pushNamed, "917981075978")).toBe(true);
    expect(chatMatchesSearch(pushNamed, "79810")).toBe(true);
  });

  it("matches a formatted phone number against stored digits", () => {
    expect(chatMatchesSearch(pushNamed, "+91 79810 75978")).toBe(true);
    expect(chatMatchesSearch(pushNamed, "91-7981-075978")).toBe(true);
  });

  it("matches a phone number carried only by the JID", () => {
    const withoutNumber = chat({
      name: "Software",
      jid: "6582858917@s.whatsapp.net",
    });
    expect(chatMatchesSearch(withoutNumber, "6582858917")).toBe(true);
  });

  it("matches a username and a custom name when they are not the display name", () => {
    const named = chat({
      name: "Software",
      customName: "Accounts Payable",
      username: "acme_billing",
      phoneNumber: "917981075978",
    });
    expect(chatMatchesSearch(named, "acme_billing")).toBe(true);
    expect(chatMatchesSearch(named, "@acme_billing")).toBe(true);
    expect(chatMatchesSearch(named, "payable")).toBe(true);
  });

  it("does not match a channel conversation on an unrelated number search", () => {
    const telegram = chat({ name: "Telegram", phoneNumber: "" });
    expect(chatMatchesSearch(telegram, "917981075978")).toBe(false);
    expect(chatMatchesSearch(telegram, "tele")).toBe(true);
  });
});
