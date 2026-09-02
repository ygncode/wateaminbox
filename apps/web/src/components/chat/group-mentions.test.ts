import { describe, expect, test } from "bun:test";
import {
  filterMentionParticipants,
  getActiveMentionToken,
  insertMention,
  resolveMentionSegments,
  serializeMentionsForSend,
} from "./group-mentions";

const participants = [
  {
    jid: "6585719494172749@lid",
    phoneNumber: "6591234567",
    mentionIds: ["6585719494172749", "6591234567"],
    contactId: "contact-eddie",
    displayName: "Eddie Tan",
    profilePictureUrl: null,
    isSelf: false,
  },
  {
    jid: "6590000000@s.whatsapp.net",
    phoneNumber: "6590000000",
    mentionIds: ["6590000000"],
    contactId: "contact-self",
    displayName: "Me",
    profilePictureUrl: null,
    isSelf: true,
  },
];

describe("group mention rendering", () => {
  test("keeps the participant identity on a resolved numeric mention", () => {
    expect(
      resolveMentionSegments("Hi @6585719494172749!", participants),
    ).toEqual([
      { type: "text", value: "Hi " },
      {
        type: "mention",
        value: "@6585719494172749",
        displayValue: "@Eddie Tan",
        participant: participants[0],
      },
      { type: "text", value: "!" },
    ]);
  });

  test("does not mistake a numeric email domain for a mention", () => {
    expect(
      resolveMentionSegments("mail me@6585719494172749.com", participants),
    ).toEqual([{ type: "text", value: "mail me@6585719494172749.com" }]);
  });
});

describe("group mention composer", () => {
  test("finds an @ query at the caret but closes after a completed name", () => {
    expect(getActiveMentionToken("Hello @ed", 9)).toEqual({
      start: 6,
      end: 9,
      query: "ed",
    });
    expect(getActiveMentionToken("Hello @Eddie Tan ", 17)).toBeNull();
  });

  test("filters members by name and never suggests the connected account", () => {
    expect(filterMentionParticipants(participants, "edd")).toEqual([
      participants[0],
    ]);
    expect(filterMentionParticipants(participants, "")).toEqual([
      participants[0],
    ]);
  });

  test("inserts a friendly label and serializes WhatsApp mention metadata", () => {
    const token = getActiveMentionToken("Ask @ed", 7);
    expect(token).not.toBeNull();
    const insertion = insertMention("Ask @ed", token!, participants[0]);
    expect(insertion).toEqual({
      text: "Ask @Eddie Tan ",
      caret: 15,
      selected: {
        jid: "6585719494172749@lid",
        displayName: "Eddie Tan",
      },
    });
    expect(
      serializeMentionsForSend(`${insertion!.text}please reply`, [
        insertion!.selected,
      ]),
    ).toEqual({
      content: "Ask @6585719494172749 please reply",
      mentionedJids: ["6585719494172749@lid"],
    });
  });

  test("does not send metadata after the inserted label is deleted", () => {
    expect(
      serializeMentionsForSend("Ask someone else", [
        { jid: "6585719494172749@lid", displayName: "Eddie Tan" },
      ]),
    ).toEqual({ content: "Ask someone else", mentionedJids: [] });
  });
});
