import { describe, expect, test } from "bun:test";
import { parseMessageLinks, resolveMentionNames } from "./LinkifiedText";

describe("message linkification", () => {
  test("is used for text messages and media captions", async () => {
    const messageContent = await Bun.file(
      new URL("./MessageContent.tsx", import.meta.url),
    ).text();
    expect(messageContent).toContain("text={message.content}");
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

  test("does not treat an @ inside a URL as an email address", () => {
    const tiktokUrl =
      "https://www.tiktok.com/@thesgdaily/video/7666820732684438805";
    expect(parseMessageLinks(tiktokUrl)).toEqual([
      {
        type: "link",
        value: tiktokUrl,
        href: tiktokUrl,
      },
    ]);
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

describe("WhatsApp mention display names", () => {
  const participants = [
    {
      jid: "98797300309@s.whatsapp.net",
      phoneNumber: "98797300309",
      displayName: "Kelvin Cheng",
    },
  ];

  test("replaces a raw phone mention with the participant name", () => {
    expect(
      resolveMentionNames("@98797300309 https://wall-pets.com/", participants),
    ).toBe("@Kelvin Cheng https://wall-pets.com/");
  });

  test("keeps an unknown mention unchanged", () => {
    expect(resolveMentionNames("@123456789 hello", participants)).toBe(
      "@123456789 hello",
    );
  });
});
