import { describe, expect, test } from "bun:test";
import { buildChatListQueryParams } from "./useChats";

describe("chat list query filters", () => {
  test("requests groups for the inclusive Chats view", () => {
    expect(buildChatListQueryParams("", true, "all")).toEqual({
      limit: 100,
      includeGroups: "true",
    });
  });

  test("can still request direct contacts only when explicitly needed", () => {
    expect(buildChatListQueryParams("", false, "all")).toEqual({
      limit: 100,
    });
  });

  test("keeps search and assignment filters with group inclusion", () => {
    expect(buildChatListQueryParams("Hackathon", true, "assignedToMe")).toEqual(
      {
        limit: 100,
        search: "Hackathon",
        includeGroups: "true",
        assignedToMe: "true",
      },
    );
  });

  test("scopes the inbox to a selected WhatsApp account", () => {
    expect(
      buildChatListQueryParams(
        "",
        true,
        "all",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toEqual({
      limit: 100,
      includeGroups: "true",
      connectionId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
