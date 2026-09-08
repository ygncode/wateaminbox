import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Architectural guardrail for the OAuth consent screen membership-churn fix.
// The page keeps a private `selected` id that can outlive the live
// `useWorkspace().memberships` list (refreshed on focus / poller). The submitted
// `companyId`, the radio `checked` state, and the Connect `disabled` state must
// all be driven by the reconciled `selectedCompanyId` (derived via
// `resolveConsentSelection`), never by the raw `selected` — otherwise a stale
// id could be POSTed and the backend would reject it with 403.

const SOURCE = readFileSync(
  resolve(import.meta.dir, "./OAuthConsentPage.tsx"),
  "utf8",
);

test("OAuthConsentPage reconciles its selection against the live membership list", () => {
  // Derivation is in place.
  expect(SOURCE).toMatch(/resolveConsentSelection/);
  expect(SOURCE).toMatch(/const selectedCompanyId = useMemo\(/);

  // The submitted companyId is the reconciled value, never the raw `selected`.
  // `\b` after `selected` rejects the `selectedCompanyId` continuation, so this
  // only matches the stale `companyId: selected }` / `companyId: selected,` form.
  expect(SOURCE).not.toMatch(/companyId:\s*selected\b/);
  expect(SOURCE).toMatch(/companyId:\s*selectedCompanyId/);

  // The Connect button is gated on the reconciled value.
  expect(SOURCE).not.toMatch(/disabled=\{busy \|\| !selected\b/);
  expect(SOURCE).toMatch(
    /disabled=\{busy \|\| !selectedCompanyId \|\| !client\}/,
  );

  // The radio `checked` state compares against the reconciled value.
  expect(SOURCE).not.toMatch(/=\s*selected\s*===\s*workspace\.id/);
  expect(SOURCE).toMatch(/=\s*selectedCompanyId\s*===\s*workspace\.id/);
});
