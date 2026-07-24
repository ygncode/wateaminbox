import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Message } from "@wateaminbox/shared";
import { chatKeys } from "../../hooks/useChats";
import { infiniteMessageKeys } from "../../hooks/useInfiniteMessages";
import { setCompanyId } from "../../lib/api/client";
import {
  addMessageToCache,
  type InfiniteMessageData,
  updateMessageInCache,
} from "./cache-utils";
import { reconcileRealtimeState } from "./event-handlers";

function message(id: string, status: Message["status"] = "pending"): Message {
  return {
    id,
    conversationId: "conversation-1",
    senderId: "user-1",
    senderType: "user",
    messageType: "text",
    content: id,
    isStarred: false,
    isDeleted: false,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Message;
}

function seed(client: QueryClient, companyId: string) {
  setCompanyId(companyId);
  const messageKey = infiniteMessageKeys.list("conversation-1");
  const chatKey = chatKeys.list({});
  client.setQueryData<InfiniteMessageData>(messageKey, {
    pages: [{ messages: [message("pending-1")], hasMore: false }],
    pageParams: [undefined],
  });
  client.setQueryData(chatKey, []);
  return { messageKey, chatKey };
}

describe("realtime React Query reconciliation", () => {
  test("deduplicates realtime messages and advances cached status", () => {
    const client = new QueryClient();
    const { messageKey } = seed(client, "company-a");
    const incoming = message("real-1", "sent");
    expect(addMessageToCache(client, "conversation-1", incoming).added).toBe(
      true,
    );
    expect(
      addMessageToCache(client, "conversation-1", incoming).isDuplicate,
    ).toBe(true);
    expect(
      updateMessageInCache(client, "conversation-1", "pending-1", (cached) => ({
        ...cached,
        status: "failed",
      })),
    ).toBe(true);
    const data = client.getQueryData<InfiniteMessageData>(messageKey);
    expect(data?.pages[0].messages).toHaveLength(2);
    expect(data?.pages[0].messages[1].status).toBe("failed");
  });

  test("reconnect invalidates only current-company state", () => {
    const client = new QueryClient();
    const companyA = seed(client, "company-a");
    const companyB = seed(client, "company-b");

    reconcileRealtimeState(client, "conversation-1");

    expect(client.getQueryState(companyB.chatKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(companyA.chatKey)?.isInvalidated).toBe(false);
  });
});
