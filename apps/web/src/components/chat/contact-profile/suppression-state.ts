import type { ContactSuppressionStatus } from "@/hooks/contact/useContactSuppression";

/** What the Block and mute section shows for a customer. */
export type SuppressionView =
  | { kind: "blocked"; showNotEnforced: boolean }
  | { kind: "muted"; expiresAt: string | null; showNotEnforced: boolean }
  | { kind: "active" };

/**
 * Decide the panel state from the per-channel status, falling back to the
 * contact's own flag while the status is loading (so a WhatsApp-blocked
 * contact never flashes as "Not blocked"). A block outranks a mute.
 */
export function resolveSuppressionView(
  status: ContactSuppressionStatus | undefined,
  contactIsBlocked: boolean,
): SuppressionView {
  const blocked = status
    ? status.blocked || contactIsBlocked
    : contactIsBlocked;
  const notEnforced = status ? !status.enforced : false;
  if (blocked) return { kind: "blocked", showNotEnforced: notEnforced };
  if (status?.muted) {
    return {
      kind: "muted",
      expiresAt: status.muted.expiresAt,
      showNotEnforced: notEnforced,
    };
  }
  return { kind: "active" };
}
