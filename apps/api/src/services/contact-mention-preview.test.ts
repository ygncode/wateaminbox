import { describe, expect, test } from "bun:test";
import {
  getNumericMentionIds,
  selectMentionPreviewParticipants,
} from "./contact-mention-preview";

describe("contact list mention previews", () => {
  test("extracts WhatsApp mention tokens without matching email domains", () => {
    expect(
      getNumericMentionIds(
        "Ask @6585719494172749 and @6591234567, not me@123456.com",
      ),
    ).toEqual(["6585719494172749", "6591234567"]);
  });

  test("returns only participants named in the last message", () => {
    const eddie = {
      displayName: "Eddie Tan",
      mentionIds: ["6585719494172749", "6591234567"],
    };
    const alice = {
      displayName: "Alice",
      mentionIds: ["6580000000"],
    };
    expect(
      selectMentionPreviewParticipants("Hello @6585719494172749", [
        eddie,
        alice,
      ]),
    ).toEqual([eddie]);
  });
});
