import { describe, expect, test } from "bun:test";
import {
  type ParticipantIdentity,
  resolveParticipantContactId,
} from "./group-participant-identity";

const participant = (
  overrides: Partial<ParticipantIdentity> = {},
): ParticipantIdentity => ({
  jid: "6591234567@s.whatsapp.net",
  phoneNumber: "6591234567",
  mentionIds: ["6591234567"],
  contactId: "contact-1",
  ...overrides,
});

describe("resolveParticipantContactId", () => {
  test("matches a sender by their plain phone JID", () => {
    expect(
      resolveParticipantContactId("6591234567@s.whatsapp.net", [participant()]),
    ).toBe("contact-1");
  });

  test("ignores the device suffix WhatsApp attaches to a sender JID", () => {
    expect(
      resolveParticipantContactId("6591234567:12@s.whatsapp.net", [
        participant(),
      ]),
    ).toBe("contact-1");
  });

  test("matches a private LID through the participant's mapped mention ids", () => {
    const member = participant({
      mentionIds: ["6591234567", "182736450912345"],
    });
    expect(resolveParticipantContactId("182736450912345@lid", [member])).toBe(
      "contact-1",
    );
  });

  test("returns null for a member the workspace holds no contact for", () => {
    expect(
      resolveParticipantContactId("6591234567@s.whatsapp.net", [
        participant({ contactId: null }),
      ]),
    ).toBeNull();
  });

  test("returns null for an unmapped LID rather than guessing a neighbour", () => {
    expect(
      resolveParticipantContactId("999888777666555@lid", [participant()]),
    ).toBeNull();
  });

  test("never resolves the group's own JID to a member", () => {
    expect(
      resolveParticipantContactId("120363000000000000@g.us", [participant()]),
    ).toBeNull();
  });

  test("returns null when there is no sender identity at all", () => {
    expect(resolveParticipantContactId(null, [participant()])).toBeNull();
    expect(resolveParticipantContactId("", [participant()])).toBeNull();
    expect(
      resolveParticipantContactId("@s.whatsapp.net", [participant()]),
    ).toBeNull();
  });

  test("picks the member whose token matches, not the first in the list", () => {
    const other = participant({
      jid: "6580000000@s.whatsapp.net",
      phoneNumber: "6580000000",
      mentionIds: ["6580000000"],
      contactId: "contact-other",
    });
    expect(
      resolveParticipantContactId("6591234567@s.whatsapp.net", [
        other,
        participant(),
      ]),
    ).toBe("contact-1");
  });

  test("resolves nothing against an empty participant list", () => {
    expect(
      resolveParticipantContactId("6591234567@s.whatsapp.net", []),
    ).toBeNull();
  });
});
