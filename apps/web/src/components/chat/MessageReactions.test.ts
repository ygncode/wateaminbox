import { describe, expect, test } from "bun:test";
import { getReactorIdentityLabel } from "./MessageReactions";

describe("reaction identity labels", () => {
  test("shows the canonical phone number instead of a private LID", () => {
    expect(
      getReactorIdentityLabel({
        reactorJid: "277905926004845@lid",
        reactorPhoneNumber: "+841665247989",
      }),
    ).toBe("+841665247989");
  });

  test("formats a phone JID when no separately resolved number is needed", () => {
    expect(
      getReactorIdentityLabel({
        reactorJid: "841665247989@s.whatsapp.net",
      }),
    ).toBe("+841665247989");
  });
});
