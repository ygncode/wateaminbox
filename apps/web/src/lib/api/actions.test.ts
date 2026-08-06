import { afterEach, describe, expect, test } from "bun:test";
import { broadcastMessagesRead } from "./actions";

/**
 * Stubs `globalThis.fetch` rather than mocking the `./client` module: Bun's
 * `mock.module` is process-global, so replacing `fetchWithAuth` here would
 * replace it for every other test file in the run too.
 */
const originalFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    captured.push({
      url: request.url,
      method: request.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * `broadcastMessagesRead` has no UI caller yet - the inbox marks whole
 * conversations read via `markConversationAsRead`, which persists state, while
 * this one is the ephemeral per-message receipt. It is covered here so the
 * request contract cannot rot unnoticed while it waits for a caller; the
 * server side is covered by routes/actions/read.integration.test.ts.
 */
describe("broadcastMessagesRead", () => {
  test("posts the conversation and message IDs to the ephemeral route", async () => {
    const captured = captureRequests();

    await broadcastMessagesRead("contact-uuid", ["m1", "m2"]);

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toContain("/actions/messages/read");
    expect(captured[0].method).toBe("POST");
    expect(captured[0].body).toEqual({
      conversationId: "contact-uuid",
      messageIds: ["m1", "m2"],
    });
  });

  test("omits messageIds entirely when none are given", async () => {
    const captured = captureRequests();

    await broadcastMessagesRead("contact-uuid");

    expect(captured[0].body).toEqual({ conversationId: "contact-uuid" });
  });

  test("does not target the persisting conversation route", async () => {
    // The two read paths are deliberately separate; this one must never be
    // mistaken for the one that zeroes the unread count.
    const captured = captureRequests();

    await broadcastMessagesRead("contact-uuid");

    expect(captured[0].url).not.toContain("/conversations/");
  });
});
