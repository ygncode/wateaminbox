import type { MessageReaction } from "@wateaminbox/shared";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface MessageReactionsProps {
  reactions: MessageReaction[];
  isOwn: boolean;
}

const ALL_REACTIONS = "all";

function formatReactorJid(jid: string): string {
  if (jid === "current-user") return "";
  const [localPart, server] = jid.split("@");
  const identifier = localPart?.split(":")[0] || jid;
  const isPhoneJid = server !== "lid" && server !== "lid.whatsapp.net";
  return /^\d+$/.test(identifier) && isPhoneJid ? `+${identifier}` : identifier;
}

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** Displays compact reaction badges and a WhatsApp-style reactor list. */
export function MessageReactions({ reactions, isOwn }: MessageReactionsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState(ALL_REACTIONS);

  const groupedReactions = useMemo(() => {
    const groups = new Map<string, MessageReaction[]>();
    for (const reaction of reactions) {
      groups.set(reaction.emoji, [
        ...(groups.get(reaction.emoji) || []),
        reaction,
      ]);
    }
    return groups;
  }, [reactions]);

  if (reactions.length === 0) return null;

  const reactionSummary = [...groupedReactions]
    .map(([emoji, reactors]) => `${emoji} ${reactors.length}`)
    .join(", ");
  const visibleReactions = (
    selectedEmoji === ALL_REACTIONS
      ? reactions
      : reactions.filter((reaction) => reaction.emoji === selectedEmoji)
  )
    .slice()
    .sort((a, b) => Number(Boolean(b.isOwn)) - Number(Boolean(a.isOwn)));

  const openReactionDetails = (
    event: React.MouseEvent<HTMLButtonElement>,
    emoji: string,
  ) => {
    event.stopPropagation();
    setSelectedEmoji(emoji);
    setIsOpen(true);
  };

  return (
    <>
      <div
        className={`absolute -bottom-3 ${isOwn ? "left-2" : "right-2"} flex gap-0.5`}
        role="group"
        aria-label={`${t("chat.reactions")}: ${reactionSummary}`}
      >
        {[...groupedReactions].map(([emoji, reactors]) => (
          <button
            type="button"
            key={emoji}
            onClick={(event) => openReactionDetails(event, emoji)}
            className="inline-flex min-h-6 items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-xs tabular-nums shadow-md transition-transform hover:-translate-y-0.5 hover:border-whatsapp-green/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green focus-visible:ring-offset-1 dark:border-dark-border dark:bg-dark-elevated"
            aria-label={t("chat.viewReactionPeople", {
              emoji,
              count: reactors.length,
            })}
            aria-haspopup="dialog"
          >
            <span aria-hidden="true">{emoji}</span>
            {reactors.length > 1 && (
              <span
                className="text-gray-600 dark:text-dark-text-secondary"
                aria-hidden="true"
              >
                {reactors.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-md gap-0 overflow-hidden rounded-xl p-0"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left dark:border-dark-border">
            <DialogTitle>{t("chat.messageReactions")}</DialogTitle>
            <DialogDescription>
              {t("chat.reactionCount", { count: reactions.length })}
            </DialogDescription>
          </DialogHeader>

          <div
            className="flex min-h-12 overflow-x-auto border-b border-gray-100 px-2 dark:border-dark-border"
            role="tablist"
            aria-label={t("chat.filterReactions")}
          >
            <ReactionTab
              label={t("chat.all")}
              isEmoji={false}
              count={reactions.length}
              selected={selectedEmoji === ALL_REACTIONS}
              onSelect={() => setSelectedEmoji(ALL_REACTIONS)}
            />
            {[...groupedReactions].map(([emoji, reactors]) => (
              <ReactionTab
                key={emoji}
                label={emoji}
                isEmoji
                count={reactors.length}
                selected={selectedEmoji === emoji}
                onSelect={() => setSelectedEmoji(emoji)}
              />
            ))}
          </div>

          <div
            className="max-h-[min(55vh,28rem)] overflow-y-auto overscroll-contain py-1"
            role="tabpanel"
          >
            {visibleReactions.map((reaction) => (
              <ReactorRow
                key={`${reaction.reactorJid}-${reaction.emoji}`}
                reaction={reaction}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReactionTab({
  label,
  isEmoji,
  count,
  selected,
  onSelect,
}: {
  label: string;
  isEmoji: boolean;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`relative flex min-w-16 shrink-0 items-center justify-center gap-1.5 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-whatsapp-green ${
        selected
          ? "font-semibold text-whatsapp-dark-green dark:text-whatsapp-green"
          : "text-gray-500 hover:text-gray-800 dark:text-dark-text-secondary dark:hover:text-dark-text-primary"
      }`}
    >
      <span className={isEmoji ? "text-base" : "text-sm"}>{label}</span>
      <span className="text-xs tabular-nums opacity-70">{count}</span>
      {selected && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-whatsapp-green" />
      )}
    </button>
  );
}

function ReactorRow({ reaction }: { reaction: MessageReaction }) {
  const { t } = useTranslation();
  const jidLabel = formatReactorJid(reaction.reactorJid);
  const displayName = reaction.isOwn
    ? t("chat.you")
    : reaction.reactorName?.trim() || jidLabel || t("chat.unknownContact");
  const showJid = Boolean(
    jidLabel && !reaction.isOwn && reaction.reactorName?.trim(),
  );

  return (
    <div className="flex min-h-16 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-dark-tertiary/60">
      <Avatar className="h-10 w-10 ring-1 ring-black/5 dark:ring-white/10">
        {reaction.reactorAvatarUrl && (
          <AvatarImage
            src={reaction.reactorAvatarUrl}
            alt=""
            className="object-cover"
          />
        )}
        <AvatarFallback className="bg-emerald-50 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          {getInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-dark-text-primary">
          {displayName}
        </p>
        {showJid && (
          <p className="truncate text-xs text-gray-500 dark:text-dark-text-secondary">
            {jidLabel}
          </p>
        )}
      </div>
      <span className="text-xl" aria-label={reaction.emoji}>
        {reaction.emoji}
      </span>
    </div>
  );
}
