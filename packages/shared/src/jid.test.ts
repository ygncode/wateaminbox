import { describe, expect, test } from "bun:test";
import { extractPhoneFromJid, getLidDisplayName, isLidJid } from "./jid";

describe("WhatsApp JID identity handling", () => {
  test("extracts phone numbers only from the phone-number namespace", () => {
    expect(extractPhoneFromJid("15551234567@s.whatsapp.net")).toBe(
      "15551234567",
    );
    expect(extractPhoneFromJid("15551234567:4@s.whatsapp.net")).toBe(
      "15551234567",
    );
    expect(extractPhoneFromJid("123456789012345@lid")).toBeNull();
    expect(extractPhoneFromJid("99112233@hosted.lid")).toBeNull();
    expect(extractPhoneFromJid("120363000000000000@g.us")).toBeNull();
    expect(extractPhoneFromJid("123456789@newsletter")).toBeNull();
  });

  test("recognizes ordinary and hosted LID identities", () => {
    expect(isLidJid("123456789012345@lid")).toBe(true);
    expect(isLidJid("99112233@hosted.lid")).toBe(true);
    expect(isLidJid("15551234567@s.whatsapp.net")).toBe(false);
    expect(getLidDisplayName("123456789012345@lid")).toBe(
      "WhatsApp user (ID …2345)",
    );
    expect(getLidDisplayName("15551234567@s.whatsapp.net")).toBeNull();
  });
});
