import { describe, expect, test } from "bun:test";
import {
  areGroupMentionJidsCurrentMembers,
  validateGroupMentionRequest,
} from "./group-mention.service";

describe("group mention validation", () => {
  test("normalizes and deduplicates mention JIDs with matching message tokens", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "Hi @6585719494172749",
        ["6585719494172749:7@lid", "6585719494172749@lid"],
      ),
    ).toEqual({ mentionedJids: ["6585719494172749@lid"] });
  });

  test("rejects mentions outside group conversations", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "6591234567@s.whatsapp.net", isGroup: false },
        "Hi @6585719494172749",
        ["6585719494172749@lid"],
      ).error,
    ).toContain("only supported in group");
  });

  test("rejects invisible mention metadata without a matching token", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "Hi everyone",
        ["6585719494172749@lid"],
      ).error,
    ).toContain("matching @token");
  });

  test("requires every mentioned identity to be a current member", () => {
    expect(
      areGroupMentionJidsCurrentMembers(
        ["6585719494172749@lid"],
        ["6585719494172749:4@lid"],
      ),
    ).toBe(true);
    expect(
      areGroupMentionJidsCurrentMembers(
        ["6585719494172749@lid"],
        ["6591234567@s.whatsapp.net"],
      ),
    ).toBe(false);
  });
});
