import { describe, expect, mock, test } from "bun:test";

/**
 * How a command outcome is presented to the user.
 *
 * The distinction under test is not cosmetic: "WhatsApp action failed" on a
 * change that WhatsApp actually applied tells someone to redo work that has
 * already happened. The choice must come from the typed `outcome` field, never
 * from inspecting the error text.
 */

const broadcasts: Array<{ event: string; payload: Record<string, unknown> }> =
  [];

mock.module("../../lib/realtime.js", () => ({
  broadcastToCompany: (
    _companyId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => {
    broadcasts.push({ event, payload });
    return Promise.resolve();
  },
}));

/**
 * Contact fan-out and the tenant database, stubbed so the rollback below can be
 * observed without one.
 *
 * `tenantState` is what the fake database answers with; `contactBroadcasts` and
 * `updates` are what the handler did.
 */
const contactBroadcasts: Array<{
  contactId: string;
  event: string;
  payload: Record<string, unknown>;
}> = [];

mock.module("../message-broadcast.service.js", () => ({
  broadcastToContactViewers: (
    _companyId: string,
    contactId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => {
    contactBroadcasts.push({ contactId, event, payload });
    return Promise.resolve();
  },
}));

type WhereClause = [string, string, unknown];

interface ContactRow {
  id: string;
  jid: string;
  custom_name: string | null;
  push_name: string | null;
  phone_number: string | null;
}

const tenantState: {
  outboxRow: { payload: Record<string, unknown>; created_at: Date } | undefined;
  /**
   * Rows the conditional update matches, i.e. rows it actually reverts.
   *
   * The fake does not evaluate the predicates - the test says what the update
   * matched and then asserts the predicates that would have produced it.
   */
  updatedRows: ContactRow[];
  updates: Array<{ set: Record<string, unknown>; where: WhereClause[] }>;
  outboxLookups: string[];
} = {
  outboxRow: undefined,
  updatedRows: [],
  updates: [],
  outboxLookups: [],
};

function fakeTenantDb() {
  return {
    selectFrom(_table: string) {
      return {
        select() {
          return this;
        },
        where(_column: string, _op: string, value: unknown) {
          tenantState.outboxLookups.push(String(value));
          return this;
        },
        executeTakeFirst() {
          return Promise.resolve(tenantState.outboxRow);
        },
      };
    },
    updateTable(_table: string) {
      const update: { set: Record<string, unknown>; where: WhereClause[] } = {
        set: {},
        where: [],
      };
      tenantState.updates.push(update);
      return {
        set(values: Record<string, unknown>) {
          update.set = values;
          return this;
        },
        where(column: string, op: string, value: unknown) {
          update.where.push([column, op, value]);
          return this;
        },
        returning() {
          return this;
        },
        execute() {
          return Promise.resolve(tenantState.updatedRows);
        },
      };
    },
  };
}

mock.module("../tenant.service.js", () => ({
  getTenantConnection: () => fakeTenantDb(),
}));

const { handleCommandResultEvent } = await import("./business-handlers.js");

type Outcome = "succeeded" | "failed" | "applied_not_synced";

function resultEvent(outcome: Outcome | undefined, error: string) {
  return {
    contractVersion: 1 as const,
    type: "command_result" as const,
    companyId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload: {
      commandId: crypto.randomUUID(),
      commandType: "group_promote_admin",
      success: false,
      ...(outcome ? { outcome } : {}),
      error,
    },
  };
}

async function toastFor(outcome: Outcome | undefined, error: string) {
  broadcasts.length = 0;
  await handleCommandResultEvent(resultEvent(outcome, error));
  const toast = broadcasts.find(
    (entry) => entry.event === "notification:toast",
  );
  if (!toast) throw new Error("no toast was broadcast");
  return toast.payload as { type: string; title: string; message: string };
}

describe("command outcome presentation", () => {
  test("a change WhatsApp applied is not reported as a failure", async () => {
    const toast = await toastFor(
      "applied_not_synced",
      "The change was applied on WhatsApp, but this workspace could not be refreshed.",
    );
    expect(toast.type).toBe("warning");
    expect(toast.title).not.toContain("failed");
    expect(toast.title).toContain("applied");
  });

  test("a refused command is reported as a failure", async () => {
    const toast = await toastFor(
      "failed",
      "WhatsApp did not add: 2@s.whatsapp.net",
    );
    expect(toast.type).toBe("error");
    expect(toast.title).toBe("WhatsApp action failed");
  });

  test("an event without an outcome still reports a failure", async () => {
    // Workers deployed before outcomes existed omit the field; the safe
    // reading of `success: false` alone is still "it failed".
    const toast = await toastFor(undefined, "boom");
    expect(toast.type).toBe("error");
    expect(toast.title).toBe("WhatsApp action failed");
  });

  test("presentation ignores the message text entirely", async () => {
    // Same wording, opposite outcomes: only the typed field may decide.
    const message = "identical wording for both outcomes";
    const applied = await toastFor("applied_not_synced", message);
    const failed = await toastFor("failed", message);
    expect(applied.message).toBe(failed.message);
    expect(applied.type).not.toBe(failed.type);
    expect(applied.title).not.toBe(failed.title);
  });

  test("a successful command produces no toast at all", async () => {
    broadcasts.length = 0;
    await handleCommandResultEvent({
      ...resultEvent("succeeded", ""),
      payload: {
        commandId: crypto.randomUUID(),
        commandType: "group_promote_admin",
        success: true,
        outcome: "succeeded" as const,
      },
    });
    expect(broadcasts).toEqual([]);
  });
});

/**
 * A failed blocklist command must not leave the workspace saying "blocked".
 *
 * PATCH /contacts/:id writes `contacts.is_blocked` in the same transaction that
 * queues the command, so the indicator is on before WhatsApp has been asked. In
 * the reported incident every delivery of `block_contact` failed and nothing
 * undid that write: the UI showed the contact blocked while their messages kept
 * arriving. The write has to be reverted when the command is known to have
 * failed.
 */

const CONTACT_JID = "15550000001@s.whatsapp.net";

function contactRow(): ContactRow {
  return {
    id: crypto.randomUUID(),
    jid: CONTACT_JID,
    custom_name: "Blocked Person",
    push_name: null,
    phone_number: "15550000001",
  };
}

function blocklistEvent(
  commandType: "block_contact" | "unblock_contact",
  outcome: Outcome = "failed",
) {
  return {
    contractVersion: 1 as const,
    type: "command_result" as const,
    companyId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload: {
      commandId: crypto.randomUUID(),
      commandType,
      success: false,
      outcome,
      error: "info query returned status 400: bad-request",
    },
  };
}

/** When the failed command was queued. Fixed so assertions can name it. */
const COMMAND_QUEUED_AT = new Date("2026-08-22T10:00:00.000Z");

/**
 * Evaluate the where-clauses the handler built against a candidate row.
 *
 * Asserting the clause list alone only proves the handler wrote a predicate,
 * not that the predicate excludes what it has to. Running it over rows lets a
 * test state the outcome - this row is reverted, that one is left alone -
 * which is the property that actually matters.
 */
function matchesUpdate(
  where: WhereClause[],
  base: Record<string, unknown>,
): (overrides: Record<string, unknown>) => boolean {
  return (overrides) => {
    const row = { ...base, ...overrides };
    return where.every(([column, op, value]) => {
      const actual = row[column];
      if (op === "=") return actual === value;
      if (op === "<=") return (actual as Date) <= (value as Date);
      throw new Error(`the fake does not implement operator ${op}`);
    });
  };
}

function resetTenantState(rows: ContactRow[] = []) {
  broadcasts.length = 0;
  contactBroadcasts.length = 0;
  tenantState.outboxRow = {
    payload: { contact_jid: CONTACT_JID },
    created_at: COMMAND_QUEUED_AT,
  };
  tenantState.updatedRows = rows;
  tenantState.updates = [];
  tenantState.outboxLookups = [];
}

describe("optimistic block state after a failed command", () => {
  test("a failed block clears the local blocked flag", async () => {
    const row = contactRow();
    resetTenantState([row]);

    await handleCommandResultEvent(blocklistEvent("block_contact"));

    expect(tenantState.updates).toHaveLength(1);
    expect(tenantState.updates[0].set.is_blocked).toBe(false);
    const viewerEvent = contactBroadcasts.find(
      (entry) => entry.event === "contact:updated",
    );
    expect(viewerEvent?.contactId).toBe(row.id);
    expect(viewerEvent?.payload.isBlocked).toBe(false);
    expect(viewerEvent?.payload.event).toBe("unblocked");
  });

  test("a failed unblock restores the local blocked flag", async () => {
    const row = contactRow();
    resetTenantState([row]);

    await handleCommandResultEvent(blocklistEvent("unblock_contact"));

    expect(tenantState.updates[0].set.is_blocked).toBe(true);
    const viewerEvent = contactBroadcasts.find(
      (entry) => entry.event === "contact:updated",
    );
    expect(viewerEvent?.payload.isBlocked).toBe(true);
    expect(viewerEvent?.payload.event).toBe("blocked");
  });

  test("the revert is scoped to the row the failed command wrote", async () => {
    resetTenantState([contactRow()]);

    const event = blocklistEvent("block_contact");
    await handleCommandResultEvent(event);

    // The command payload is read back by its own id, and the contact is found
    // by connection and JID - a JID alone names a different person per account.
    expect(tenantState.outboxLookups).toEqual([event.payload.commandId]);
    expect(tenantState.updates[0].where).toEqual([
      ["whatsapp_connection_id", "=", event.connectionId],
      ["jid", "=", CONTACT_JID],
      // Only while the row still holds what the failed command wrote. Anything
      // else means a later change already decided, and it outranks this.
      ["is_blocked", "=", true],
      // And only while that value is still this command's own write - see the
      // stale-command test below.
      ["updated_at", "<=", COMMAND_QUEUED_AT],
    ]);
  });

  /**
   * The value alone cannot tell two blocks apart.
   *
   * Block A fails slowly. Meanwhile the user unblocks and blocks again, and
   * block B succeeds - so when A's failure finally arrives, `is_blocked` is
   * `true` for B's reasons and equals what A was aiming for. Reverting on the
   * value alone would clear it, showing the contact unblocked in a workspace
   * where WhatsApp has them blocked: the same drift this rollback exists to
   * prevent, pointing the other way.
   *
   * The time fence is what separates them. PATCH stamps `contacts.updated_at`
   * and enqueues in one transaction, stamping the outbox row after, so A's
   * write satisfies `updated_at <= A.created_at` and B's - made later - does
   * not.
   */
  test("a later successful block is not undone by an older failed one", async () => {
    resetTenantState([contactRow()]);
    const blockA = blocklistEvent("block_contact");
    const blockAQueuedAt = new Date("2026-08-22T10:00:00.000Z");
    tenantState.outboxRow = {
      payload: { contact_jid: CONTACT_JID },
      created_at: blockAQueuedAt,
    };

    await handleCommandResultEvent(blockA);

    const matches = matchesUpdate(tenantState.updates[0].where, {
      whatsapp_connection_id: blockA.connectionId,
      jid: CONTACT_JID,
      is_blocked: true,
    });

    // A's own write: stamped just before A was queued, in the same
    // transaction. This is the row the rollback exists for.
    expect(
      matches({ updated_at: new Date(blockAQueuedAt.getTime() - 1) }),
    ).toBe(true);
    expect(matches({ updated_at: blockAQueuedAt })).toBe(true);

    // Block B's write, made while A was still in flight. `is_blocked` is
    // identical, so only the time fence can exclude it - and it must, or the
    // revert would unblock a contact WhatsApp has blocked.
    expect(
      matches({ updated_at: new Date(blockAQueuedAt.getTime() + 300_000) }),
    ).toBe(false);
  });

  test("a command with no queued row left to fence against is not reverted", async () => {
    // The outbox row is gone, so there is no way to tell this command's own
    // write from a later one. An unfenced revert is worse than none.
    resetTenantState([contactRow()]);
    tenantState.outboxRow = undefined;

    await handleCommandResultEvent(blocklistEvent("block_contact"));

    expect(tenantState.updates).toEqual([]);
    expect(contactBroadcasts).toEqual([]);
  });

  test("a row a later change already moved is left alone", async () => {
    // The conditional update matches nothing, so there is nothing to announce.
    resetTenantState([]);

    await handleCommandResultEvent(blocklistEvent("block_contact"));

    expect(tenantState.updates).toHaveLength(1);
    expect(contactBroadcasts).toEqual([]);
  });

  test("a change WhatsApp applied is never reverted", async () => {
    resetTenantState([contactRow()]);

    await handleCommandResultEvent(
      blocklistEvent("block_contact", "applied_not_synced"),
    );

    // The block happened on WhatsApp; only the read-back failed. Undoing the
    // column here would put the workspace back out of step with WhatsApp.
    expect(tenantState.updates).toEqual([]);
    expect(contactBroadcasts).toEqual([]);
  });

  test("a successful block is left untouched", async () => {
    resetTenantState([contactRow()]);

    await handleCommandResultEvent({
      ...blocklistEvent("block_contact"),
      payload: {
        commandId: crypto.randomUUID(),
        commandType: "block_contact",
        success: true,
        outcome: "succeeded" as const,
      },
    });

    expect(tenantState.updates).toEqual([]);
    expect(contactBroadcasts).toEqual([]);
  });

  test("a command whose payload names no contact changes nothing", async () => {
    resetTenantState([contactRow()]);
    tenantState.outboxRow = {
      payload: {},
      created_at: COMMAND_QUEUED_AT,
    };

    await handleCommandResultEvent(blocklistEvent("unblock_contact"));

    expect(tenantState.updates).toEqual([]);
    expect(contactBroadcasts).toEqual([]);
  });

  test("the user is still told the action failed", async () => {
    resetTenantState([contactRow()]);

    await handleCommandResultEvent(blocklistEvent("block_contact"));

    const toast = broadcasts.find(
      (entry) => entry.event === "notification:toast",
    );
    expect(toast?.payload.type).toBe("error");
    expect(toast?.payload.title).toBe("WhatsApp action failed");
  });
});
