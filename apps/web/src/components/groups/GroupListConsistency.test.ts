import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("chat and group sidebar separation", () => {
  test("the Chats tab excludes groups because Groups has its own tab", async () => {
    const chatList = await readSource("../chat/ChatList.tsx");
    expect(chatList).toContain(
      "useChats(searchQuery, false, assignmentFilter)",
    );
    expect(chatList).not.toContain(
      "useChats(searchQuery, true, assignmentFilter)",
    );
  });

  test("does not present missing participant metadata as a real zero", async () => {
    const groupList = await readSource("./GroupList.tsx");
    expect(groupList).toContain('"Participant count unavailable"');
    expect(groupList).not.toContain("group.participantCount ?? 0");
  });
});
