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

  test("rejects @<id> buried inside an email-shaped substring (@lid)", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "my contact is me@6585719494172749.com please reach out",
        ["6585719494172749@lid"],
      ).error,
    ).toContain("matching @token");
  });

  test("rejects @<id> buried inside an email-shaped substring (@s.whatsapp.net)", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "my email is me@6585719494172749.com",
        ["6585719494172749@s.whatsapp.net"],
      ).error,
    ).toContain("matching @token");
  });

  test("rejects @<id> immediately preceded by letters", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "ping123@6585719494172749 tomorrow",
        ["6585719494172749@lid"],
      ).error,
    ).toContain("matching @token");
  });

  test("rejects @<id> immediately followed by letters", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "reply to @6585719494172749extra please",
        ["6585719494172749@lid"],
      ).error,
    ).toContain("matching @token");
  });

  test("rejects @<id> followed by - (group id separator) for an LID JID", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "see @6585719494172749-1234567890@g.us now",
        ["6585719494172749@lid"],
      ).error,
    ).toContain("matching @token");
  });

  test("accepts a mention token preceded by a parenthesis", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "(@6585719494172749) look here",
        ["6585719494172749@lid"],
      ),
    ).toEqual({ mentionedJids: ["6585719494172749@lid"] });
  });

  test("accepts a mention token for an @s.whatsapp.net JID", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "Hi @6585719494172749 welcome",
        ["6585719494172749@s.whatsapp.net"],
      ),
    ).toEqual({ mentionedJids: ["6585719494172749@s.whatsapp.net"] });
  });

  test("rejects when any one mentioned JID lacks a real @token while another matches", () => {
    expect(
      validateGroupMentionRequest(
        { jid: "120363000000000000@g.us", isGroup: true },
        "Hi @6585719494172749 ping 1209876543210@lid.example.com",
        ["6585719494172749@lid", "1209876543210@lid"],
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
