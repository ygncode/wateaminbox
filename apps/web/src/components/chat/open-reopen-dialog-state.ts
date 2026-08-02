/**
 * Pure Open/Reopen dialog logic, kept separate from ReopenConversationDialog
 * so it's directly unit-testable without rendering.
 */

export type OpenOrReopenMode = "open" | "reopen";

/**
 * A resolved contact with no prior case gets "Open" (nothing to justify -
 * reason optional); one with a prior, resolved case gets "Reopen" (reason
 * required for auditability). Mirrors the server's own auto-detection in
 * `reopenAsNewCase` (apps/api/src/services/conversation-case.service.ts).
 */
export function resolveOpenOrReopenMode(
  hasCaseHistory: boolean,
): OpenOrReopenMode {
  return hasCaseHistory ? "reopen" : "open";
}

/**
 * Returns a validation error message, or `null` if the reason is
 * acceptable for the given mode. Only "reopen" requires a non-blank reason;
 * "open" never does, since there's no prior case to explain reopening.
 */
export function validateOpenOrReopenReason(
  mode: OpenOrReopenMode,
  reason: string,
): string | null {
  if (mode === "reopen" && !reason.trim()) {
    return "A reason is required to reopen a conversation.";
  }
  return null;
}
