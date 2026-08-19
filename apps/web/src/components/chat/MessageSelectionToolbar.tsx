import { useTranslation } from "react-i18next";
interface MessageSelectionToolbarProps {
  selectionMode: boolean;
  selectedCount: number;
  onExit: () => void;
}

export function MessageSelectionToolbar({
  selectionMode,
  selectedCount,
  onExit,
}: MessageSelectionToolbarProps) {
  const { t } = useTranslation();

  if (!selectionMode) return null;

  return (
    <div className="sticky top-0 z-30 bg-whatsapp-teal-green text-white px-4 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-4">
        <button
          onClick={onExit}
          className="p-1 hover:bg-white/10 rounded-full transition-colors"
          aria-label={t("chat.exitSelectionMode", "Exit selection mode")}
        >
          <svg
            className="h-6 w-6"
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
        <span className="font-medium">
          {selectedCount === 0
            ? "Select messages"
            : `${selectedCount} selected`}
        </span>
      </div>
      <span className="text-sm opacity-80">
        {t("chat.pressEscToCancel", "Press ESC to cancel")}
      </span>
    </div>
  );
}
