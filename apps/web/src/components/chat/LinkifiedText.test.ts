import { describe, expect, test } from "bun:test";
import { parseMessageLinks } from "./LinkifiedText";

describe("message linkification", () => {
  test("is used for text messages and media captions", async () => {
    const messageContent = await Bun.file(
      new URL("./MessageContent.tsx", import.meta.url),
    ).text();
    expect(messageContent).toContain(
      "<LinkifiedText text={message.content} isOwn={isOwn}",
    );
    expect(messageContent).toContain("text={mediaCaption}");
  });

  test("linkifies full, www, and bare-domain URLs", () => {
    const segments = parseMessageLinks(
      "See https://example.com/a, www.example.org and docs.example.net/path",
    );
    expect(segments.filter((segment) => segment.type === "link")).toEqual([
      {
        type: "link",
        value: "https://example.com/a",
        href: "https://example.com/a",
      },
      {
        type: "link",
        value: "www.example.org",
        href: "https://www.example.org/",
      },
      {
        type: "link",
        value: "docs.example.net/path",
        href: "https://docs.example.net/path",
      },
    ]);
  });

  test("keeps sentence punctuation outside the clickable URL", () => {
    const segments = parseMessageLinks("Open (https://example.com/test). Now");
    expect(segments).toContainEqual({
      type: "link",
      value: "https://example.com/test",
      href: "https://example.com/test",
    });
    expect(segments).toContainEqual({ type: "text", value: ")." });
  });

  test("linkifies email addresses without allowing script protocols", () => {
    expect(parseMessageLinks("Email team@example.com")).toContainEqual({
      type: "link",
      value: "team@example.com",
      href: "mailto:team@example.com",
    });
    expect(
      parseMessageLinks("javascript:alert(1)").some(
        (segment) => segment.type === "link",
      ),
    ).toBe(false);
  });
});
