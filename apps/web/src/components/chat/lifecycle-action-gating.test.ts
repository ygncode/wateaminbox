import { describe, expect, test } from "bun:test";
import { isResolveActionDisabled } from "./lifecycle-action-gating";

describe("isResolveActionDisabled", () => {
  test("enabled when idle (no send in flight, no resolve in flight)", () => {
    expect(
      isResolveActionDisabled({
        isSending: false,
        resolveMutationPending: false,
      }),
    ).toBe(false);
  });

  test("disabled while a send for this contact is in flight - closes the race that caused a valid reply to be rejected as unanswered", () => {
    expect(
      isResolveActionDisabled({
        isSending: true,
        resolveMutationPending: false,
      }),
    ).toBe(true);
  });

  test("disabled while the resolve mutation itself is already in flight (prevents a double-submit)", () => {
    expect(
      isResolveActionDisabled({
        isSending: false,
        resolveMutationPending: true,
      }),
    ).toBe(true);
  });

  test("disabled when both are in flight", () => {
    expect(
      isResolveActionDisabled({
        isSending: true,
        resolveMutationPending: true,
      }),
    ).toBe(true);
  });
});
