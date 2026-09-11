import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { Message } from "@wateaminbox/shared";
import {
  selectInfiniteMessages,
  infiniteMessageKeys,
} from "../useInfiniteMessages";
import { setCompanyId } from "../../lib/api/client";
import { queryKeys } from "../query-keys";
import { setMessageStarredInCaches } from "./message-star-cache";

const CONVERSATION_ID = "conversation-1";
const COMPANY_ID = "company-a";

function message(id: string, isStarred = false): Message {
  return {
    id,
    conversationId: CONVERSATION_ID,
    senderId: "user-1",
    senderType: "user",
    messageType: "text",
    content: id,
    isStarred,
    isDeleted: false,
    status: "sent",
    createdAt: new Date("2026-09-08T10:00:00.000Z"),
    updatedAt: new Date("2026-09-08T10:00:00.000Z"),
  } as Message;
}

/**
 * Two pages, so the assertions cover the cross-page walk rather than only the
 * page that happens to hold the newest messages.
 */
function seedInfiniteMessages(
  client: QueryClient,
  starredIds: string[] = [],
) {
  const key = infiniteMessageKeys.list(CONVERSATION_ID);
  const starred = new Set(starredIds);
  client.setQueryData(key, {
    pages: [
      {
        messages: [
          message("newest", starred.has("newest")),
          message("middle", starred.has("middle")),
        ],
        hasMore: true,
        nextCursor: "cursor-1",
        remoteHistoryStatus: "available",
      },
      {
        messages: [message("oldest", starred.has("oldest"))],
        hasMore: false,
        nextCursor: null,
        remoteHistoryStatus: "available",
      },
    ],
    pageParams: [undefined, "cursor-1"],
  });
  return key;
}

/** The shape the chat thread renders, via the selector the hook installs. */
function renderedMessages(client: QueryClient) {
  const data = client.getQueryData(
    infiniteMessageKeys.list(CONVERSATION_ID),
  ) as Parameters<typeof selectInfiniteMessages>[0];
  return selectInfiniteMessages(data).messages;
}

describe("starring a message", () => {
  test("updates the infinite cache the thread renders", () => {
    const client = new QueryClient();
    setCompanyId(COMPANY_ID);
    const key = seedInfiniteMessages(client);

    setMessageStarredInCaches(client, {
      conversationId: CONVERSATION_ID,
      messageId: "middle",
      isStarred: true,
    });

    // Writing only the legacy `queryKeys.messages.list` cache left the thread
    // rendering the previous star state until an unrelated refetch, because
    // nothing read that cache. Assert through the selector the hook uses.
    expect(
      renderedMessages(client).map((entry) => [entry.id, entry.isStarred]),
    ).toEqual([
      ["oldest", false],
      ["middle", true],
      ["newest", false],
    ]);

    const stored = client.getQueryData<{
      pages: { messages: Message[] }[];
    }>(key);
    // Page 0 is the newest page in the cache; the selector above reverses the
    // flatMap to hand the thread a chronological list.
    const cached = stored?.pages
      .flatMap((page) => page.messages)
      .find((entry) => entry.id === "middle");
    expect(cached?.isStarred).toBe(true);
  });

  test("unstars a message that is already starred", () => {
    const client = new QueryClient();
    setCompanyId(COMPANY_ID);
    seedInfiniteMessages(client, ["middle"]);
    expect(
      renderedMessages(client).map((entry) => entry.isStarred),
    ).toEqual([false, true, false]);

    setMessageStarredInCaches(client, {
      conversationId: CONVERSATION_ID,
      messageId: "middle",
      isStarred: false,
    });

    expect(
      renderedMessages(client).map((entry) => [entry.id, entry.isStarred]),
    ).toEqual([
      ["oldest", false],
      ["middle", false],
      ["newest", false],
    ]);
  });

  test("keeps the legacy list cache in step", () => {
    const client = new QueryClient();
    setCompanyId(COMPANY_ID);
    seedInfiniteMessages(client);
    client.setQueryData(
      queryKeys.messages.list({ conversationId: CONVERSATION_ID }),
      [message("middle")],
    );

    setMessageStarredInCaches(client, {
      conversationId: CONVERSATION_ID,
      messageId: "middle",
      isStarred: true,
    });

    const legacy = client.getQueryData<Message[]>(
      queryKeys.messages.list({ conversationId: CONVERSATION_ID }),
    );
    expect(legacy?.map((entry) => entry.isStarred)).toEqual([true]);
  });

  test("does nothing when the conversation has no cached messages", () => {
    const client = new QueryClient();
    setCompanyId(COMPANY_ID);

    expect(() =>
      setMessageStarredInCaches(client, {
        conversationId: "never-opened",
        messageId: "middle",
        isStarred: true,
      }),
    ).not.toThrow();
  });
});
