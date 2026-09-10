import type { CompanyWithRole } from "@wateaminbox/shared";

/**
 * Reconcile the OAuth consent screen's selected workspace id against the live
 * membership list.
 *
 * `useWorkspace().memberships` is refreshed on every window `focus` event and
 * on a 5-minute poller, wholesale replacing the list while the consent page
 * stays mounted. The page keeps its own selection separate from the context's
 * `activeWorkspaceId`; left unchecked, a choice made before the list shrank
 * (workspace deletion or membership removal) could remain selected after its
 * workspace is gone, and submitting that stale id was rejected by the backend
 * with `403 "You are not a member of that workspace"`.
 *
 * Keep an existing selection while it is still in the list, fall back to the
 * single remaining workspace (saving a click, matching the original
 * single-workspace auto-select), and otherwise drop to `null` so the user must
 * pick again from the cards that are actually shown.
 */
export function resolveConsentSelection(
  selected: string | null,
  memberships: Pick<CompanyWithRole, "id">[],
): string | null {
  if (
    selected &&
    memberships.some((membership) => membership.id === selected)
  ) {
    return selected;
  }
  return memberships.length === 1 ? memberships[0].id : null;
}
