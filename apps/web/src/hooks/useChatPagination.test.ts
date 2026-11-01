import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { clearAuthTokens, setAuthToken, setCompanyId } from "../lib/api/client";
import type { ContactApiResponse } from "../lib/api/transformers";
import { channelConversationListOptions } from "./useChannelConversations";
import {
  chatKeys,
  chatListQueryOptions,
  inboxHeadQueryOptions,
} from "./useChats";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  setAuthToken("test-token");
  setCompanyId("workspace-a");
  fetchSpy = spyOn(globalThis, "fetch");
});

afterEach(() => {
  client.clear();
  fetchSpy.mockRestore();
  clearAuthTokens();
});

function contact(id: string, unreadCount = 0): ContactApiResponse {
  return {
    id,
    jid: `${id}@s.whatsapp.net`,
    phoneNumber: id,
    pushName: id,
    customName: null,
    displayName: id,
    isGroup: false,
    profilePictureUrl: null,
    notesShared: null,
    lastMessageAt: "2026-01-01T00:00:00Z",
    lastMessage: null,
    unreadCount,
    assignedTo: null,
    isOnline: false,
    lastSeen: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    connection: null,
    conversationStatus: "open",
    activeCaseId: null,
  };
}

function contactsResponse(
  data: ContactApiResponse[],
  offset: number,
  total: number,
) {
  return Response.json({
    data,
    pagination: {
      offset,
      limit: 100,
      total,
      hasMore: offset + data.length < total,
    },
  });
}

function requestUrl(index: number) {
  return new URL(String(fetchSpy.mock.calls[index][0]));
}

