import { AlertCircle, CornerDownLeft, Loader2, Zap } from "lucide-react";
import { useEffect } from "react";
import type { QuickReply } from "@/lib/api/types";

interface QuickReplyPickerProps {
  quickReplies: QuickReply[];
  query: string;
  selectedIndex: number;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (quickReply: QuickReply) => void;
  onHighlight: (index: number) => void;
}

export function QuickReplyPicker({
  quickReplies,
  query,
  selectedIndex,
  isLoading,
  hasError,
  onSelect,
  onHighlight,
}: QuickReplyPickerProps) {
  const selectedQuickReply = quickReplies[selectedIndex];

  useEffect(() => {
    if (!selectedQuickReply) return;

    document
      .getElementById(`quick-reply-option-${selectedQuickReply.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedQuickReply]);

  return (
    <div
      id="quick-reply-picker"
      className="absolute bottom-full -left-11 z-40 mb-2 w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_18px_48px_rgba(11,20,26,0.22)] animate-in fade-in-0 slide-in-from-bottom-1 duration-150 sm:left-0 sm:w-full dark:border-white/[0.09] dark:bg-dark-elevated dark:shadow-black/50"
    >
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-[#f7faf8] px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#dff4eb] text-[#008069] dark:bg-emerald-400/10 dark:text-emerald-300">
            <Zap className="size-3.5" fill="currentColor" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#3b4a54] dark:text-dark-text-primary">
              Quick replies
            </p>
            <p className="truncate text-[11px] text-[#667781] dark:text-dark-text-tertiary">
              {query ? `Matching “/${query}”` : "Choose a saved response"}
            </p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[#8696a0] sm:flex dark:text-dark-text-tertiary">
          <span className="rounded border border-black/10 bg-white px-1 py-0.5 font-mono dark:border-white/10 dark:bg-white/5">
            ↑↓
          </span>
          navigate
          <span className="ml-1 rounded border border-black/10 bg-white px-1 py-0.5 font-mono dark:border-white/10 dark:bg-white/5">
            ↵
          </span>
          insert
        </span>
      </div>

      <div
        className="max-h-[280px] overflow-y-auto p-1.5"
        role="listbox"
        aria-label="Quick reply suggestions"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-7 text-sm text-[#667781] dark:text-dark-text-secondary">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading saved replies…
          </div>
        ) : hasError ? (
          <div className="flex items-center justify-center gap-2 px-3 py-7 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="size-4" aria-hidden="true" />
            Quick replies could not be loaded
          </div>
        ) : quickReplies.length === 0 ? (
          <div className="px-4 py-7 text-center">
            <p className="text-sm font-medium text-[#3b4a54] dark:text-dark-text-primary">
              No matching quick reply
            </p>
            <p className="mt-1 text-xs text-[#667781] dark:text-dark-text-secondary">
              Try another shortcut or continue typing your message.
            </p>
          </div>
        ) : (
          quickReplies.map((quickReply, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                id={`quick-reply-option-${quickReply.id}`}
                key={quickReply.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none transition-colors ${
                  isSelected
                    ? "bg-[#e7f5ef] dark:bg-emerald-400/10"
                    : "hover:bg-[#f3f5f4] dark:hover:bg-white/[0.05]"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(quickReply)}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-semibold ${
                    isSelected
                      ? "bg-white text-[#008069] shadow-sm dark:bg-white/10 dark:text-emerald-300"
                      : "bg-[#edf2ef] text-[#54656f] dark:bg-white/[0.06] dark:text-dark-text-secondary"
                  }`}
                >
                  /{quickReply.shortcut}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#263a43] dark:text-dark-text-primary">
                    {quickReply.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[#667781] dark:text-dark-text-secondary">
                    {quickReply.content}
                  </span>
                </span>
                <CornerDownLeft
                  className={`mt-1 size-4 shrink-0 transition-opacity ${
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
