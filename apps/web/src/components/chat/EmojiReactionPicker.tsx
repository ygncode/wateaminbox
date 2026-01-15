import { useEffect, useRef, useState } from "react";

interface EmojiReactionPickerProps {
  onSelectReaction: (emoji: string) => void;
  onClose: () => void;
  position: { x: number; y: number };
}

// Popular WhatsApp-style reactions
const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👍"];

// Extended emoji palette organized by category
const EMOJI_CATEGORIES = {
  "Smileys & People": [
    "😀",
    "😃",
    "😄",
    "😁",
    "😆",
    "😅",
    "🤣",
    "😂",
    "🙂",
    "🙃",
    "😉",
    "😊",
    "😇",
    "🥰",
    "😍",
    "🤩",
    "😘",
    "😗",
    "☺️",
    "😚",
    "😙",
    "🥲",
    "😋",
    "😛",
    "😜",
    "🤪",
    "😝",
    "🤑",
    "🤗",
    "🤭",
    "🤫",
    "🤔",
    "🤐",
    "🤨",
    "😐",
    "😑",
    "😶",
    "😏",
    "😒",
    "🙄",
    "😬",
    "🤥",
    "😌",
    "😔",
    "😪",
    "🤤",
    "😴",
    "😷",
    "🤒",
    "🤕",
    "🤢",
    "🤮",
    "🤧",
    "🥵",
    "🥶",
    "😶‍🌫️",
    "🥴",
    "😵",
    "🤯",
    "🤠",
    "🥳",
    "🥸",
    "😎",
    "🤓",
    "🧐",
    "😕",
    "😟",
    "🙁",
    "☹️",
    "😮",
    "😯",
    "😲",
    "😳",
    "🥺",
    "😦",
    "😧",
    "😨",
    "😰",
    "😥",
    "😢",
    "😭",
    "😱",
    "😖",
    "😣",
    "😞",
    "😓",
    "😩",
    "😫",
    "🥱",
    "😤",
    "😡",
    "😠",
    "🤬",
    "😈",
    "👿",
    "💀",
    "☠️",
    "💩",
    "🤡",
    "👹",
    "👺",
    "👻",
    "👽",
    "👾",
    "🤖",
    "😺",
    "😸",
    "😹",
    "😻",
    "😼",
    "😽",
    "🙀",
    "😿",
    "😾",
  ],
  "Gestures & Body": [
    "👋",
    "🤚",
    "🖐️",
    "✋",
    "🖖",
    "👌",
    "🤌",
    "🤏",
    "✌️",
    "🤞",
    "🤟",
    "🤘",
    "🤙",
    "👈",
    "👉",
    "👆",
    "🖕",
    "👇",
    "☝️",
    "👍",
    "👎",
    "✊",
    "👊",
    "🤛",
    "🤜",
    "👏",
    "🙌",
    "👐",
    "🤲",
    "🤝",
    "🙏",
    "✍️",
    "💅",
    "🤳",
    "💪",
    "🦾",
    "🦿",
    "🦵",
    "🦶",
  ],
  "Hearts & Love": [
    "❤️",
    "🧡",
    "💛",
    "💚",
    "💙",
    "💜",
    "🖤",
    "🤍",
    "🤎",
    "💔",
    "❤️‍🔥",
    "❤️‍🩹",
    "💕",
    "💞",
    "💓",
    "💗",
    "💖",
    "💘",
    "💝",
    "💟",
    "💌",
    "💋",
    "💏",
    "💑",
  ],
  "Objects & Symbols": [
    "🎉",
    "🎊",
    "🎈",
    "🎁",
    "🏆",
    "🥇",
    "🥈",
    "🥉",
    "⚽",
    "🏀",
    "🏈",
    "⚾",
    "🎾",
    "🏐",
    "🏉",
    "🥏",
    "🎱",
    "🏓",
    "🏸",
    "🏒",
    "🏑",
    "🥍",
    "🏏",
    "🥅",
    "⚡",
    "🔥",
    "✨",
    "💫",
    "⭐",
    "🌟",
    "💥",
    "💢",
    "✅",
    "❌",
    "❓",
    "❗",
    "💯",
    "🔔",
    "🔕",
    "📢",
  ],
};

export function EmojiReactionPicker({
  onSelectReaction,
  onClose,
  position,
}: EmojiReactionPickerProps) {
  const [showExtended, setShowExtended] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<string>("Smileys & People");
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep picker within viewport
  useEffect(() => {
    if (pickerRef.current) {
      const rect = pickerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      // Check right boundary
      if (rect.right > viewportWidth) {
        adjustedX = position.x - (rect.right - viewportWidth) - 10;
      }

      // Check left boundary
      if (rect.left < 0) {
        adjustedX = 10;
      }

      // Check bottom boundary
      if (rect.bottom > viewportHeight) {
        adjustedY = position.y - rect.height - 10;
      }

      // Check top boundary
      if (rect.top < 0) {
        adjustedY = 10;
      }

      setAdjustedPosition({ x: adjustedX, y: adjustedY });
    }
  }, [position]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [onClose]);

  const handleReactionClick = (emoji: string) => {
    onSelectReaction(emoji);
    onClose();
  };

  return (
    <div
      ref={pickerRef}
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-150"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
      role="dialog"
      aria-label="Emoji reaction picker"
    >
      {!showExtended ? (
        /* Quick reactions bar */
        <div
          className="bg-white dark:bg-dark-elevated rounded-full shadow-2xl px-2 py-2 flex items-center gap-1 border border-gray-200 dark:border-dark-border"
          role="toolbar"
          aria-label="Quick reactions"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleReactionClick(emoji)}
              className="w-10 h-10 flex items-center justify-center text-2xl hover:scale-125 transition-transform duration-150 hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-full"
              title={emoji}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            onClick={() => setShowExtended(true)}
            className="w-10 h-10 flex items-center justify-center text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-full transition-colors ml-1"
            title="More reactions"
            aria-label="Show more reactions"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      ) : (
        /* Extended emoji picker */
        <div className="bg-white dark:bg-dark-elevated rounded-2xl shadow-2xl border border-gray-200 dark:border-dark-border overflow-hidden w-80">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-dark-border">
            <button
              onClick={() => setShowExtended(false)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-full transition-colors"
              title="Back to quick reactions"
            >
              <svg
                className="w-5 h-5 text-gray-600 dark:text-dark-text-secondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h3 className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
              Pick a reaction
            </h3>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-full transition-colors"
              title="Close"
            >
              <svg
                className="w-5 h-5 text-gray-600 dark:text-dark-text-secondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1 px-2 py-2 border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-secondary overflow-x-auto">
            {Object.keys(EMOJI_CATEGORIES).map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  selectedCategory === category
                    ? "bg-whatsapp-green text-white"
                    : "text-gray-600 dark:text-dark-text-secondary hover:bg-gray-200 dark:hover:bg-dark-tertiary"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Emoji grid */}
          <div className="p-3 max-h-64 overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_CATEGORIES[
                selectedCategory as keyof typeof EMOJI_CATEGORIES
              ]?.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReactionClick(emoji)}
                  className="w-9 h-9 flex items-center justify-center text-2xl hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg transition-colors"
                  title={emoji}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EmojiReactionPicker;
