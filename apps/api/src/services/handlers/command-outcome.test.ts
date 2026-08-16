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
