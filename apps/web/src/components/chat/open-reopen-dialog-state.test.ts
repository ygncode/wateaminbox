import { describe, expect, test } from "bun:test";
import {
  resolveOpenOrReopenMode,
  validateOpenOrReopenReason,
} from "./open-reopen-dialog-state";

describe("resolveOpenOrReopenMode", () => {
  test("a contact with no prior case history gets 'open'", () => {
    expect(resolveOpenOrReopenMode(false)).toBe("open");
  });

  test("a contact with prior case history gets 'reopen'", () => {
    expect(resolveOpenOrReopenMode(true)).toBe("reopen");
  });
});

describe("validateOpenOrReopenReason", () => {
  test("'open' mode never requires a reason - blank is fine", () => {
    expect(validateOpenOrReopenReason("open", "")).toBeNull();
    expect(validateOpenOrReopenReason("open", "   ")).toBeNull();
  });

  test("'open' mode accepts a reason too, if one is given", () => {
    expect(
      validateOpenOrReopenReason("open", "Starting fresh contact"),
    ).toBeNull();
  });

  test("'reopen' mode rejects a blank or whitespace-only reason", () => {
    expect(validateOpenOrReopenReason("reopen", "")).not.toBeNull();
    expect(validateOpenOrReopenReason("reopen", "   ")).not.toBeNull();
  });

  test("'reopen' mode accepts a non-blank reason", () => {
    expect(
      validateOpenOrReopenReason(
        "reopen",
        "Customer followed up outside WhatsApp",
      ),
    ).toBeNull();
  });
});
