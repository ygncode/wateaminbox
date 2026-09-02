import type { GroupParticipant } from "@/hooks/useGroups";

export type MentionParticipant = Pick<
  GroupParticipant,
  "jid" | "phoneNumber" | "mentionIds" | "displayName" | "contactId"
> &
  Partial<Pick<GroupParticipant, "profilePictureUrl" | "isSelf">>;

export interface SelectedMention {
  jid: string;
  displayName: string;
}

export interface ActiveMentionToken {
  start: number;
  end: number;
  query: string;
}

export interface ResolvedMentionSegment {
  type: "text" | "mention";
  value: string;
  displayValue?: string;
  participant?: MentionParticipant;
}

const PHONE_MENTION_PATTERN = /(^|[\s([{])@(\d{5,20})\b/g;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function displayMentionName(participant: MentionParticipant): string {
  return participant.displayName.trim().replace(/^@/, "");
}

export function getParticipantMentionJid(
  participant: MentionParticipant,
): string | null {
  const [rawUser = "", server = ""] = participant.jid.trim().split("@");
  const user = rawUser.split(":")[0];
  if (!/^\d{5,20}$/.test(user)) return null;
  if (!["s.whatsapp.net", "lid", "hosted.lid"].includes(server)) return null;
  return `${user}@${server}`;
}

function buildParticipantByMentionId(
  participants: MentionParticipant[],
): Map<string, MentionParticipant> {
  const participantByMentionId = new Map<string, MentionParticipant>();
  for (const participant of participants) {
    if (!displayMentionName(participant)) continue;

    const jidMentionId = participant.jid.split("@")[0]?.split(":")[0] || "";
    const mentionIds = [
      jidMentionId,
      participant.phoneNumber || "",
      ...(participant.mentionIds ?? []),
    ];
    for (const mentionId of mentionIds) {
      const normalizedMentionId = digitsOnly(mentionId);
      if (normalizedMentionId) {
        participantByMentionId.set(normalizedMentionId, participant);
      }
    }
  }
  return participantByMentionId;
}

/** Resolve WhatsApp's numeric mention tokens without losing their identity. */
export function resolveMentionSegments(
  text: string,
  participants: MentionParticipant[],
): ResolvedMentionSegment[] {
  if (participants.length === 0 || !text.includes("@")) {
    return [{ type: "text", value: text }];
  }

  const participantByMentionId = buildParticipantByMentionId(participants);
  const segments: ResolvedMentionSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PHONE_MENTION_PATTERN)) {
    const prefix = match[1];
    const rawMention = match[0].slice(prefix.length);
    const start = (match.index ?? 0) + prefix.length;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    const participant = participantByMentionId.get(match[2]);
    if (participant) {
      segments.push({
        type: "mention",
        value: rawMention,
        displayValue: `@${displayMentionName(participant)}`,
        participant,
      });
    } else {
      segments.push({ type: "text", value: rawMention });
    }
    cursor = start + rawMention.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

export function resolveMentionNames(
  text: string,
  participants: MentionParticipant[],
): string {
  return resolveMentionSegments(text, participants)
    .map((segment) => segment.displayValue ?? segment.value)
    .join("");
}

/** The @token immediately before the caret, if the caret is in one. */
export function getActiveMentionToken(
  text: string,
  caretPosition: number,
): ActiveMentionToken | null {
  const beforeCaret = text.slice(0, caretPosition);
  const match = beforeCaret.match(/(?:^|\s)@([^@\s\n]*)$/);
  if (!match || match.index === undefined) return null;

  const atOffset = match[0].indexOf("@");
  return {
    start: match.index + atOffset,
    end: caretPosition,
    query: match[1].trimStart(),
  };
}

export function filterMentionParticipants(
  participants: MentionParticipant[],
  query: string,
  limit = 8,
): MentionParticipant[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return participants
    .filter((participant) => getParticipantMentionJid(participant) !== null)
    .filter((participant) => !participant.isSelf)
    .filter((participant) => {
      if (!normalizedQuery) return true;
      return [participant.displayName, participant.phoneNumber, participant.jid]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    })
    .slice(0, limit);
}

export function insertMention(
  text: string,
  token: ActiveMentionToken,
  participant: MentionParticipant,
): { text: string; caret: number; selected: SelectedMention } | null {
  const jid = getParticipantMentionJid(participant);
  const name = displayMentionName(participant);
  if (!jid || !name) return null;

  const insertion = `@${name} `;
  const nextText = `${text.slice(0, token.start)}${insertion}${text.slice(token.end)}`;
  return {
    text: nextText,
    caret: token.start + insertion.length,
    selected: { jid, displayName: name },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert the friendly composer labels into WhatsApp's numeric mention text. */
export function serializeMentionsForSend(
  text: string,
  selectedMentions: SelectedMention[],
): { content: string; mentionedJids: string[] } {
  let content = text;
  const mentionedJids: string[] = [];

  for (const mention of selectedMentions) {
    const mentionId = mention.jid.split("@")[0]?.split(":")[0];
    if (!mentionId || !/^\d{5,20}$/.test(mentionId)) continue;

    const pattern = new RegExp(
      `(^|[\\s([{])@${escapeRegExp(mention.displayName)}(?=$|[\\s.,!?;:)\\]}])`,
      "g",
    );
    let used = false;
    content = content.replace(pattern, (_match, prefix: string) => {
      used = true;
      return `${prefix}@${mentionId}`;
    });
    if (used && !mentionedJids.includes(mention.jid)) {
      mentionedJids.push(mention.jid);
    }
  }

  return { content, mentionedJids };
}
