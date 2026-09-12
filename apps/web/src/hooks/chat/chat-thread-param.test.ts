import { describe, expect, test } from "bun:test";
import { activeThread, threadSearch, withoutThread } from "./chat-thread-param";

describe("chat thread parameter", () => {
  test("switching to another thread keeps the reader on the same row", () => {
    // The row stays in the path; only the parameter changes. Navigating to the
    // thread instead would land on a merged-away contact, which the inbox no
    // longer lists at all.
    expect(threadSearch("?view=chats", "thread-2", "row-1")).toBe(
      "?view=chats&thread=thread-2",
    );
  });

  test("selecting the row's own thread clears the parameter", () => {
    // Otherwise the same view has two spellings and back/forward steps
    // through both.
    expect(threadSearch("?view=chats&thread=thread-2", "row-1", "row-1")).toBe(
      "?view=chats",
    );
  });

  test("replaces rather than appends when switching again", () => {
    expect(threadSearch("?thread=thread-2", "thread-3", "row-1")).toBe(
      "?thread=thread-3",
    );
  });

  test("preserves the Chats/Groups filter across a switch", () => {
    expect(withoutThread("?view=groups&thread=thread-2")).toBe("?view=groups");
  });

  test("leaving for another chat drops the thread", () => {
    // Carrying it across would open the previous customer's thread under the
    // newly selected one.
    expect(withoutThread("?thread=thread-2")).toBe("");
  });

  test("reads the active thread, and treats its absence as the row's own", () => {
    expect(activeThread("?view=chats&thread=thread-2")).toBe("thread-2");
    expect(activeThread("?view=chats")).toBeUndefined();
    expect(activeThread("")).toBeUndefined();
  });
});
