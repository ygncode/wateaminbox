export interface MentionPreviewParticipant {
  displayName: string;
  mentionIds: readonly string[];
}

const NUMERIC_MENTION_PATTERN = /(^|[\s([{])@(\d{5,20})\b/g;

export function getNumericMentionIds(content: string | null): string[] {
  if (!content?.includes("@")) return [];
  return [
    ...new Set(
      [...content.matchAll(NUMERIC_MENTION_PATTERN)].map((match) => match[2]),
    ),
  ];
}

/** Keep the inbox payload small: include identities used by its last message. */
export function selectMentionPreviewParticipants<
  T extends MentionPreviewParticipant,
>(content: string | null, participants: readonly T[]): T[] {
  const ids = new Set(getNumericMentionIds(content));
  if (ids.size === 0) return [];
  return participants.filter((participant) =>
    participant.mentionIds.some((mentionId) => ids.has(mentionId)),
  );
}
