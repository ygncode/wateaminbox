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

describe("mentions of another group", () => {
  test("resolves the complete group address using message metadata", () => {
    expect(
      resolveMentionSegments(
        "@120363401436917596@g.us to RSVP ^^",
        [],
        [{ jid: "120363401436917596@g.us", subject: "AI Playground" }],
      ),
    ).toEqual([
      {
        type: "mention",
        value: "@120363401436917596@g.us",
        displayValue: "@AI Playground",
        group: { jid: "120363401436917596@g.us", subject: "AI Playground" },
      },
      { type: "text", value: " to RSVP ^^" },
    ]);
  });

  test("keeps unknown group addresses intact instead of matching a person", () => {
    const segments = resolveMentionSegments("@120363401436917596@g.us", [
      {
        jid: "120363401436917596@lid",
        displayName: "Wrong person",
        contactId: null,
        phoneNumber: null,
      },
    ]);
    expect(segments[0].participant).toBeUndefined();
    expect(segments[0].displayValue).toBe("@120363401436917596@g.us");
    expect(segments[0].group?.jid).toBe("120363401436917596@g.us");
  });
});

test("resolves legacy group addresses next to punctuation and person mentions", () => {
  const segments = resolveMentionSegments(
    "Ask @6591234567 in (@123456789-987654321@g.us).",
    [
      {
        jid: "6591234567@s.whatsapp.net",
        displayName: "Alice",
        contactId: null,
        phoneNumber: "6591234567",
      },
    ],
    [{ jid: "123456789-987654321@g.us", subject: "Events" }],
  );
  expect(
    segments.map((segment) => segment.displayValue ?? segment.value).join(""),
  ).toBe("Ask @Alice in (@Events).");
  expect(
    resolveMentionSegments(
      "@123456789-987654321@g.us.",
      [],
      [{ jid: "123456789-987654321@g.us", subject: "Events" }],
    )[0].displayValue,
  ).toBe("@Events");
});
