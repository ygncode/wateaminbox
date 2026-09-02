import { AtSign, CornerDownLeft } from "lucide-react";
import { useEffect } from "react";
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

export function GroupMentionPicker({
  participants,
  query,
  selectedIndex,
  onSelect,
  onHighlight,
}: GroupMentionPickerProps) {
  const { t } = useTranslation();
  const selectedParticipant = participants[selectedIndex];

  useEffect(() => {
    if (!selectedParticipant) return;
    document
      .getElementById(`group-mention-option-${selectedIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, selectedParticipant]);

  return (
    <div
      id="group-mention-picker"
      className="absolute bottom-full -left-11 z-40 mb-2 w-[calc(100vw-1rem)] max-w-md overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_18px_48px_rgba(11,20,26,0.22)] animate-in fade-in-0 slide-in-from-bottom-1 duration-150 sm:left-0 sm:w-full dark:border-white/[0.09] dark:bg-dark-elevated dark:shadow-black/50"
    >
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-[#f7faf8] px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#dff4eb] text-[#008069] dark:bg-emerald-400/10 dark:text-emerald-300">
            <AtSign className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#3b4a54] dark:text-dark-text-primary">
              {t("chat.mentionGroupMember", "Mention a group member")}
            </p>
            <p className="truncate text-[11px] text-[#667781] dark:text-dark-text-tertiary">
              {query
                ? t("chat.mentionMatching", "Matching “@{{query}}”", { query })
                : t("chat.mentionChoose", "Choose who to notify")}
            </p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[#8696a0] sm:flex dark:text-dark-text-tertiary">
          <span className="rounded border border-black/10 bg-white px-1 py-0.5 font-mono dark:border-white/10 dark:bg-white/5">
            ↑↓
          </span>
          {t("chat.mentionNavigate", "navigate")}
          <span className="ml-1 rounded border border-black/10 bg-white px-1 py-0.5 font-mono dark:border-white/10 dark:bg-white/5">
            ↵
          </span>
          {t("chat.mentionInsert", "mention")}
        </span>
      </div>

      <div
        className="max-h-[280px] overflow-y-auto p-1.5"
        role="listbox"
        aria-label={t("chat.mentionSuggestions", "Group member suggestions")}
      >
        {participants.length === 0 ? (
          <div className="px-4 py-7 text-center text-sm text-[#667781] dark:text-dark-text-secondary">
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
                className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors ${
                  isSelected
                    ? "bg-[#e7f5ef] dark:bg-emerald-400/10"
                    : "hover:bg-[#f3f5f4] dark:hover:bg-white/[0.05]"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(participant)}
              >
                <span className="grid size-9 shrink-0 overflow-hidden rounded-full bg-[#dfe5e2] text-xs font-semibold text-[#54656f] dark:bg-white/10 dark:text-dark-text-secondary">
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
                  <span className="block truncate text-sm font-semibold text-[#263a43] dark:text-dark-text-primary">
                    {participant.displayName}
                  </span>
                  {participant.phoneNumber && (
                    <span className="mt-0.5 block truncate text-xs text-[#667781] dark:text-dark-text-secondary">
                      +{participant.phoneNumber}
                    </span>
                  )}
                </span>
                <CornerDownLeft
                  className={`size-4 shrink-0 transition-opacity ${
                    isSelected
                      ? "text-[#008069] opacity-100 dark:text-emerald-300"
                      : "text-[#aebac1] opacity-0 group-hover:opacity-100"
                  }`}
                  aria-hidden="true"
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
