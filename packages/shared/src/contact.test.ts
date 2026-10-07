import { describe, expect, test } from "bun:test";
import {
  formatWhatsAppUsername,
  getContactDisplayName,
  getContactName,
  getSafeIdentityName,
  normalizeWhatsAppUsername,
} from "./contact";

describe("contact identity display", () => {
  test("never presents a stored LID local part as a phone number", () => {
    const contact = {
      jid: "123456789012345@lid",
      phone_number: "123456789012345",
    };

    expect(getContactDisplayName(contact)).toBe("WhatsApp user (ID …2345)");
    expect(getContactName(contact)).toBeNull();
    expect(
      getContactDisplayName({ ...contact, name: "+123456789012345" }),
    ).toBe("WhatsApp user (ID …2345)");
    expect(getContactDisplayName({ ...contact, name: contact.jid })).toBe(
      "WhatsApp user (ID …2345)",
    );
    expect(
      getContactDisplayName({
        ...contact,
        push_name: contact.jid.split("@")[0],
      }),
    ).toBe("WhatsApp user (ID …2345)");
    expect(
      getContactDisplayName({
        ...contact,
        custom_name: "+123456789012345",
      }),
    ).toBe("WhatsApp user (ID …2345)");
  });

  test("prefers WhatsApp names, then public usernames, over opaque IDs", () => {
    const contact = {
      jid: "123456789012345@lid",
      username: "private_user",
    };

    expect(getContactDisplayName(contact)).toBe("@private_user");
    expect(getContactName(contact)).toBe("@private_user");
    expect(getContactDisplayName({ ...contact, push_name: "Known Name" })).toBe(
      "Known Name",
    );
    expect(getContactDisplayName({ ...contact, custom_name: "VIP" })).toBe(
      "VIP",
    );
  });

  test("normalizes username handles and rejects opaque-ID repetition", () => {
    expect(normalizeWhatsAppUsername("  @private_user ")).toBe("private_user");
    expect(formatWhatsAppUsername("@private_user")).toBe("@private_user");
    expect(
      formatWhatsAppUsername("123456789012345", "123456789012345@lid"),
    ).toBeNull();
  });

  test("keeps real phone and named contact fallbacks", () => {
    expect(
      getContactDisplayName({
        jid: "15551234567@s.whatsapp.net",
        phone_number: "15551234567",
      }),
    ).toBe("15551234567");
    expect(
      getContactDisplayName({
        jid: "123456789012345@lid",
        push_name: "Known contact",
        phone_number: "123456789012345",
      }),
    ).toBe("Known contact");
  });
});

describe("getSafeIdentityName", () => {
  test("returns null for empty/whitespace names", () => {
    expect(getSafeIdentityName(null, "123456789012345@lid")).toBeNull();
    expect(getSafeIdentityName("", "123456789012345@lid")).toBeNull();
    expect(getSafeIdentityName("   ", "123456789012345@lid")).toBeNull();
    expect(getSafeIdentityName(undefined, "123456789012345@lid")).toBeNull();
  });

  test("passes names through unchanged for non-LID JIDs", () => {
    // A phone-number JID never reaches the LID-leak guard.
    expect(getSafeIdentityName("Alice", "15551234567@s.whatsapp.net")).toBe(
      "Alice",
    );
    // A name that merely repeats the local part of a phone JID is kept, since
    // phone local parts are not opaque tokens that the LID mask must hide.
    expect(
      getSafeIdentityName("15551234567", "15551234567@s.whatsapp.net"),
    ).toBe("15551234567");
    expect(getSafeIdentityName("Anything", null)).toBe("Anything");
  });

  test("rejects bare LID local-part digits for @lid JIDs", () => {
    const lid = "123456789012345@lid";
    expect(getSafeIdentityName("123456789012345", lid)).toBeNull();
  });

  test("rejects bare LID local-part digits for @hosted.lid JIDs", () => {
    const lid = "6585719494172749@hosted.lid";
    expect(getSafeIdentityName("6585719494172749", lid)).toBeNull();
  });

  test("rejects the whole LID JID as a name", () => {
    const lid = "123456789012345@lid";
    expect(getSafeIdentityName(lid, lid)).toBeNull();
  });

  test("rejects a device-suffixed LID local part", () => {
    const lid = "123456789012345:3@lid";
    expect(getSafeIdentityName("123456789012345", lid)).toBeNull();
  });

  test("rejects a phone-shaped restatement of the LID digits", () => {
    const lid = "123456789012345@lid";
    // "+123456789012345" carries nothing but the opaque digits.
    expect(getSafeIdentityName("+123456789012345", lid)).toBeNull();
    expect(getSafeIdentityName("+123 456 789 012 345", lid)).toBeNull();
  });

  test("keeps a real name whose digits differ from the LID local part", () => {
    const lid = "123456789012345@lid";
    expect(getSafeIdentityName("Alice 987654321", lid)).toBe("Alice 987654321");
    expect(getSafeIdentityName("Office 555", lid)).toBe("Office 555");
    expect(getSafeIdentityName("Alice 1234567890120", lid)).toBe(
      "Alice 1234567890120",
    );
  });

  test("rejects a name whose only digits are the LID local part even with extra text", () => {
    const lid = "123456789012345@lid";
    expect(getSafeIdentityName("Alice 123456789012345", lid)).toBeNull();
    expect(getSafeIdentityName("123456789012345 Inc.", lid)).toBeNull();
  });

  test("keeps a real name for an LID JID", () => {
    const lid = "123456789012345@lid";
    expect(getSafeIdentityName("Alice", lid)).toBe("Alice");
  });

  test("rejects differently-punctuated restatements of the LID digits", () => {
    const lid = "123456789012345@lid";
    expect(getSafeIdentityName("12345 67890 12345", lid)).toBeNull();
  });
});
