import { describe, expect, mock, test } from "bun:test";
import { coalesceContactListRead } from "./contact-list-inflight.js";
import type { GetContactsWithLastMessageOptions } from "./contact.service.js";

const empty = () => ({ contacts: [], total: 0 });

describe("pending contact list reads", () => {
  test("a duplicate burst shares work, but a settled result is never cached", async () => {
    const database = {};
    const deferred = Promise.withResolvers<ReturnType<typeof empty>>();
    const load = mock(() => deferred.promise);
    const requests = Array.from({ length: 100 }, () =>
      coalesceContactListRead(
        database,
        "workspace-a",
        { userId: "alice" },
        load,
      ),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(requests).size).toBe(1);
    deferred.resolve(empty());
    await Promise.all(requests);

    await coalesceContactListRead(
      database,
      "workspace-a",
      { userId: "alice" },
      load,
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("option property order does not prevent sharing", async () => {
    const database = {};
    const load = mock(async () => empty());
    const first = coalesceContactListRead(
      database,
      "a",
      { userId: "alice", limit: 50 },
      load,
    );
    const second = coalesceContactListRead(
      database,
      "a",
      { limit: 50, userId: "alice" },
      load,
    );
    expect(first).toBe(second);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("assignment-restricted requests always evaluate live visibility", async () => {
    const database = {};
    const load = mock(async () => empty());
    const options = { userId: "alice", restrictToAssigned: true };
    await Promise.all([
      coalesceContactListRead(database, "a", options, load),
      coalesceContactListRead(database, "a", options, load),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("different workspaces and database/transaction handles never share", async () => {
    const database = {};
    const load = mock(async () => empty());
    await Promise.all([
      coalesceContactListRead(database, "a", {}, load),
      coalesceContactListRead(database, "b", {}, load),
      coalesceContactListRead({}, "a", {}, load),
    ]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  const differences: GetContactsWithLastMessageOptions[] = [
    { userId: "bob" },
    { restrictToAssigned: true },
    { assignedToMe: true },
    { unassigned: true },
    { search: "Ada" },
    { limit: 1 },
    { offset: 1 },
    { includeGroups: true },
    { connectionId: "account-a" },
    { tagIds: ["tag-a"] },
    { conversationStatus: "open" },
    { unreadOnly: true },
  ];
  for (const difference of differences) {
    test(`does not share a different ${Object.keys(difference)[0]}`, async () => {
      const database = {};
      const load = mock(async () => empty());
      await Promise.all([
        coalesceContactListRead(database, "a", { userId: "alice" }, load),
        coalesceContactListRead(
          database,
          "a",
          { userId: "alice", ...difference },
          load,
        ),
      ]);
      expect(load).toHaveBeenCalledTimes(2);
    });
  }

  test("a rejected read is shared only while pending, then can be retried", async () => {
    const database = {};
    const deferred = Promise.withResolvers<ReturnType<typeof empty>>();
    const load = mock(() => deferred.promise);
    const first = coalesceContactListRead(database, "a", {}, load);
    const second = coalesceContactListRead(database, "a", {}, load);
    const outcomes = Promise.allSettled([first, second]);
    deferred.reject(new Error("database unavailable"));
    expect((await outcomes).map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(
      await coalesceContactListRead(database, "a", {}, async () => empty()),
    ).toEqual(empty());
  });

  test("a synchronous loader failure cannot poison the next read", async () => {
    const database = {};
    expect(() =>
      coalesceContactListRead(database, "a", {}, () => {
        throw new Error("failed before querying");
      }),
    ).toThrow("failed before querying");
    expect(
      await coalesceContactListRead(database, "a", {}, async () => empty()),
    ).toEqual(empty());
  });
});
