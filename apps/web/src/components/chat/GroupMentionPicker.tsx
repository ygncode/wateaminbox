import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { MentionParticipant } from "./group-mentions";

interface GroupMentionPickerProps {
  participants: MentionParticipant[];
  query: string;
  selectedIndex: number;
  onSelect: (participant: MentionParticipant) => void;
  onHighlight: (index: number) => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** WhatsApp only needs the number when the visible name is not a saved name. */
export function shouldShowMentionPhoneNumber(
  participant: Pick<MentionParticipant, "displayName" | "phoneNumber">,
): boolean {
  if (!participant.phoneNumber) return false;
  const displayName = participant.displayName.trim();
  return (
    displayName.startsWith("~") ||
    digitsOnly(displayName) === digitsOnly(participant.phoneNumber)
  );
}

export function GroupMentionPicker({
  participants,
  query,
  selectedIndex,
  onSelect,
  onHighlight,
}: GroupMentionPickerProps) {
  const { t } = useTranslation();
  const selectedParticipant = participants[selectedIndex];
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const option = document.getElementById(
      `group-mention-option-${selectedIndex}`,
    );
    if (!selectedParticipant || !list || !option) return;

    // Keep keyboard navigation inside this list. scrollIntoView can also move
    // the page horizontally when the picker sits near a mobile viewport edge.
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    if (optionTop < list.scrollTop) {
      list.scrollTop = optionTop;
    } else if (optionBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = optionBottom - list.clientHeight;
    }
  }, [selectedIndex, selectedParticipant]);

  return (
    <div
      id="group-mention-picker"
      className="absolute inset-x-0 bottom-full z-40 mb-2 min-w-0 overflow-hidden rounded-[1.15rem] border border-black/[0.07] bg-white shadow-[0_14px_38px_rgba(11,20,26,0.2)] animate-in fade-in-0 slide-in-from-bottom-1 duration-150 sm:right-auto sm:w-[28rem] dark:border-white/[0.08] dark:bg-[#202c33] dark:shadow-black/50"
    >
      <div
        ref={listRef}
        className="scrollbar-hide relative max-h-[min(20rem,45dvh)] overflow-x-hidden overflow-y-auto overscroll-contain py-1.5"
        role="listbox"
        aria-label={
          query
            ? t("chat.mentionMatching", "Matching “@{{query}}”", { query })
            : t("chat.mentionSuggestions", "Group member suggestions")
        }
      >
        {participants.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#667781] dark:text-dark-text-secondary">
            {t("chat.noMentionMatch", "No matching group member")}
          </div>
        ) : (
          participants.map((participant, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                id={`group-mention-option-${index}`}
                key={participant.jid}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`group flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left outline-none transition-colors sm:px-3.5 ${
                  isSelected
                    ? "bg-[#edf3f1] dark:bg-white/[0.055]"
                    : "hover:bg-[#f3f5f4] dark:hover:bg-white/[0.04]"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(participant)}
              >
                <span className="grid size-10 shrink-0 overflow-hidden rounded-full bg-[#dfe5e2] text-xs font-semibold text-[#54656f] dark:bg-white/10 dark:text-dark-text-secondary">
                  {participant.profilePictureUrl ? (
                    <img
                      src={participant.profilePictureUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="m-auto">
                      {initials(participant.displayName) || "@"}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium leading-5 text-[#263a43] dark:text-dark-text-primary">
                    {participant.displayName}
                  </span>
                  {shouldShowMentionPhoneNumber(participant) && (
                    <span className="mt-0.5 block truncate text-[13px] leading-4 text-[#667781] dark:text-dark-text-secondary">
                      +{participant.phoneNumber}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
