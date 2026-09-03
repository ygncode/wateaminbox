import { describe, expect, test } from "bun:test";
import { shouldShowMentionPhoneNumber } from "./GroupMentionPicker";

describe("mention picker secondary phone number", () => {
  test("keeps saved-name rows visually quiet", () => {
    expect(
      shouldShowMentionPhoneNumber({
        displayName: "Dan Tang",
        phoneNumber: "6598207272",
      }),
    ).toBe(false);
  });

  test("shows the number for an unsaved WhatsApp push name", () => {
    expect(
      shouldShowMentionPhoneNumber({
        displayName: "~ -K",
        phoneNumber: "84326167233",
      }),
    ).toBe(true);
  });

  test("shows the number when it is also used as the display name", () => {
    expect(
      shouldShowMentionPhoneNumber({
        displayName: "+65 9820 7272",
        phoneNumber: "6598207272",
      }),
    ).toBe(true);
  });
});
