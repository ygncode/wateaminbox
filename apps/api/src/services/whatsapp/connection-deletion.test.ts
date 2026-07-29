import { describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";
import { archiveConnectionWithUnlink } from "./connection.js";

function transactionWithConnection(exists = true) {
  let updateCalls = 0;
  const builder = {
    selectFrom: () => builder,
    select: () => builder,
    where: () => builder,
    orderBy: () => builder,
    forUpdate: () => builder,
    executeTakeFirst: async () =>
      exists
        ? { id: "connection-1", status: "connected", archived_at: null }
        : undefined,
    updateTable: () => {
      updateCalls++;
      return builder;
    },
    set: () => builder,
    execute: async () => undefined,
  };
  return {
    trx: builder as unknown as Transaction<TenantDatabase>,
    updateCalls: () => updateCalls,
  };
}

describe("atomic connection archive and unlink", () => {
  test("does not archive when the unlink enqueue crash point fails", async () => {
    const state = transactionWithConnection();
    await expect(
      archiveConnectionWithUnlink(
        state.trx,
        "company-1",
        "connection-1",
        async () => {
          throw new Error("simulated outbox failure");
        },
      ),
    ).rejects.toThrow("simulated outbox failure");
    expect(state.updateCalls()).toBe(0);
  });

  test("enqueues unlink before archiving and treats a missing row idempotently", async () => {
    const calls: string[] = [];
    const state = transactionWithConnection();
    expect(
      await archiveConnectionWithUnlink(
        state.trx,
        "company-1",
        "connection-1",
        async () => {
          calls.push("enqueue");
        },
      ),
    ).toBe(true);
    expect(calls).toEqual(["enqueue"]);
    expect(state.updateCalls()).toBe(2);

    const missing = transactionWithConnection(false);
    expect(
      await archiveConnectionWithUnlink(
        missing.trx,
        "company-1",
        "connection-1",
        async () => {
          throw new Error("must not enqueue");
        },
      ),
    ).toBe(false);
    expect(missing.updateCalls()).toBe(0);
  });
});
