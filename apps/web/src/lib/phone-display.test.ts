import { describe, expect, test } from "bun:test";
import { formatPhoneLikeText, formatPhoneNumber } from "./utils";

describe("phone number display", () => {
  test("adds the international prefix to an unformatted number", () => {
    expect(formatPhoneNumber("66994862943")).toBe("+66994862943");
  });

  test("keeps a single prefix when one already exists", () => {
    expect(formatPhoneNumber("+841665247989")).toBe("+841665247989");
  });

  test("formats numeric contact-name fallbacks", () => {
    expect(formatPhoneLikeText("447723442982")).toBe("+447723442982");
  });

  test("formats individual WhatsApp JIDs but not group IDs", () => {
    expect(formatPhoneLikeText("6584042683@s.whatsapp.net")).toBe(
      "+6584042683",
    );
    expect(formatPhoneLikeText("120363380084647857@g.us")).toBe(
      "120363380084647857@g.us",
    );
  });

  test("does not modify real contact or connection names", () => {
    expect(formatPhoneLikeText("Set Kyar Wa Lar")).toBe("Set Kyar Wa Lar");
  });
});
