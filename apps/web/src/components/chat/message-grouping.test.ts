import { describe, expect, it } from "bun:test";
import {
  continuesMessageGroup,
  endsGroup,
  type GroupableMessage,
  getMessageAuthorKey,
  MESSAGE_GROUP_WINDOW_MS,
  resolveBubbleGroupPositions,
  startsGroup,
} from "./message-grouping";

const BASE = Date.parse("2026-08-22T10:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString();
}

const contact = (offsetMs: number, jid = "6591234567@s.whatsapp.net") =>
  ({
    senderType: "contact",
    senderJid: jid,
    createdAt: at(offsetMs),
  }) satisfies GroupableMessage;

const teammate = (offsetMs: number, userId: string | null = "agent-1") =>
  ({
    senderType: "user",
    sentByUserId: userId,
    createdAt: at(offsetMs),
  }) satisfies GroupableMessage;

describe("getMessageAuthorKey", () => {
  it("separates two teammates replying from the same shared inbox", () => {
    expect(getMessageAuthorKey(teammate(0, "agent-1"))).not.toBe(
      getMessageAuthorKey(teammate(0, "agent-2")),
    );
  });

  it("separates the linked phone from any teammate", () => {
    expect(getMessageAuthorKey(teammate(0, null))).toBe("user:linked-phone");
    expect(getMessageAuthorKey(teammate(0, null))).not.toBe(
      getMessageAuthorKey(teammate(0, "agent-1")),
    );
  });

  it("separates two participants of a WhatsApp group", () => {
    expect(getMessageAuthorKey(contact(0, "a@s.whatsapp.net"))).not.toBe(
      getMessageAuthorKey(contact(0, "b@s.whatsapp.net")),
    );
  });

  it("never merges an inbound message into an outbound run", () => {
    expect(getMessageAuthorKey(contact(0))).not.toBe(
      getMessageAuthorKey(teammate(0)),
    );
  });
});

describe("continuesMessageGroup", () => {
  it("continues within the window for the same author", () => {
    expect(continuesMessageGroup(contact(0), contact(60_000))).toBe(true);
  });

  it("breaks once the window elapses", () => {
    expect(
      continuesMessageGroup(contact(0), contact(MESSAGE_GROUP_WINDOW_MS)),
    ).toBe(true);
    expect(
      continuesMessageGroup(contact(0), contact(MESSAGE_GROUP_WINDOW_MS + 1)),
    ).toBe(false);
  });

  it("breaks when the author changes even one millisecond apart", () => {
    expect(
      continuesMessageGroup(teammate(0, "agent-1"), teammate(1, "agent-2")),
    ).toBe(false);
  });

  it("has no previous message to continue at the top of the thread", () => {
    expect(continuesMessageGroup(null, contact(0))).toBe(false);
  });

  it("refuses to merge out-of-order or unparseable timestamps", () => {
    expect(continuesMessageGroup(contact(60_000), contact(0))).toBe(false);
    expect(
      continuesMessageGroup(
        { senderType: "contact", senderJid: "a", createdAt: "not-a-date" },
        contact(0),
      ),
    ).toBe(false);
  });
});

describe("resolveBubbleGroupPositions", () => {
  it("marks a lone message as its own run", () => {
    expect(resolveBubbleGroupPositions([contact(0)])).toEqual(["single"]);
  });

  it("brackets a run of three with first/middle/last", () => {
    expect(
      resolveBubbleGroupPositions([contact(0), contact(1000), contact(2000)]),
    ).toEqual(["first", "middle", "last"]);
  });

  it("breaks the run across a date separator", () => {
    // The separator is the `null` row; without it the two bubbles would merge.
    expect(
      resolveBubbleGroupPositions([contact(0), null, contact(1000)]),
    ).toEqual(["single", null, "single"]);
  });

  it("splits a back-and-forth into single bubbles", () => {
    expect(
      resolveBubbleGroupPositions([
        contact(0),
        teammate(1000),
        contact(2000),
        teammate(3000),
      ]),
    ).toEqual(["single", "single", "single", "single"]);
  });

  it("keeps each teammate's run separate so attribution is never dropped", () => {
    expect(
      resolveBubbleGroupPositions([
        teammate(0, "agent-1"),
        teammate(1000, "agent-1"),
        teammate(2000, "agent-2"),
        teammate(3000, "agent-2"),
      ]),
    ).toEqual(["first", "last", "first", "last"]);
  });

  it("starts a new run when the conversation goes quiet", () => {
    expect(
      resolveBubbleGroupPositions([
        contact(0),
        contact(1000),
        contact(1000 + MESSAGE_GROUP_WINDOW_MS + 1),
      ]),
    ).toEqual(["first", "last", "single"]);
  });
});

describe("run edges", () => {
  it("puts the tail and the sender name on the first bubble only", () => {
    expect((["first", "single"] as const).every(startsGroup)).toBe(true);
    expect((["middle", "last"] as const).some(startsGroup)).toBe(false);
  });

  it("puts the bottom-aligned avatar on the last bubble only", () => {
    expect((["last", "single"] as const).every(endsGroup)).toBe(true);
    expect((["first", "middle"] as const).some(endsGroup)).toBe(false);
  });
});
