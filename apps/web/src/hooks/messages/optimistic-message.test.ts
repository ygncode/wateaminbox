import { describe, expect, test } from "bun:test";
import type { Message } from "@wateaminbox/shared";
import {
  createOptimisticMessage,
  prependOptimisticMessage,
  reconcileOptimisticMessage,
} from "./optimistic-message";
import type { InfiniteMessagesData } from "./types";

const existing = {
  id: "existing",
  conversationId: "contact-1",
  senderId: "contact-1",
  senderType: "contact",
  messageType: "text",
  content: "before",
  isStarred: false,
  isDeleted: false,
  status: "delivered",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Message;

const initial = {
  pages: [
    {
      messages: [existing],
      hasMore: false,
      remoteHistoryStatus: "unknown",
    },
  ],
  pageParams: [undefined],
} as InfiniteMessagesData;

describe("optimistic message reconciliation", () => {
  test("adds a pending message and replaces it with the API confirmation", () => {
    const optimistic = createOptimisticMessage({
      contactId: "contact-1",
      content: "hello",
      messageType: "text",
    });
    const withOptimistic = prependOptimisticMessage(initial, optimistic);
    expect(withOptimistic?.pages[0].messages[0].status).toBe("pending");

    const confirmed = {
      ...optimistic,
      id: "database-message-id",
      status: "sent",
    } as Message;
    const reconciled = reconcileOptimisticMessage(
      withOptimistic,
      optimistic.id,
      confirmed,
    );
    expect(reconciled?.pages[0].messages.map((message) => message.id)).toEqual([
      "database-message-id",
      "existing",
    ]);
  });

  test("removes the optimistic copy when realtime confirmation arrived first", () => {
    const optimistic = createOptimisticMessage({
      contactId: "contact-1",
      content: "hello",
      messageType: "text",
    });
    const confirmed = {
      ...optimistic,
      id: "database-message-id",
      status: "pending",
    } as Message;
    const realtimeFirst = {
      ...initial,
      pages: [
        {
          ...initial.pages[0],
          messages: [confirmed, optimistic, existing],
        },
      ],
    };

    const reconciled = reconcileOptimisticMessage(
      realtimeFirst,
      optimistic.id,
      confirmed,
    );
    expect(reconciled?.pages[0].messages.map((message) => message.id)).toEqual([
      "database-message-id",
      "existing",
    ]);
  });

  test("preserves cache for rollback and ignores unrelated confirmations", () => {
    const confirmed = { ...existing, id: "other" } as Message;
    expect(reconcileOptimisticMessage(initial, "missing", confirmed)).toEqual(
      initial,
    );
  });
});
