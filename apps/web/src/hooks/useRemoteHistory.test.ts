import type { InfiniteData } from "@tanstack/react-query";
import {
  REMOTE_HISTORY_RESPONSE_TIMEOUT_MS,
  type Message,
  type PaginatedMessages,
} from "@wateaminbox/shared";
import { describe, expect, test } from "bun:test";
import {
  appendRemoteHistoryPage,
  oldestLoadedMessageId,
} from "./useRemoteHistory";

function message(id: string): Message {
  const date = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    conversationId: "contact-1",
    senderId: "sender",
    senderType: "contact",
    messageType: "text",
    content: id,
    isStarred: false,
    isDeleted: false,
    status: "read",
    createdAt: date,
    updatedAt: date,
  };
}

function history(
  ids: string[],
): InfiniteData<PaginatedMessages, string | undefined> {
  return {
    pages: [
      {
        messages: ids.map(message),
        hasMore: false,
        remoteHistoryStatus: "unknown",
      },
    ],
    pageParams: [undefined],
  };
}

describe("remote WhatsApp history cache", () => {
  test("allows delayed WhatsApp history pages to arrive without a false timeout", () => {
    expect(REMOTE_HISTORY_RESPONSE_TIMEOUT_MS).toBeGreaterThanOrEqual(
      10 * 60_000,
    );
  });

  test("uses the oldest loaded database message as the phone request anchor", () => {
    expect(oldestLoadedMessageId(history(["new", "old"]))).toBe("old");
  });

  test("appends only newly imported messages and retains remote availability", () => {
    const result = appendRemoteHistoryPage(
      history(["new", "anchor"]),
      {
        messages: [message("anchor"), message("older")],
        hasMore: false,
        remoteHistoryStatus: "available",
      },
      "anchor",
      "available",
    );

    expect(result?.pages).toHaveLength(2);
    expect(result?.pages[1]?.messages.map(({ id }) => id)).toEqual(["older"]);
    expect(result?.pages[1]?.remoteHistoryStatus).toBe("available");
  });

  test("stops local pagination when WhatsApp reports the beginning", () => {
    const result = appendRemoteHistoryPage(
      history(["anchor"]),
      {
        messages: [message("older")],
        hasMore: true,
        remoteHistoryStatus: "exhausted",
      },
      "anchor",
      "exhausted",
    );

    expect(result?.pages[1]?.hasMore).toBe(false);
    expect(result?.pages[1]?.remoteHistoryStatus).toBe("exhausted");
  });
});
