import { describe, expect, test } from "bun:test";
import { withDeadlockRetry } from "./backfill";

function pgError(code: string): Error & { code: string } {
  return Object.assign(new Error(`postgres ${code}`), { code });
}

const emptyResult = () => ({
  accountsProcessed: 0,
  contactsProcessed: 0,
  messagesProcessed: 0,
  workflowsProcessed: 0,
  blockedRows: 0,
});

describe("withDeadlockRetry", () => {
  test("retries a deadlock, which is the database resolving a conflict rather than a failure", async () => {
    let attempts = 0;
    const value = await withDeadlockRetry(async () => {
      attempts++;
      if (attempts < 3) throw pgError("40P01");
      return "done";
    });

    expect(value).toBe("done");
    expect(attempts).toBe(3);
  });

  test("retries a serialization failure for the same reason", async () => {
    let attempts = 0;
    await withDeadlockRetry(async () => {
      attempts++;
      if (attempts < 2) throw pgError("40001");
    });

    expect(attempts).toBe(2);
  });

  test("rolls the tallies back so a retried batch is not counted twice", async () => {
    // The counters are incremented per row inside the transaction, and the
    // transaction rolled back whole, so the counts have to roll back with it.
    const result = emptyResult();
    let attempts = 0;
    await withDeadlockRetry(async () => {
      attempts++;
      result.messagesProcessed += 250;
      if (attempts < 3) throw pgError("40P01");
    }, result);

    expect(attempts).toBe(3);
    expect(result.messagesProcessed).toBe(250);
  });

  test("never retries an error that is not a lock conflict", async () => {
    // A constraint violation or a missing parent is a real problem. Retrying
    // it would spin instead of surfacing it.
    let attempts = 0;
    await expect(
      withDeadlockRetry(async () => {
        attempts++;
        throw pgError("23505");
      }),
    ).rejects.toThrow("postgres 23505");
    expect(attempts).toBe(1);
  });

  test("gives up rather than retrying a permanent deadlock for ever", async () => {
    let attempts = 0;
    await expect(
      withDeadlockRetry(
        async () => {
          attempts++;
          throw pgError("40P01");
        },
        undefined,
        3,
      ),
    ).rejects.toThrow("postgres 40P01");
    expect(attempts).toBe(3);
  });
});
