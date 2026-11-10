import { describe, expect, test } from "bun:test";
import type { ContactEvent } from "../../lib/nats/types/index.js";
import { isUnchangedNameOnlyContact } from "./unchanged-contact-name.js";

const names: ContactEvent["payload"] = {
  jid: "100@s.whatsapp.net",
  nameOnly: true,
  fullName: "Saved name",
};

describe("redundant name-only contact replay", () => {
  test("same normalized name requires neither row rewrite nor fan-out", () => {
    expect(
      isUnchangedNameOnlyContact(names, "Saved name", "Saved name", false),
    ).toBe(true);
  });
  test("actual name changes and redacted-name repairs still apply", () => {
    expect(
      isUnchangedNameOnlyContact(names, "Old name", "Saved name", false),
    ).toBe(false);
    expect(isUnchangedNameOnlyContact(names, null, "Saved name", false)).toBe(
      false,
    );
    expect(isUnchangedNameOnlyContact(names, "12***", null, true)).toBe(false);
  });
  test("missing usable name preserves an existing name without a timestamp-only write", () => {
    expect(isUnchangedNameOnlyContact(names, "Existing", null, false)).toBe(
      true,
    );
  });
  test("explicit metadata changes cannot take the name-only shortcut", () => {
    for (const change of [
      { username: "new" },
      { username: "" },
      { username: null },
      { isGroup: false },
      { isGroup: true },
      { profilePictureUrl: "" },
      { profilePictureUrl: "https://example.invalid/avatar" },
    ]) {
      expect(
        isUnchangedNameOnlyContact(
          { ...names, ...change },
          "Saved name",
          "Saved name",
          false,
        ),
      ).toBe(false);
    }
  });
  test("full snapshots retain conversation/group processing", () => {
    expect(
      isUnchangedNameOnlyContact(
        { ...names, nameOnly: false },
        "Saved name",
        "Saved name",
        false,
      ),
    ).toBe(false);
    expect(
      isUnchangedNameOnlyContact(
        { ...names, nameOnly: undefined },
        "Saved name",
        "Saved name",
        false,
      ),
    ).toBe(false);
  });
});
