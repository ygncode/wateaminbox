import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) =>
  readFileSync(resolve(import.meta.dir, path), "utf8");

describe("phone formatting coverage", () => {
  test("formats numeric fallbacks in chat surfaces", () => {
    expect(source("../components/chat/ChatListItem.tsx")).toContain(
      "formatPhoneLikeText(contact.name)",
    );
    expect(source("../components/chat/MessageHeader.tsx")).toContain(
      "formatPhoneLikeText(",
    );
    expect(source("../components/chat/MessageBubble.tsx")).toContain(
      "formatPhoneLikeText(senderName)",
    );
    expect(source("../components/chat/ForwardMessageDialog.tsx")).toContain(
      "formatPhoneNumber(contact.phoneNumber)",
    );
    expect(source("./desktop-notifications.ts")).toContain(
      "formatPhoneNumber(phone)",
    );
  });

  test("formats phone numbers throughout connection surfaces", () => {
    expect(source("../components/whatsapp/ConnectionCard.tsx")).toContain(
      "formatPhoneNumber(connection.phoneNumber)",
    );
    expect(source("../components/whatsapp/ConnectionViews.tsx")).toContain(
      "formatPhoneNumber(phoneNumber)",
    );
    expect(
      source("../components/whatsapp/connection-panel/AddConnectionDialog.tsx"),
    ).toContain("formatPhoneLikeText(");
    expect(
      source(
        "../components/whatsapp/connection-panel/SingleConnectionPanel.tsx",
      ),
    ).toContain("formatPhoneNumber(phoneNumber)");
  });

  test("formats contact and import phone-number displays", () => {
    expect(source("../components/contacts/AddContactDialog.tsx")).toContain(
      "formatPhoneLikeText(",
    );
    expect(source("../components/contacts/import/PreviewStep.tsx")).toContain(
      "formatPhoneNumber(row.phoneNumber)",
    );
    expect(source("../components/contacts/import/CompleteStep.tsx")).toContain(
      "formatPhoneNumber(r.phoneNumber)",
    );
  });
});
