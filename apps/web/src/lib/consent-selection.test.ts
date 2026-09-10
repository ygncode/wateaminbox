import { describe, expect, test } from "bun:test";
import { resolveConsentSelection } from "./consent-selection";

const membership = (id: string): { id: string } => ({ id });

describe("resolveConsentSelection", () => {
  test("keeps an existing selection that is still in the list", () => {
    expect(
      resolveConsentSelection("acme", [
        membership("acme"),
        membership("northwind"),
      ]),
    ).toBe("acme");
    expect(
      resolveConsentSelection("northwind", [
        membership("acme"),
        membership("northwind"),
      ]),
    ).toBe("northwind");
  });

  test("keeps the selection while the list grows around it", () => {
    expect(resolveConsentSelection("acme", [membership("acme")])).toBe("acme");
    expect(
      resolveConsentSelection("acme", [
        membership("acme"),
        membership("northwind"),
      ]),
    ).toBe("acme");
  });

  test("auto-selects the lone workspace when nothing is chosen", () => {
    expect(resolveConsentSelection(null, [membership("acme")])).toBe("acme");
  });

  test("leaves the choice unset when several workspaces are available and none chosen", () => {
    expect(
      resolveConsentSelection(null, [
        membership("acme"),
        membership("northwind"),
      ]),
    ).toBeNull();
  });

  test("returns null when there are no workspaces", () => {
    expect(resolveConsentSelection(null, [])).toBeNull();
    expect(resolveConsentSelection("acme", [])).toBeNull();
  });

  test("drops a stale selection when its workspace leaves a multi-workspace list", () => {
    // The list shrank from [acme, northwind] to [northwind, globex]: acme is gone
    // and more than one workspace remains, so require an explicit pick.
    expect(
      resolveConsentSelection("acme", [
        membership("northwind"),
        membership("globex"),
      ]),
    ).toBeNull();
  });

  test("auto-selects the single remaining workspace after the chosen one is removed", () => {
    // The 2 -> 1 transition the consent screen actually hits on tab return:
    // the chosen acme is gone, only northwind remains.
    expect(resolveConsentSelection("acme", [membership("northwind")])).toBe(
      "northwind",
    );
  });

  test("does not switch to a different workspace when the chosen one is still present", () => {
    expect(
      resolveConsentSelection("acme", [
        membership("acme"),
        membership("northwind"),
      ]),
    ).toBe("acme");
  });

  test("drops to null when the chosen workspace is removed leaving several behind", () => {
    expect(
      resolveConsentSelection("acme", [
        membership("northwind"),
        membership("globex"),
      ]),
    ).toBeNull();
    expect(
      resolveConsentSelection("acme", [
        membership("northwind"),
        membership("globex"),
        membership("initech"),
      ]),
    ).toBeNull();
  });

  test("auto-selects whichever single workspace remains regardless of order", () => {
    expect(resolveConsentSelection("removed", [membership("acme")])).toBe(
      "acme",
    );
    expect(resolveConsentSelection("removed", [membership("northwind")])).toBe(
      "northwind",
    );
  });

  test("matches ids exactly, without fuzzy comparison", () => {
    expect(resolveConsentSelection("Acme", [membership("acme")])).toBe("acme");
    expect(resolveConsentSelection(" acme", [membership("acme")])).toBe("acme");
    expect(resolveConsentSelection("acme", [membership("ACME")])).toBe("ACME");
  });
});
