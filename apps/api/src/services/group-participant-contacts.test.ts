import { describe, expect, test } from "bun:test";
import {
  batchPlannedContacts,
  isPhoneAddressableJid,
  planParticipantContactBackfill,
  resolveMemberPushName,
  shouldNameExistingMember,
} from "./group-participant-contacts.js";

/**
 * The reported symptom was "only the last participant in a group is
 * clickable". These cases pin the cause and the fix: a member is only openable
 * once a contact row exists for them, and before the backfill that was true for
 * whichever single member also held a direct conversation.
 */

const OWN_JID = "6580000000@s.whatsapp.net";

const member = (user: string) => ({ jid: `${user}@s.whatsapp.net` });

describe("the reported bug", () => {
  test("a group where one member has a direct conversation leaves the rest unplanned only after backfill runs", () => {
    const participants = [
      member("6591111111"),
      member("6592222222"),
      // The one member who also DMs this account, so the only one that
      // historically had a contact row - and the only clickable identity.
      member("6593333333"),
    ];

    const planned = planParticipantContactBackfill({
      participants,
      existingContactJids: ["6593333333@s.whatsapp.net"],
      connectionJid: OWN_JID,
    });

    // Exactly the members that were previously unopenable.
    expect(planned.map((row) => row.jid)).toEqual([
      "6591111111@s.whatsapp.net",
      "6592222222@s.whatsapp.net",
    ]);
    // Re-running against the post-backfill state plans nothing: that is what
    // makes the sync safe to repeat on every snapshot.
    expect(
      planParticipantContactBackfill({
        participants,
        existingContactJids: [
          "6593333333@s.whatsapp.net",
          ...planned.map((row) => row.jid),
        ],
        connectionJid: OWN_JID,
      }),
    ).toEqual([]);
  });
});

describe("planParticipantContactBackfill", () => {
  test("carries the phone number so the new contact is identifiable", () => {
    expect(
      planParticipantContactBackfill({
        participants: [member("6591111111")],
        existingContactJids: [],
        connectionJid: OWN_JID,
      }),
    ).toEqual([
      {
        jid: "6591111111@s.whatsapp.net",
        phoneNumber: "6591111111",
        pushName: null,
      },
    ]);
  });

  test("never plans a contact for the connected account itself", () => {
    expect(
      planParticipantContactBackfill({
        participants: [{ jid: OWN_JID }, member("6591111111")],
        existingContactJids: [],
        connectionJid: OWN_JID,
      }).map((row) => row.jid),
    ).toEqual(["6591111111@s.whatsapp.net"]);
  });

  test("skips a member WhatsApp only addresses by LID", () => {
    // Inserting under a LID would duplicate the person the moment their phone
    // JID arrives - the exact collision migration 038 had to clean up.
    expect(
      planParticipantContactBackfill({
        participants: [{ jid: "182736450912345@lid" }, member("6591111111")],
        existingContactJids: [],
        connectionJid: OWN_JID,
      }).map((row) => row.jid),
    ).toEqual(["6591111111@s.whatsapp.net"]);
  });

  test("never plans a contact for a group JID", () => {
    expect(
      planParticipantContactBackfill({
        participants: [{ jid: "120363000000000000@g.us" }],
        existingContactJids: [],
        connectionJid: OWN_JID,
      }),
    ).toEqual([]);
  });

  test("treats a device-suffixed member as the member they already are", () => {
    // normalizeJid strips ":12"; without that the same person would be planned
    // a second time under a JID the unique index also collapses.
    expect(
      planParticipantContactBackfill({
        participants: [{ jid: "6591111111:12@s.whatsapp.net" }],
        existingContactJids: ["6591111111@s.whatsapp.net"],
        connectionJid: OWN_JID,
      }),
    ).toEqual([]);
  });

  test("plans one row for a member listed twice in the same snapshot", () => {
    expect(
      planParticipantContactBackfill({
        participants: [
          member("6591111111"),
          { jid: "6591111111:3@s.whatsapp.net" },
          member("6591111111"),
        ],

        existingContactJids: [],
        connectionJid: OWN_JID,
      }),
    ).toHaveLength(1);
  });

  test("matches existing contacts through the same normalisation", () => {
    expect(
      planParticipantContactBackfill({
        participants: [member("6591111111")],
        existingContactJids: ["6591111111:7@s.whatsapp.net"],
        connectionJid: OWN_JID,
      }),
    ).toEqual([]);
  });

  test("still plans members when the connection JID is unknown", () => {
    expect(
      planParticipantContactBackfill({
        participants: [member("6591111111")],
        existingContactJids: [],
        connectionJid: null,
      }).map((row) => row.jid),
    ).toEqual(["6591111111@s.whatsapp.net"]);
  });

  test("ignores an unusable JID rather than planning an empty contact", () => {
    expect(
      planParticipantContactBackfill({
        participants: [{ jid: "" }, { jid: "   " }],
        existingContactJids: [],
        connectionJid: OWN_JID,
      }),
    ).toEqual([]);
  });
});

