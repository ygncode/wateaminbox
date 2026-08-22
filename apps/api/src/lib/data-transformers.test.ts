import { describe, expect, test } from "bun:test";
import type { RawContactFromDb } from "./data-transformers.js";
import { transformContact } from "./data-transformers.js";

function contact(overrides: Partial<RawContactFromDb>): RawContactFromDb {
  return {
    id: crypto.randomUUID(),
    jid: "123@s.whatsapp.net",
    phone_number: null,
    push_name: null,
    custom_name: null,
    is_group: false,
    profile_picture_url: null,
    notes_shared: null,
    last_message_at: null,
    assigned_to: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("contact API transformation", () => {
  test("never presents a WhatsApp group ID as a phone number", () => {
    const transformed = transformContact(
      contact({ jid: "120363000000000000@g.us", is_group: true }),
    );
    expect(transformed.phoneNumber).toBeNull();
  });

  test("continues to extract phone numbers for direct contacts", () => {
    const transformed = transformContact(
      contact({ jid: "15551234567:2@s.whatsapp.net" }),
    );
    expect(transformed.phoneNumber).toBe("15551234567");
  });

  test("never exposes an opaque LID as a phone number or display name", () => {
    const transformed = transformContact(
      contact({
        jid: "123456789012345@lid",
        phone_number: "123456789012345",
      }),
    );
    expect(transformed.phoneNumber).toBeNull();
    expect(transformed.displayName).toBe("WhatsApp user (ID …2345)");
    expect(transformed.name).toBe("WhatsApp user (ID …2345)");
  });

  test("exposes the WhatsApp account that owns the conversation", () => {
    const transformed = transformContact(
      contact({
        connection_id: "00000000-0000-4000-8000-000000000001",
        connection_name: "Sales",
        connection_phone_number: "15550001111",
        connection_status: "connected",
      }),
    );

    expect(transformed.connection).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Sales",
      phoneNumber: "15550001111",
      status: "connected",
    });
  });
});
