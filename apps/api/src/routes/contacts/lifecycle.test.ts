import { describe, expect, test } from "bun:test";
import { partitionByUnread, threadKey } from "./lifecycle.js";
import type { CustomerThread } from "../../services/customer-timeline.service.js";

const conversation = (id: string, contactId?: string): CustomerThread => ({
  conversationId: id,
  contactId: contactId ?? null,
});
const legacy = (contactId: string): CustomerThread => ({
  conversationId: null,
  contactId,
});

/**
 * Resolving a merged customer closes every thread at once, so the rule that
 * decides which threads are exempt is the whole safety of the action.
 */
describe("partitionByUnread", () => {
  test("resolves the quiet threads", () => {
    // Safe because a later inbound reopens a resolved case automatically.
    const { resolvable, skipped } = partitionByUnread(
      [conversation("thread-a"), conversation("thread-b")],
      new Map([
        ["thread-a", 0],
        ["thread-b", 0],
      ]),
    );
    expect(resolvable.map(threadKey)).toEqual(["thread-a", "thread-b"]);
    expect(skipped).toEqual([]);
  });

  test("leaves a thread holding unread inbound open, and names it", () => {
    // Nothing will arrive to reopen it, so resolving buries a question the
    // operator never read.
    const { resolvable, skipped } = partitionByUnread(
      [conversation("thread-a"), conversation("thread-b")],
      new Map([
        ["thread-a", 0],
        ["thread-b", 3],
      ]),
    );
    expect(resolvable.map(threadKey)).toEqual(["thread-a"]);
    expect(skipped).toEqual([{ threadId: "thread-b", unreadCount: 3 }]);
  });

  test("treats an unknown count as quiet rather than refusing", () => {
    // A thread with no workflow row has never been written to; refusing it
    // would leave a customer permanently unresolvable.
    const { resolvable } = partitionByUnread(
      [conversation("thread-a")],
      new Map(),
    );
    expect(resolvable.map(threadKey)).toEqual(["thread-a"]);
  });

  test("addresses a thread that predates the spine by its contact", () => {
    const { resolvable } = partitionByUnread(
      [legacy("contact-1")],
      new Map([["contact-1", 0]]),
    );
    expect(resolvable.map(threadKey)).toEqual(["contact-1"]);
  });

  test("prefers the conversation when a thread has both ids", () => {
    // The chat route addresses a bridged thread by its conversation, and the
    // skip list has to name threads the client can match.
    expect(threadKey(conversation("thread-a", "contact-1"))).toBe("thread-a");
  });
});
