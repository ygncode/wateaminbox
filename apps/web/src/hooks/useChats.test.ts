import { describe, expect, test } from "bun:test";
import { buildChatListQueryParams } from "./useChats";

describe("chat list query filters", () => {
  test("requests groups for the inclusive Chats view", () => {
    expect(buildChatListQueryParams("", true, "all")).toEqual({
      limit: 100,
      includeGroups: "true",
      conversationStatus: "open",
    });
  });

  test("can still request direct contacts only when explicitly needed", () => {
    expect(buildChatListQueryParams("", false, "all")).toEqual({
      limit: 100,
      conversationStatus: "open",
    });
  });

  test("keeps search and assignment filters with group inclusion", () => {
    expect(buildChatListQueryParams("Hackathon", true, "assignedToMe")).toEqual(
      {
        limit: 100,
        search: "Hackathon",
        includeGroups: "true",
        assignedToMe: "true",
        conversationStatus: "open",
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
      conversationStatus: "open",
    });
  });

  test("filters by any selected workspace tag", () => {
    expect(
      buildChatListQueryParams("", true, "all", undefined, "open", [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ]),
    ).toEqual({
      limit: 100,
      includeGroups: "true",
      tagIds:
        "11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222",
      conversationStatus: "open",
    });
  });

  test("supports overriding the conversation lifecycle filter", () => {
    expect(
      buildChatListQueryParams("", true, "all", undefined, "resolved"),
    ).toEqual({
      limit: 100,
      includeGroups: "true",
      conversationStatus: "resolved",
    });
  });

  test("passing 'all' removes the lifecycle filter server-side scoping intent explicitly", () => {
    expect(buildChatListQueryParams("", true, "all", undefined, "all")).toEqual(
      {
        limit: 100,
        includeGroups: "true",
        conversationStatus: "all",
      },
    );
  });
});
