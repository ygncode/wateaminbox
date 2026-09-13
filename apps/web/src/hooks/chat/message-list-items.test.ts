import { describe, expect, test } from "bun:test";
import type { Message } from "@wateaminbox/shared";
import { buildMessageListItems } from "./useMessageVirtualization";

const message = (
  id: string,
  createdAt: string,
  channel?: string,
  threadId?: string,
): Message =>
  ({
    id,
    createdAt: new Date(createdAt),
    timestamp: new Date(createdAt),
    channel: channel ?? null,
    threadId: threadId ?? null,
    senderType: "contact",
    messageType: "text",
    content: id,
  }) as unknown as Message;

const types = (messages: Message[]) =>
  buildMessageListItems(messages).map((item) => item.type);

/**
 * The row list interleaves three kinds of thing, and the failure mode is not a
 * wrong answer but a crash: code that reads the row after a separator assumed
 * it was always a message.
 */
describe("buildMessageListItems", () => {
  test("survives a day boundary and a channel change on the same message", () => {
    // The common case, not an edge one: the first message of a day is
    // frequently the one that switched channel. Reading the row straight
    // after the date separator found the channel heading and threw.
    const items = buildMessageListItems([
      message("a", "2026-09-08T10:00:00Z", "whatsapp", "thread-wa"),
      message("b", "2026-09-09T10:00:00Z", "telegram", "thread-tg"),
    ]);
    expect(items.map((item) => item.type)).toEqual([
      "date",
      "channel",
      "message",
      "date",
      "channel",
      "message",
    ]);
    // The separator still announces the day of the message it precedes, not
    // of the heading between them.
    const separators = items.filter((item) => item.type === "date");
    expect(separators).toHaveLength(2);
    expect(separators[1]).toMatchObject({
      date: new Date("2026-09-09T10:00:00Z").toDateString(),
    });
  });

  test("announces a channel once per run, not once per message", () => {
    const items = types([
      message("a", "2026-09-08T10:00:00Z", "whatsapp"),
      message("b", "2026-09-08T10:01:00Z", "whatsapp"),
      message("c", "2026-09-08T10:02:00Z", "telegram"),
    ]);
    expect(items).toEqual([
      "date",
      "channel",
      "message",
      "message",
      "channel",
      "message",
    ]);
  });

  test("stays quiet when the history is all one channel", () => {
    // An ordinary thread must look exactly as it did before.
    expect(
      types([
        message("a", "2026-09-08T10:00:00Z", "whatsapp"),
        message("b", "2026-09-08T10:01:00Z", "whatsapp"),
      ]),
    ).toEqual(["date", "message", "message"]);
  });

  test("stays quiet when messages carry no channel at all", () => {
    expect(
      types([
        message("a", "2026-09-08T10:00:00Z"),
        message("b", "2026-09-08T10:01:00Z"),
      ]),
    ).toEqual(["date", "message", "message"]);
  });

  test("has nothing to draw for an empty history", () => {
    expect(buildMessageListItems([])).toEqual([]);
  });
});
