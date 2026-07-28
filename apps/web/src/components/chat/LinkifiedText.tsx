import { Fragment } from "react";
import type { GroupParticipant } from "@/hooks/useGroups";
import { cn } from "@/lib/utils";

export interface MessageTextSegment {
  type: "text" | "link";
  value: string;
  href?: string;
}

const LINK_PATTERN =
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;:]+$/;
const PHONE_MENTION_PATTERN = /@(\d{5,20})\b/g;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Replace WhatsApp's raw @phone-number mention text with the resolved group
 * participant name. Unknown mentions are deliberately left unchanged.
 */
export function resolveMentionNames(
  text: string,
  participants: Pick<GroupParticipant, "jid" | "phoneNumber" | "displayName">[],
): string {
  if (participants.length === 0 || !text.includes("@")) return text;

  const displayNameByPhone = new Map<string, string>();
  for (const participant of participants) {
    const jidPhone = participant.jid.split("@")[0]?.split(":")[0] || "";
    const phone = digitsOnly(participant.phoneNumber || jidPhone);
    const displayName = participant.displayName.trim().replace(/^@/, "");
    if (phone && displayName) displayNameByPhone.set(phone, displayName);
  }

  return text.replace(PHONE_MENTION_PATTERN, (rawMention, phone: string) => {
    const displayName = displayNameByPhone.get(phone);
    return displayName ? `@${displayName}` : rawMention;
  });
}

function trimTrailingPunctuation(value: string): {
  link: string;
  trailing: string;
} {
  let link = value;
  let trailing = "";
  const simpleMatch = link.match(SIMPLE_TRAILING_PUNCTUATION);
  if (simpleMatch) {
    trailing = simpleMatch[0];
    link = link.slice(0, -trailing.length);
  }

  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  for (const [open, close] of pairs) {
    while (
      link.endsWith(close) &&
      link.split(close).length > link.split(open).length
    ) {
      link = link.slice(0, -1);
      trailing = close + trailing;
    }
  }

  return { link, trailing };
}

function toSafeHref(value: string): string | null {
  const candidate = EMAIL_PATTERN.test(value)
    ? `mailto:${value}`
    : /^https?:\/\//i.test(value)
      ? value
      : `https://${value}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Split untrusted message text into plain text and safe HTTP(S) links. */
export function parseMessageLinks(text: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    const matchedValue = match[0];
    const { link, trailing } = trimTrailingPunctuation(matchedValue);
    const href = toSafeHref(link);
    if (href) {
      segments.push({ type: "link", value: link, href });
    } else {
      segments.push({ type: "text", value: link });
    }
    if (trailing) segments.push({ type: "text", value: trailing });
    cursor = start + matchedValue.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

export function LinkifiedText({
  text,
  isOwn,
  className,
  mentionParticipants = [],
}: {
  text: string;
  isOwn: boolean;
  className?: string;
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "displayName"
  >[];
}) {
  const displayText = resolveMentionNames(text, mentionParticipants);

  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {parseMessageLinks(displayText).map((segment, index) =>
        segment.type === "link" ? (
          <a
            key={`${index}-${segment.value}`}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "rounded-sm font-medium underline decoration-1 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green",
              isOwn
                ? "text-white decoration-white/70 hover:decoration-white"
                : "text-whatsapp-teal-green decoration-whatsapp-teal-green/50 hover:decoration-whatsapp-teal-green",
            )}
          >
            {segment.value}
          </a>
        ) : (
          <Fragment key={`${index}-${segment.value}`}>{segment.value}</Fragment>
        ),
      )}
    </p>
  );
}
