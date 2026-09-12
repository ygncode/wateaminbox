import { afterEach, describe, expect, test } from "bun:test";
import {
  type CustomerTimelinePage,
  flattenTimelinePages,
  getCustomerTimeline,
  type TimelineMessage,
} from "./customer-timeline";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const message = (id: string, channel: string): TimelineMessage =>
  ({
    id,
    channel,
    threadId: `thread-${channel}`,
  }) as unknown as TimelineMessage;

const page = (
  messages: TimelineMessage[],
  overrides: Partial<CustomerTimelinePage> = {},
): CustomerTimelinePage => ({
  messages,
  canonicalContactId: "customer-1",
  hasMore: false,
  nextCursor: null,
  remoteHistory: { status: "unknown", contactId: null },
  ...overrides,
});

describe("customer timeline", () => {
  test("reads the page from the unwrapped envelope", async () => {
    // `handleResponse` already unwraps `{ data }`. Reading it again yields
    // undefined, and an empty history is indistinguishable from a customer
    // who has never written - which is exactly how the chat switcher and the
    // merge history both silently disappeared.
    globalThis.fetch = (async (_input) =>
      Response.json({
        data: page([message("message-1", "telegram")], { hasMore: true }),
      })) as typeof fetch;

    const result = await getCustomerTimeline("chat-1");
    expect(result.messages.map((entry) => entry.id)).toEqual(["message-1"]);
    expect(result.hasMore).toBe(true);
  });

  test("asks for one channel when the switcher is filtering", async () => {
    let requested = "";
    globalThis.fetch = (async (input) => {
      requested = String(input);
      return Response.json({ data: page([]) });
    }) as typeof fetch;

    await getCustomerTimeline("chat-1", { channel: "telegram", limit: 25 });
    expect(requested).toContain("channel=telegram");
    expect(requested).toContain("limit=25");
  });

  test("reads oldest first across pages, not just within them", () => {
    // Pages walk backwards in time while each page reads forwards. Flattening
    // without reversing the page order interleaves the history wrongly - and
    // it looks like a merge-sort bug rather than a client one.
    const newest = page([message("c", "telegram"), message("d", "whatsapp")]);
    const older = page([message("a", "whatsapp"), message("b", "telegram")]);
    expect(
      flattenTimelinePages([newest, older]).map((entry) => entry.id),
    ).toEqual(["a", "b", "c", "d"]);
  });

  test("has nothing to show before the first page arrives", () => {
    expect(flattenTimelinePages([])).toEqual([]);
  });
});
