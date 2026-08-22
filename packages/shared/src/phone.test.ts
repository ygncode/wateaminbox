import { describe, expect, test } from "bun:test";
import {
  formatPhoneLikeText,
  formatPhoneNumber,
  formatPhoneNumberWithGroups,
} from "./phone";

describe("shared phone display", () => {
  test("adds one plus prefix for WhatsApp phone identities of any length", () => {
    expect(formatPhoneNumber("6584042683")).toBe("+6584042683");
    expect(formatPhoneNumber("+66994862943")).toBe("+66994862943");
    expect(formatPhoneNumberWithGroups("6584042683")).toStartWith("+");
  });

  test("formats numeric fallbacks and individual JIDs", () => {
    expect(formatPhoneLikeText("447723442982")).toBe("+447723442982");
    expect(formatPhoneLikeText("841665247989@s.whatsapp.net")).toBe(
      "+841665247989",
    );
  });

  test("preserves names and group JIDs and hides opaque LIDs", () => {
    expect(formatPhoneLikeText("Mai")).toBe("Mai");
    expect(formatPhoneLikeText("120363380084647857@g.us")).toBe(
      "120363380084647857@g.us",
    );
    expect(formatPhoneLikeText("123456789012345@lid")).toBe(
      "WhatsApp user (ID …2345)",
    );
    expect(formatPhoneLikeText("99112233@hosted.lid")).toBe(
      "WhatsApp user (ID …2233)",
    );
  });
});
