import type { MessageReaction } from "@whatsapp-web/shared";

interface MessageReactionsProps {
  reactions: MessageReaction[];
  isOwn: boolean;
}

/**
 * Displays grouped reactions for a message
 */
export function MessageReactions({ reactions, isOwn }: MessageReactionsProps) {
  if (!reactions || reactions.length === 0) {
    return null;
  }

  // Group reactions by emoji and count them
  const groupedReactions = reactions.reduce(
    (acc, r) => {
      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div
      className={`absolute -bottom-3 ${isOwn ? "left-2" : "right-2"} flex gap-0.5`}
    >
      {Object.entries(groupedReactions).map(([emoji, count]) => (
        <span
          key={emoji}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white dark:bg-dark-elevated rounded-full shadow-md text-xs border border-gray-200 dark:border-dark-border"
          title={`${count} reaction${count > 1 ? "s" : ""}`}
        >
          <span>{emoji}</span>
          {count > 1 && (
            <span className="text-gray-600 dark:text-dark-text-secondary">
              {count}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
