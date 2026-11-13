import { describe, expect, test } from "bun:test";
import {
  CONTACT_ROW,
  compareInboxKeys,
  decodeInboxCursor,
  encodeInboxCursor,
  type InboxCursor,
  THREAD_ROW,
} from "./inbox-cursor.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("inbox cursor", () => {
  test("round-trips exactly, including microsecond activity", () => {
    const cursor: InboxCursor = {
      activityUs: "1793404800123456",
      kind: THREAD_ROW,
      id: id(7),
    };
    expect(decodeInboxCursor(encodeInboxCursor(cursor))).toEqual(cursor);
    const empty: InboxCursor = {
      activityUs: null,
      kind: CONTACT_ROW,
      id: id(1),
    };
    expect(decodeInboxCursor(encodeInboxCursor(empty))).toEqual(empty);
  });

  test("rejects anything it did not issue", () => {
    for (const value of [
      "",
      "not-base64!",
      Buffer.from("[]").toString("base64url"),
      Buffer.from('["1", 2, "x"]').toString("base64url"),
      Buffer.from('["1", 0, "not-a-uuid"]').toString("base64url"),
      Buffer.from(`["1.5", 0, "${id(1)}"]`).toString("base64url"),
      Buffer.from(`["1; DROP", 0, "${id(1)}"]`).toString("base64url"),
      Buffer.from(`[1, 0, "${id(1)}"]`).toString("base64url"),
    ]) {
      expect(decodeInboxCursor(value)).toBeNull();
    }
  });

  test("orders newest first, customers before threads on a tie, then id desc", () => {
    const keys: InboxCursor[] = [
      { activityUs: null, kind: CONTACT_ROW, id: id(1) },
      { activityUs: "100", kind: THREAD_ROW, id: id(2) },
      { activityUs: "100", kind: CONTACT_ROW, id: id(3) },
      { activityUs: "100", kind: CONTACT_ROW, id: id(4) },
      { activityUs: "200", kind: THREAD_ROW, id: id(5) },
    ];
    const sorted = [...keys].sort(compareInboxKeys).map((key) => key.id);
    expect(sorted).toEqual([id(5), id(4), id(3), id(2), id(1)]);
  });
});
