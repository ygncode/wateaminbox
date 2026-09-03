import { useMessageActions } from "@/contexts/message-actions-context";
import type { GroupParticipant } from "@/hooks/useGroups";
import { cn } from "@/lib/utils";
import { Fragment, type ReactNode } from "react";
import {
  type MentionParticipant,
  resolveMentionSegments,
} from "./group-mentions";

export { resolveMentionNames } from "./group-mentions";

export interface MessageTextSegment {
  type: "text" | "link";
  value: string;
  href?: string;
}

const LINK_PATTERN =
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;:]+$/;
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
  enableInteractions = true,
  trailing,
}: {
  text: string;
  isOwn: boolean;
  className?: string;
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "mentionIds" | "displayName" | "contactId"
  >[];
  /** Disable nested controls when rendered inside another interactive element. */
  enableInteractions?: boolean;
  /**
   * Rendered inside the paragraph, after the text. A right-floated node put
   * here lands on the last line when it fits and drops to its own line when
   * it does not - which is how the bubble timestamp sits beside short
   * messages instead of always claiming a row of its own. It has to be part
   * of this inline formatting context to do that, so it is passed in rather
   * than rendered next to the paragraph.
   */
  trailing?: ReactNode;
}) {
  const { onOpenParticipantProfile } = useMessageActions();
  const resolvedSegments = resolveMentionSegments(
    text,
    mentionParticipants as MentionParticipant[],
  );

  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words",
        trailing && "after:block after:clear-both after:content-['']",
        className,
      )}
    >
      {resolvedSegments.map((resolved, resolvedIndex) => {
        if (resolved.type === "mention" && resolved.participant) {
          const contactId = resolved.participant.contactId;
          const mentionClassName = cn(
            "mx-0.5 inline rounded-[0.3rem] px-1 py-0.5 font-semibold",
            isOwn
              ? "bg-[#0b6b57]/12 text-[#075e54] dark:bg-[#d9fdd3]/15 dark:text-[#d9fdd3]"
              : "bg-[#00a884]/12 text-[#087f69] dark:bg-[#53bdeb]/15 dark:text-[#53bdeb]",
          );
          return enableInteractions && contactId && onOpenParticipantProfile ? (
            <button
              key={`${resolvedIndex}-${resolved.value}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenParticipantProfile(contactId);
              }}
              aria-label={`Open ${resolved.displayValue}'s contact info`}
              className={cn(
                mentionClassName,
                "cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green",
              )}
            >
              {resolved.displayValue}
            </button>
          ) : (
            <span
              key={`${resolvedIndex}-${resolved.value}`}
              className={mentionClassName}
            >
              {resolved.displayValue}
            </span>
          );
        }

        return parseMessageLinks(resolved.value).map((segment, index) =>
          segment.type === "link" && enableInteractions ? (
            <a
              key={`${resolvedIndex}-${index}-${segment.value}`}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "rounded-sm font-medium underline decoration-1 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green",
                isOwn
                  ? "text-current decoration-current/60 hover:decoration-current"
                  : "text-whatsapp-teal-green decoration-whatsapp-teal-green/50 hover:decoration-whatsapp-teal-green dark:text-[#53bdeb] dark:decoration-[#53bdeb]/50",
              )}
            >
              {segment.value}
            </a>
          ) : (
            <Fragment key={`${resolvedIndex}-${index}-${segment.value}`}>
              {segment.value}
            </Fragment>
          ),
        );
      })}
      {trailing}
    </p>
  );
}