describe("infinite chat pages", () => {
  test("loads beyond 100, carries filters, and stops at the final page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => contact(String(i)));
    fetchSpy
      .mockResolvedValueOnce(contactsResponse(firstPage, 0, 102))
      .mockResolvedValueOnce(
        contactsResponse([contact("100"), contact("101")], 100, 102),
      );
    const observer = new InfiniteQueryObserver(
      client,
      chatListQueryOptions(
        "coffee",
        true,
        "assignedToMe",
        "account-a",
        "pending",
        ["tag-a"],
      ),
    );

    const first = await observer.fetchNextPage();
    expect(first.data).toHaveLength(100);
    expect(first.hasNextPage).toBe(true);
    const second = await observer.fetchNextPage();
    expect(second.data).toHaveLength(102);
    expect(second.data?.[100].id).toBe("100");
    expect(second.hasNextPage).toBe(false);
    await observer.fetchNextPage();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [index, offset] of ["0", "100"].entries()) {
      expect(Object.fromEntries(requestUrl(index).searchParams)).toEqual({
        limit: "100",
        offset,
        search: "coffee",
        includeGroups: "true",
        assignedToMe: "true",
        connectionId: "account-a",
        conversationStatus: "pending",
        tagIds: "tag-a",
      });
    }
  });

  test("asks the server for unread chats before pagination instead of scanning read pages", async () => {
    fetchSpy.mockResolvedValueOnce(
      contactsResponse([contact("old-unread", 2)], 0, 1),
    );
    const observer = new InfiniteQueryObserver(
      client,
      chatListQueryOptions("", true, "unread"),
    );
    const result = await observer.fetchNextPage();
    expect(result.data?.map((chat) => chat.id)).toEqual(["old-unread"]);
    expect(result.hasNextPage).toBe(false);
    expect(requestUrl(0).searchParams.get("unreadOnly")).toBe("true");
    await observer.fetchNextPage();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("bounds the cache and refetch to five pages, and reloads newer pages on demand", async () => {
    fetchSpy.mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const offset = Number(
            new URL(String(input)).searchParams.get("offset"),
          );
          return contactsResponse(
            Array.from({ length: 100 }, (_, i) => contact(String(offset + i))),
            offset,
            1000,
          );
        },
        { preconnect: () => {} },
      ),
    );
    const options = chatListQueryOptions();
    const observer = new InfiniteQueryObserver(client, options);
    for (let i = 0; i < 7; i++) await observer.fetchNextPage();
    expect(observer.getCurrentResult().data).toHaveLength(500);
    expect(client.getQueryData(options.queryKey)?.pageParams).toEqual([
      200, 300, 400, 500, 600,
    ]);
    expect(observer.getCurrentResult().hasPreviousPage).toBe(true);
    const beforeRefresh = fetchSpy.mock.calls.length;
    await observer.refetch();
    expect(fetchSpy.mock.calls.length - beforeRefresh).toBe(5);
    expect(observer.getCurrentResult().data?.[0].id).toBe("200");
    const previous = await observer.fetchPreviousPage();
    expect(previous.data).toHaveLength(500);
    expect(previous.data?.[0].id).toBe("100");
    expect(client.getQueryData(options.queryKey)?.pageParams).toEqual([
      100, 200, 300, 400, 500,
    ]);
    await observer.fetchPreviousPage();
    expect(observer.getCurrentResult().hasPreviousPage).toBe(false);
    const beforeBoundary = fetchSpy.mock.calls.length;
    await observer.fetchPreviousPage();
    expect(fetchSpy.mock.calls.length).toBe(beforeBoundary);
  });

  test("the navigation badge retains its own head page when the sidebar moves", async () => {
    fetchSpy.mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const offset = Number(
            new URL(String(input)).searchParams.get("offset"),
          );
          return contactsResponse(
            Array.from({ length: 100 }, (_, i) => contact(String(offset + i))),
            offset,
            1000,
          );
        },
        { preconnect: () => {} },
      ),
    );
    const head = new InfiniteQueryObserver(client, inboxHeadQueryOptions());
    const window = new InfiniteQueryObserver(client, chatListQueryOptions());
    await head.fetchNextPage();
    for (let i = 0; i < 7; i++) await window.fetchNextPage();
    expect(head.getCurrentResult().data?.[0].id).toBe("0");
    expect(head.getCurrentResult().data).toHaveLength(100);
    expect(window.getCurrentResult().data?.[0].id).toBe("200");
  });

  test("deduplicates overlapping pages after a realtime reorder", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        contactsResponse([contact("a"), contact("b")], 0, 4),
      )
      .mockResolvedValueOnce(
        contactsResponse([contact("b"), contact("c")], 2, 4),
      );
    const observer = new InfiniteQueryObserver(client, chatListQueryOptions());
    await observer.fetchNextPage();
    const result = await observer.fetchNextPage();
    expect(result.data?.map((chat) => chat.id)).toEqual(["a", "b", "c"]);
  });

  test("keeps loaded chats on a page error and retries the same offset", async () => {
    fetchSpy
      .mockResolvedValueOnce(contactsResponse([contact("a")], 0, 2))
      .mockResolvedValueOnce(
        Response.json({ error: "temporarily unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(contactsResponse([contact("b")], 1, 2));
    const observer = new InfiniteQueryObserver(client, chatListQueryOptions());
    await observer.fetchNextPage();
    const failed = await observer.fetchNextPage();
    expect(failed.isFetchNextPageError).toBe(true);
    expect(failed.data?.map((chat) => chat.id)).toEqual(["a"]);
    const retried = await observer.fetchNextPage();
    expect(retried.isError).toBe(false);
    expect(retried.data?.map((chat) => chat.id)).toEqual(["a", "b"]);
    expect(requestUrl(1).searchParams.get("offset")).toBe("1");
    expect(requestUrl(2).searchParams.get("offset")).toBe("1");
  });

  test("fresh filters and workspaces start at offset zero without cache collisions", async () => {
    fetchSpy
      .mockResolvedValueOnce(contactsResponse([contact("a")], 0, 10))
      .mockResolvedValueOnce(contactsResponse([contact("a")], 0, 10))
      .mockResolvedValueOnce(contactsResponse([contact("a")], 0, 10));
    const firstOptions = chatListQueryOptions("one");
    const observer = new InfiniteQueryObserver(client, firstOptions);
    await observer.fetchNextPage();
    const filteredOptions = chatListQueryOptions(
      "two",
      false,
      "unassigned",
      "account-b",
      "resolved",
      ["tag-b"],
    );
    observer.setOptions(filteredOptions);
    await observer.fetchNextPage();
    setCompanyId("workspace-b");
    const otherWorkspace = chatListQueryOptions(
      "two",
      false,
      "unassigned",
      "account-b",
      "resolved",
      ["tag-b"],
    );
    observer.setOptions(otherWorkspace);
    await observer.fetchNextPage();
    expect(firstOptions.queryKey).not.toEqual(filteredOptions.queryKey);
    expect(filteredOptions.queryKey).not.toEqual(otherWorkspace.queryKey);
    expect(firstOptions.queryKey).not.toEqual(chatKeys.list({ search: "one" }));
    expect(
      [0, 1, 2].map((index) => requestUrl(index).searchParams.get("offset")),
    ).toEqual(["0", "0", "0"]);
  });

  test("refetches all loaded pages after invalidation", async () => {
    fetchSpy
      .mockResolvedValueOnce(contactsResponse([contact("a")], 0, 2))
      .mockResolvedValueOnce(contactsResponse([contact("b")], 1, 2))
      .mockResolvedValueOnce(contactsResponse([contact("b", 1)], 0, 2))
      .mockResolvedValueOnce(contactsResponse([contact("a")], 1, 2));
    const observer = new InfiniteQueryObserver(client, chatListQueryOptions());
    await observer.fetchNextPage();
    await observer.fetchNextPage();
    const unsubscribe = observer.subscribe(() => {});
    await client.invalidateQueries({ queryKey: chatKeys.lists() });
    expect(observer.getCurrentResult().data?.map((chat) => chat.id)).toEqual([
      "b",
      "a",
    ]);
    expect(observer.getCurrentResult().data?.[0].unreadCount).toBe(1);
    unsubscribe();
  });

  test("stops on an empty page even if stale server metadata says more", async () => {
    fetchSpy.mockResolvedValueOnce(contactsResponse([], 0, 10));
    const observer = new InfiniteQueryObserver(client, chatListQueryOptions());
    expect((await observer.fetchNextPage()).hasNextPage).toBe(false);
  });

  test("concurrent footer notifications do not duplicate a page request", async () => {
    fetchSpy
      .mockResolvedValueOnce(contactsResponse([contact("a")], 0, 2))
      .mockResolvedValueOnce(contactsResponse([contact("b")], 1, 2));
    const observer = new InfiniteQueryObserver(client, chatListQueryOptions());
    await observer.fetchNextPage();
    await Promise.all([
      observer.fetchNextPage({ cancelRefetch: false }),
      observer.fetchNextPage({ cancelRefetch: false }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("infinite channel conversations", () => {
  test("channel windows also evict and reload pages in both directions", async () => {
    fetchSpy.mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const url = new URL(String(input));
          const offset = Number(url.searchParams.get("offset"));
          return Response.json({
            data: [{ id: String(offset) }, { id: String(offset + 1) }],
          });
        },
        { preconnect: () => {} },
      ),
    );
    const options = channelConversationListOptions(2, [], {
      assignmentFilter: "unread",
    });
    const observer = new InfiniteQueryObserver(client, options);
    for (let i = 0; i < 6; i++) await observer.fetchNextPage();
    expect(observer.getCurrentResult().data).toHaveLength(10);
    expect(requestUrl(0).searchParams.get("unreadOnly")).toBe("true");
    expect(client.getQueryData(options.queryKey)?.pageParams).toEqual([
      2, 4, 6, 8, 10,
    ]);
    fetchSpy.mockResolvedValueOnce(
      Response.json({ error: "unavailable" }, { status: 503 }),
    );
    const failure = await observer.fetchPreviousPage();
    expect(failure.isFetchPreviousPageError).toBe(true);
    expect(failure.data).toHaveLength(10);
    const previous = await observer.fetchPreviousPage();
    expect(previous.isError).toBe(false);
    expect(previous.data?.[0].id).toBe("0");
    expect(previous.hasPreviousPage).toBe(false);
    expect(client.getQueryData(options.queryKey)?.pageParams).toEqual([
      0, 2, 4, 6, 8,
    ]);
  });

  test("sends offsets and tags, deduplicates pages, and stops on a short page", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "a" }, { id: "b" }] }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "b" }, { id: "c" }] }),
      )
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const observer = new InfiniteQueryObserver(
      client,
      channelConversationListOptions(2, ["tag-a"]),
    );
    await observer.fetchNextPage();
    expect((await observer.fetchNextPage()).data?.map((row) => row.id)).toEqual(
      ["a", "b", "c"],
    );
    const last = await observer.fetchNextPage();
    expect(last.hasNextPage).toBe(false);
    expect(
      [0, 1, 2].map((index) => requestUrl(index).searchParams.get("offset")),
    ).toEqual(["0", "2", "4"]);
    expect(requestUrl(1).searchParams.get("tagIds")).toBe("tag-a");
  });

  test("disabled neutral reads (404) finish without retrying", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({ error: "disabled" }, { status: 404 }),
    );
    const observer = new InfiniteQueryObserver(
      client,
      channelConversationListOptions(),
    );
    const result = await observer.fetchNextPage();
    expect(result.data).toEqual([]);
    expect(result.hasNextPage).toBe(false);
    expect(result.isError).toBe(false);
  });

  test("client-side filters and workspace switches isolate pagination", () => {
    const original = channelConversationListOptions(100, [], {
      accountFilter: "all",
    });
    const filtered = channelConversationListOptions(100, [], {
      accountFilter: "telegram",
    });
    setCompanyId("workspace-b");
    const otherWorkspace = channelConversationListOptions(100, [], {
      accountFilter: "all",
    });
    expect(original.queryKey).not.toEqual(filtered.queryKey);
    expect(original.queryKey).not.toEqual(otherWorkspace.queryKey);
  });
});
