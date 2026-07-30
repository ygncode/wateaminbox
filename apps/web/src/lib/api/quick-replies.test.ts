import { afterEach, describe, expect, test } from "bun:test";
import { deleteQuickReply, getQuickReplyLibrary } from "./quick-replies";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("quick replies API contracts", () => {
  test("loads every paginated quick reply for composer suggestions", async () => {
    const requestedUrls: string[] = [];
    const replies = [
      {
        id: "1",
        shortcut: "greeting",
        title: "Greeting",
        content: "Hello",
        createdBy: "user-1",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
      {
        id: "2",
        shortcut: "thanks",
        title: "Thanks",
        content: "Thank you",
        createdBy: "user-1",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
    ];

    globalThis.fetch = (async (input) => {
      requestedUrls.push(String(input));
      const isFirstPage = requestedUrls.length === 1;
      return Response.json({
        data: isFirstPage ? [replies[0]] : [replies[1]],
        pagination: {
          total: 2,
          limit: 100,
          offset: isFirstPage ? 0 : 100,
          hasMore: isFirstPage,
        },
      });
    }) as typeof fetch;

    await expect(getQuickReplyLibrary()).resolves.toEqual(replies);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain("limit=100");
    expect(requestedUrls[0]).toContain("offset=0");
    expect(requestedUrls[1]).toContain("offset=100");
  });

  test("accepts the API's message-only delete response", async () => {
    let requestMethod: string | undefined;

    globalThis.fetch = (async (_input, init) => {
      requestMethod = init?.method;
      return Response.json({ message: "Quick reply deleted successfully" });
    }) as typeof fetch;

    await expect(deleteQuickReply("reply-1")).resolves.toBeUndefined();
    expect(requestMethod).toBe("DELETE");
  });
});