describe("isPhoneAddressableJid", () => {
  test("accepts only the phone address space", () => {
    expect(isPhoneAddressableJid("6591111111@s.whatsapp.net")).toBe(true);
    expect(isPhoneAddressableJid("182736450912345@lid")).toBe(false);
    expect(isPhoneAddressableJid("120363000000000000@g.us")).toBe(false);
  });
});

describe("batchPlannedContacts", () => {
  test("keeps a full-size group off a single oversized statement", () => {
    const rows = Array.from({ length: 1024 }, (_, index) => index);
    const batches = batchPlannedContacts(rows, 200);
    expect(batches).toHaveLength(6);
    expect(batches.at(-1)).toHaveLength(24);
    expect(batches.flat()).toEqual(rows);
  });

  test("returns nothing to do for an empty plan", () => {
    expect(batchPlannedContacts([], 200)).toEqual([]);
  });

  test("refuses a batch size that would never terminate", () => {
    expect(() => batchPlannedContacts([1, 2], 0)).toThrow(
      "batchSize must be at least 1",
    );
  });
});

describe("resolveMemberPushName", () => {
  const jid = "6591234567@s.whatsapp.net";

  test("keeps a real WhatsApp name so the profile matches the panel", () => {
    expect(resolveMemberPushName("Alice Tan", jid)).toBe("Alice Tan");
  });

  test("trims what WhatsApp sent rather than storing the padding", () => {
    expect(resolveMemberPushName("  Alice Tan  ", jid)).toBe("Alice Tan");
  });

  test("treats an absent or blank name as no name at all", () => {
    expect(resolveMemberPushName(null, jid)).toBeNull();
    expect(resolveMemberPushName(undefined, jid)).toBeNull();
    expect(resolveMemberPushName("   ", jid)).toBeNull();
  });

  test("rejects a name that only repeats the member's own number", () => {
    // getContactDisplayName falls through to the phone column anyway, and a
    // stored copy would look like a real name that WhatsApp must not replace.
    expect(resolveMemberPushName("6591234567", jid)).toBeNull();
    expect(resolveMemberPushName("+65 9123 4567", jid)).toBeNull();
    expect(resolveMemberPushName(jid, jid)).toBeNull();
  });

  test("keeps a name that merely contains the number alongside something else", () => {
    expect(resolveMemberPushName("Alice 6591234567", jid)).toBe(
      "Alice 6591234567",
    );
  });

  test("keeps a numeric name that is not this member's number", () => {
    expect(resolveMemberPushName("8888", jid)).toBe("8888");
  });
});

describe("shouldNameExistingMember", () => {
  test("names a member migration 079 created bare", () => {
    expect(shouldNameExistingMember({ push_name: null })).toBe(true);
    expect(shouldNameExistingMember({ push_name: "   " })).toBe(true);
  });

  test("leaves a member that already carries a WhatsApp name", () => {
    // Otherwise a stale address book entry could walk back over a fresher name.
    expect(shouldNameExistingMember({ push_name: "Alice Tan" })).toBe(false);
  });
});
