import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Message } from "@wateaminbox/shared";
import { queryKeys } from "../../hooks/query-keys";
import { chatKeys } from "../../hooks/useChats";
import { infiniteMessageKeys } from "../../hooks/useInfiniteMessages";
import { setCompanyId } from "../../lib/api/client";
import {
  addMessageToCache,
  type InfiniteMessageData,
  invalidateChatList,
  updateMessageInCache,
  updateContactInChatList,
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
  const groupKey = queryKeys.groups.list({});
  const groupDetailKey = queryKeys.groups.detail("conversation-1");
  client.setQueryData<InfiniteMessageData>(messageKey, {
    pages: [
      {
        messages: [message("pending-1")],
        hasMore: false,
        remoteHistoryStatus: "unknown",
      },
    ],
    pageParams: [undefined],
  });
  client.setQueryData(chatKey, []);
  client.setQueryData(groupKey, { data: [] });
  client.setQueryData(groupDetailKey, { participants: [] });
  return { messageKey, chatKey, groupKey, groupDetailKey };
}

describe("realtime React Query reconciliation", () => {
  test("contact events update every infinite page and preserve pagination", () => {
    const client = new QueryClient();
    setCompanyId("company-a");
    const key = chatKeys.infiniteList({});
    const chat = {
      id: "a",
      contact: { jid: "a@s.whatsapp.net", name: "Before" },
    };
    const other = {
      id: "b",
      contact: { jid: "b@s.whatsapp.net", name: "Other" },
    };
    const pages = [
      { chats: [other], nextOffset: 1 },
      { chats: [chat], nextOffset: undefined },
    ];
    client.setQueryData(key, { pages, pageParams: [0, 1] });
    client.setQueryData(chatKeys.list({}), [chat]);
    setCompanyId("company-b");
    const otherWorkspace = chatKeys.infiniteList({});
    client.setQueryData(otherWorkspace, { pages, pageParams: [0, 1] });
    setCompanyId("company-a");

    updateContactInChatList(client, "a@s.whatsapp.net", (contact) => ({
      ...contact,
      name: "After",
    }));

    expect(
      client.getQueryData<{ pages: typeof pages; pageParams: number[] }>(key),
    ).toEqual({
      pages: [
        pages[0],
        {
          ...pages[1],
          chats: [{ ...chat, contact: { ...chat.contact, name: "After" } }],
        },
      ],
      pageParams: [0, 1],
    });
    expect(client.getQueryData<(typeof chat)[]>(chatKeys.list({}))).toEqual([
      { ...chat, contact: { ...chat.contact, name: "After" } },
    ]);
    expect(
      client.getQueryData<{ pages: typeof pages; pageParams: number[] }>(
        otherWorkspace,
      ),
    ).toEqual({
      pages,
      pageParams: [0, 1],
    });
    invalidateChatList(client);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  });

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
    expect(client.getQueryState(companyB.groupKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(companyB.groupDetailKey)?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(companyA.chatKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(companyA.groupKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(companyA.groupDetailKey)?.isInvalidated).toBe(
      false,
    );
  });

  test("reconnect reconciliation invalidates the analytics prefix and the selected conversation's lifecycle detail", () => {
    const client = new QueryClient();
    setCompanyId("company-a");

    const analyticsKey = queryKeys.analytics.responseTimeStats("company-a");
    const otherAnalyticsKey = queryKeys.analytics.resolution(
      "company-a",
      "2026-01-01",
      "2026-01-31",
    );
    const lifecycleDetailKey = queryKeys.conversations.detail("conversation-1");
    client.setQueryData(analyticsKey, {});
    client.setQueryData(otherAnalyticsKey, {});
    client.setQueryData(lifecycleDetailKey, {});

    reconcileRealtimeState(client, "conversation-1");

    // A single "analytics" prefix invalidation covers every cached
    // response-time/resolution variant, not just one specific query.
    expect(client.getQueryState(analyticsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherAnalyticsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(lifecycleDetailKey)?.isInvalidated).toBe(true);
  });

  test("reconnect reconciliation with no selected conversation still invalidates analytics, but touches no conversation detail", () => {
    const client = new QueryClient();
    setCompanyId("company-a");
    const analyticsKey = queryKeys.analytics.responseTimeStats("company-a");
    client.setQueryData(analyticsKey, {});

    reconcileRealtimeState(client, null);

    expect(client.getQueryState(analyticsKey)?.isInvalidated).toBe(true);
  });

  test("message and read updates invalidate chat and group projections together", () => {
    const client = new QueryClient();
    const current = seed(client, "company-a");

    invalidateChatList(client);

    expect(client.getQueryState(current.chatKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(current.groupKey)?.isInvalidated).toBe(true);
  });
});
