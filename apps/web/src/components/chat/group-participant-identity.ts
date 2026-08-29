import type { GroupParticipant } from "@/hooks/useGroups";

/**
 * Resolving a message sender back to the group member who sent it.
 *
 * A bubble only carries the sender's WhatsApp identity, which may arrive as a
 * plain phone JID, a device-suffixed JID, or a private LID - three spellings of
 * the same person. The group participant list already carries every spelling
 * the server could map (`mentionIds`), so matching happens on the same digit
 * tokens `resolveMentionNames` uses for @mentions rather than on raw strings.
 */

export type ParticipantIdentity = Pick<
  GroupParticipant,
  "jid" | "phoneNumber" | "mentionIds" | "contactId"
>;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Every digit token that identifies one participant. */
function identityTokens(participant: ParticipantIdentity): string[] {
  const jidToken = participant.jid.split("@")[0]?.split(":")[0] || "";
  return [
    jidToken,
    participant.phoneNumber || "",
    ...(participant.mentionIds ?? []),
  ]
    .map(digitsOnly)
    .filter(Boolean);
}

/**
 * The workspace contact for a sender identity, or null when the sender is not
 * a resolvable member - an unmapped LID, a group JID, or somebody nobody holds
 * a contact record for. Callers must treat null as "not clickable" rather than
 * rendering a control that would open an empty panel.
 */
export function resolveParticipantContactId(
  senderIdentity: string | null | undefined,
  participants: readonly ParticipantIdentity[],
): string | null {
  if (!senderIdentity || senderIdentity.endsWith("@g.us")) return null;

  const senderToken = digitsOnly(
    senderIdentity.split("@")[0]?.split(":")[0] || "",
  );
  if (!senderToken) return null;

  for (const participant of participants) {
    if (!participant.contactId) continue;
    if (identityTokens(participant).includes(senderToken)) {
      return participant.contactId;
    }
  }
  return null;
}
