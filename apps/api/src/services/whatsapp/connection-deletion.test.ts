import { describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";
import { deleteConnectionWithKill } from "./connection.js";

function transactionWithConnection(exists = true) {
  let deleteCalls = 0;
  const builder = {
    selectFrom: () => builder,
    select: () => builder,
    where: () => builder,
    forUpdate: () => builder,
    executeTakeFirst: async () =>
      exists ? { id: "connection-1", status: "connected" } : undefined,
    deleteFrom: () => {
      deleteCalls++;
      return builder;
    },
    execute: async () => undefined,
  };
  return {
    trx: builder as unknown as Transaction<TenantDatabase>,
    deleteCalls: () => deleteCalls,
  };
}

describe("atomic connection deletion", () => {
  test("does not delete when the kill enqueue crash point fails", async () => {
    const state = transactionWithConnection();
    await expect(
      deleteConnectionWithKill(
        state.trx,
        "company-1",
        "connection-1",
        async () => {
          throw new Error("simulated outbox failure");
        },
      ),
    ).rejects.toThrow("simulated outbox failure");
    expect(state.deleteCalls()).toBe(0);
  });

  test("enqueues kill before deletion and treats a missing row idempotently", async () => {
    const calls: string[] = [];
    const state = transactionWithConnection();
    expect(
      await deleteConnectionWithKill(
        state.trx,
        "company-1",
        "connection-1",
        async () => {
          calls.push("enqueue");
        },
      ),
    ).toBe(true);
    expect(calls).toEqual(["enqueue"]);
    expect(state.deleteCalls()).toBe(1);

    const missing = transactionWithConnection(false);
    expect(
      await deleteConnectionWithKill(
        missing.trx,
        "company-1",
        "connection-1",
        async () => {
          throw new Error("must not enqueue");
        },
      ),
    ).toBe(false);
    expect(missing.deleteCalls()).toBe(0);
  });
});
