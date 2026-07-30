import { describe, expect, test } from "bun:test";
import type { QuickReply } from "@/lib/api/types";
import {
  filterQuickReplies,
  getActiveQuickReplyToken,
  insertQuickReply,
} from "./quick-reply-matching";

function quickReply(
  shortcut: string,
  title: string,
  content: string,
): QuickReply {
  return {
    id: shortcut,
    shortcut,
    title,
    content,
    createdBy: "user-1",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

describe("quick reply token detection", () => {
  test("activates after a slash at the beginning or after whitespace", () => {
    expect(getActiveQuickReplyToken("/gre", 4)).toEqual({
      start: 0,
      end: 4,
      query: "gre",
    });
    expect(getActiveQuickReplyToken("Hello /tha", 10)).toEqual({
      start: 6,
      end: 10,
      query: "tha",
    });
  });

  test("does not activate inside URLs or ordinary words", () => {
    expect(getActiveQuickReplyToken("https://example.com", 19)).toBeNull();
    expect(getActiveQuickReplyToken("word/shortcut", 13)).toBeNull();
  });

  test("includes the rest of a shortcut when the caret is in its middle", () => {
    expect(getActiveQuickReplyToken("/greeting later", 4)).toEqual({
      start: 0,
      end: 9,
      query: "greeting",
    });
  });
});

describe("quick reply suggestions", () => {
  const replies = [
    quickReply("thanks", "Thank you", "Thanks for reaching out."),
    quickReply("greeting", "Thoughtful welcome", "Hello! How can I help?"),
    quickReply("hours", "Opening hours", "We are open from 9 to 5."),
  ];

  test("prioritizes shortcuts before title and content matches", () => {
    expect(
      filterQuickReplies(replies, "th").map(({ shortcut }) => shortcut),
    ).toEqual(["thanks", "greeting"]);
  });

  test("returns an alphabetized, limited library for a bare slash", () => {
    expect(
      filterQuickReplies(replies, "", 2).map(({ shortcut }) => shortcut),
    ).toEqual(["greeting", "hours"]);
  });
});

describe("quick reply insertion", () => {
  test("replaces only the active shortcut and preserves surrounding text", () => {
    const reply = quickReply("thanks", "Thank you", "Thanks for reaching out.");
    const result = insertQuickReply(
      "Hello /thanks — talk soon",
      { start: 6, end: 13, query: "thanks" },
      reply,
    );

    expect(result).toEqual({
      message: "Hello Thanks for reaching out. — talk soon",
      cursor: 30,
    });
  });
});
