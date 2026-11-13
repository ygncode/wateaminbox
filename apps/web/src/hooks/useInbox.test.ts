import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { clearAuthTokens, setAuthToken, setCompanyId } from "../lib/api/client";
import type { ContactApiResponse } from "../lib/api/transformers";
import {
  buildInboxQueryParams,
  inboxHeadQueryOptions,
  inboxItemToChat,
  inboxQueryOptions,
  selectInboxChats,
} from "./useInbox";

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

function thread(id: string) {
  return {
    id,
    channelAccountId: "tg-account",
    channel: "telegram" as const,
    provider: "telegram_bot" as const,
    kind: "direct" as const,
    subject: `TG ${id}`,
    externalThreadId: null,
    firstMessageAt: "2026-01-01T00:00:00Z",
    lastMessageAt: "2026-01-01T00:00:00Z",
    lastMessagePreview: "hi",
    unreadCount: 2,
    conversationStatus: "open" as const,
    legacyContactId: null,
    assignedTo: "user-1",
    account: { displayName: "Bot", username: "bot", status: "connected" },
    counterpart: null,
  };
}

/** A fake GET /api/inbox over ids "0".."n-1", paged by an index cursor. */
function serveInbox(total: number) {
  fetchSpy.mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const limit = Number(url.searchParams.get("limit"));
        const after = url.searchParams.get("cursor");
        const before = url.searchParams.get("before");
        const start = after
          ? Number(after) + 1
          : before
            ? Math.max(0, Number(before) - limit)
            : 0;
        const end = before ? Number(before) : Math.min(total, start + limit);
        const ids = Array.from({ length: end - start }, (_, i) => start + i);
        return Response.json({
          data: ids.map((id) => ({
            type: "contact",
            contact: contact(String(id)),
          })),
          nextCursor: end < total ? String(end - 1) : null,
          prevCursor: start > 0 ? String(start) : null,
          unreadTotal: after || before ? null : 42,
        });
      },
      { preconnect: () => {} },
    ),
  );
}

function requestUrl(index: number) {
  return new URL(String(fetchSpy.mock.calls[index][0]));
}

describe("unified inbox query", () => {
  test("sends every filter to GET /inbox and defaults to the open inbox", () => {
    expect(buildInboxQueryParams({}, {})).toEqual({
      limit: 100,
      conversationStatus: "open",
    });
    expect(
      buildInboxQueryParams(
        {
          search: "  maya ",
          includeGroups: false,
          accountId: "acct",
          tagIds: ["t1", "t2"],
          assignmentFilter: "unread",
          conversationStatus: "all",
        },
        { cursor: "c1" },
      ),
    ).toEqual({
      limit: 100,
      cursor: "c1",
      search: "maya",
      includeGroups: "false",
      accountId: "acct",
      tagIds: "t1,t2",
      filter: "unread",
      conversationStatus: "all",
    });
    expect(buildInboxQueryParams({}, { before: "b1" })).toMatchObject({
      before: "b1",
    });
  });

  test("maps customer rows and channel threads into one chat shape", () => {
    const customer = inboxItemToChat({
      type: "contact",
      contact: contact("wa"),
    });
    expect(customer.contact.jid).toBe("wa@s.whatsapp.net");
    const tg = inboxItemToChat({
      type: "conversation",
      conversation: thread("t"),
    });
    expect(tg.id).toBe("t");
    expect(tg.contact.conversationId).toBe("t");
    expect(tg.accountIds).toEqual(["tg-account"]);
    expect(tg.assignedTo).toBe("user-1");
    expect(tg.unreadCount).toBe(2);
  });

  test("pages down by cursor, bounds the window, and pages back up", async () => {
    serveInbox(1000);
    const options = inboxQueryOptions({});
    const observer = new InfiniteQueryObserver(client, {
      ...options,
      select: selectInboxChats,
    });
    await observer.refetch();
    for (let i = 0; i < 6; i++) await observer.fetchNextPage();
    // Five pages are kept; the oldest were dropped from the top.
    const loaded = observer.getCurrentResult().data ?? [];
    expect(loaded).toHaveLength(500);
    expect(loaded[0].id).toBe("200");
    expect(requestUrl(1).searchParams.get("cursor")).toBe("99");
    expect(observer.getCurrentResult().hasPreviousPage).toBe(true);

    await observer.fetchPreviousPage();
    expect(observer.getCurrentResult().data?.[0].id).toBe("100");
    const last = requestUrl(fetchSpy.mock.calls.length - 1);
    expect(last.searchParams.get("before")).toBe("200");
    expect(last.searchParams.get("cursor")).toBeNull();
    await observer.fetchPreviousPage();
    expect(observer.getCurrentResult().hasPreviousPage).toBe(false);
  });

  test("the navigation badge reads the server's unread total from its own head page", async () => {
    serveInbox(1000);
    const head = new InfiniteQueryObserver(client, {
      ...inboxHeadQueryOptions(),
      select: (pages) => pages.pages[0]?.unreadTotal ?? 0,
    });
    const sidebar = new InfiniteQueryObserver(client, inboxQueryOptions({}));
    await head.refetch();
    await sidebar.refetch();
    for (let i = 0; i < 6; i++) await sidebar.fetchNextPage();
    expect(head.getCurrentResult().data).toBe(42);
    expect(inboxHeadQueryOptions().queryKey).not.toEqual(
      inboxQueryOptions({}).queryKey,
    );
  });

  test("separate filters and workspaces never share a cache entry", () => {
    expect(inboxQueryOptions({ search: "a" }).queryKey).not.toEqual(
      inboxQueryOptions({ search: "b" }).queryKey,
    );
    expect(inboxQueryOptions({ accountId: "x" }).queryKey).not.toEqual(
      inboxQueryOptions({}).queryKey,
    );
  });

  test("deduplicates a row that moved between pages after new activity", () => {
    const chats = selectInboxChats({
      pages: [
        {
          chats: [inboxItemToChat({ type: "contact", contact: contact("a") })],
          nextCursor: "x",
          prevCursor: null,
          unreadTotal: 0,
        },
        {
          chats: [
            inboxItemToChat({ type: "contact", contact: contact("a") }),
            inboxItemToChat({ type: "contact", contact: contact("b") }),
          ],
          nextCursor: null,
          prevCursor: "x",
          unreadTotal: null,
        },
      ],
      pageParams: [{}, { cursor: "x" }],
    });
    expect(chats.map((chat) => chat.id)).toEqual(["a", "b"]);
  });
});
