import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("inclusive chat list and group filtering", () => {
  test("the Chats tab includes direct and group conversations", async () => {
    const chatList = await readSource("../chat/ChatList.tsx");
    expect(chatList).toContain("useChats(");
    expect(chatList).toContain("true,\n    assignmentFilter,");
    expect(chatList).toContain('connectionFilter === "all"');
    expect(chatList).not.toContain(
      "useChats(searchQuery, false, assignmentFilter)",
    );
  });

  test("the Groups tab remains a group-only filter", async () => {
    const sidebar = await readSource("../chat/ChatSidebar.tsx");
    expect(sidebar).toContain('activeView === "groups"');
    expect(sidebar).toContain("<GroupList");
  });

  test("groups can be scoped to a WhatsApp account", async () => {
    const groupList = await readSource("./GroupList.tsx");
    const groupsHook = await readSource("../../hooks/useGroups.ts");
    expect(groupList).toContain('connectionFilter === "all"');
    expect(groupList).toContain("All WhatsApp numbers");
    expect(groupsHook).toContain('params.set("connectionId", connectionId)');
  });

  test("does not present missing participant metadata as a real zero", async () => {
    const groupList = await readSource("./GroupList.tsx");
    expect(groupList).toContain('"Participant count unavailable"');
    expect(groupList).not.toContain("group.participantCount ?? 0");
  });
});
