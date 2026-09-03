import { describe, expect, it } from "bun:test";
import {
  CHAT_LIST_FILTERS_KEY,
  CONVERSATION_STATUS_OPTIONS,
  DEFAULT_CHAT_LIST_FILTERS,
  readChatListFilters,
  writeChatListFilters,
} from "./chat-list-filters";

function fakeStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const throwingStore = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

describe("CONVERSATION_STATUS_OPTIONS", () => {
  it("offers All first, then the lifecycle in order", () => {
    expect(CONVERSATION_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      "open",
      "pending",
      "resolved",
    ]);
  });
});

describe("DEFAULT_CHAT_LIST_FILTERS", () => {
  it("opens on the widest view for a user with no saved filters", () => {
    expect(DEFAULT_CHAT_LIST_FILTERS).toEqual({
      status: "all",
      assignment: "all",
    });
  });
});

describe("readChatListFilters", () => {
  it("falls back to All + All with nothing stored", () => {
    expect(readChatListFilters(fakeStore())).toEqual({
      status: "all",
      assignment: "all",
    });
    expect(readChatListFilters(null)).toEqual(DEFAULT_CHAT_LIST_FILTERS);
  });

  it("restores a saved Open + Assigned to Me across a refresh", () => {
    const store = fakeStore({
      [CHAT_LIST_FILTERS_KEY]: JSON.stringify({
        status: "open",
        assignment: "assignedToMe",
      }),
    });

    expect(readChatListFilters(store)).toEqual({
      status: "open",
      assignment: "assignedToMe",
    });
  });

  it("restores a non-default status such as resolved", () => {
    const store = fakeStore({
      [CHAT_LIST_FILTERS_KEY]: JSON.stringify({
        status: "resolved",
        assignment: "unassigned",
      }),
    });

    expect(readChatListFilters(store)).toEqual({
      status: "resolved",
      assignment: "unassigned",
    });
  });

  // Both directions are checked with literal values rather than against
  // DEFAULT_CHAT_LIST_FILTERS: the default status is itself "all", so
  // comparing to the constant would pass for any fallback it ever held.
  it("resets an unknown status to all and keeps the stored assignment", () => {
    const store = fakeStore({
      [CHAT_LIST_FILTERS_KEY]: JSON.stringify({
        status: "archived",
        assignment: "unread",
      }),
    });

    expect(readChatListFilters(store)).toEqual({
      status: "all",
      assignment: "unread",
    });
  });

  it("resets an unknown assignment to all and keeps the stored status", () => {
    const store = fakeStore({
      [CHAT_LIST_FILTERS_KEY]: JSON.stringify({
        status: "resolved",
        assignment: "escalated",
      }),
    });

    expect(readChatListFilters(store)).toEqual({
      status: "resolved",
      assignment: "all",
    });
  });

  it("ignores malformed or non-object payloads", () => {
    expect(
      readChatListFilters(fakeStore({ [CHAT_LIST_FILTERS_KEY]: "{oops" })),
    ).toEqual(DEFAULT_CHAT_LIST_FILTERS);
    expect(
      readChatListFilters(fakeStore({ [CHAT_LIST_FILTERS_KEY]: "null" })),
    ).toEqual(DEFAULT_CHAT_LIST_FILTERS);
    expect(
      readChatListFilters(fakeStore({ [CHAT_LIST_FILTERS_KEY]: '"open"' })),
    ).toEqual(DEFAULT_CHAT_LIST_FILTERS);
  });

  it("survives storage that throws", () => {
    expect(readChatListFilters(throwingStore)).toEqual(
      DEFAULT_CHAT_LIST_FILTERS,
    );
  });
});

describe("writeChatListFilters", () => {
  it("round-trips through storage", () => {
    const store = fakeStore();
    writeChatListFilters({ status: "pending", assignment: "unread" }, store);

    expect(readChatListFilters(store)).toEqual({
      status: "pending",
      assignment: "unread",
    });
  });

  it("swallows storage failures", () => {
    expect(() =>
      writeChatListFilters(DEFAULT_CHAT_LIST_FILTERS, throwingStore),
    ).not.toThrow();
    expect(() =>
      writeChatListFilters(DEFAULT_CHAT_LIST_FILTERS, null),
    ).not.toThrow();
  });
});
