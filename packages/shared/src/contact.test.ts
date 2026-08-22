import { describe, expect, test } from "bun:test";
import {
  formatWhatsAppUsername,
  getContactDisplayName,
  getContactName,
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
