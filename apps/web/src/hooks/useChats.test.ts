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
});
