import { describe, expect, test } from "bun:test";
import { getContactDisplayName, getContactName } from "./contact";

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
