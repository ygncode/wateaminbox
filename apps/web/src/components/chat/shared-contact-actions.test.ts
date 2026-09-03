import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("shared contact actions", () => {
  test("opens contact details from the bottom and offers an inbox message action", async () => {
    const [content, sheet, page] = await Promise.all([
      readSource("./MessageContent.tsx"),
      readSource("./SharedContactSheet.tsx"),
      readSource("../../pages/ChatPage.tsx"),
    ]);

    expect(content).toContain("onOpenSharedContact?.(card)");
    expect(content).toContain("onMessageSharedContact(card)");
    expect(sheet).toContain('position="bottom"');
    expect(sheet).toContain('t("chat.messageContact", "Message")');
    expect(page).toContain("createSharedContact.mutateAsync");
    expect(page).toContain("handleChatSelect(existingContactId)");
  });
});
