import { AlertCircle, CornerDownLeft, Loader2, Zap } from "lucide-react";
import { useEffect } from "react";
import type { QuickReply } from "@/lib/api/types";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

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
      className="absolute bottom-full -start-11 z-40 mb-2 w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-2xl border border-line/[0.08] bg-surface shadow-lg animate-in fade-in-0 slide-in-from-bottom-1 duration-150 sm:start-0 sm:w-full"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line/[0.06] bg-subtle px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Zap className="size-3.5" fill="currentColor" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-fg">
              {t("quickReplies.pickerTitle", "Quick replies")}
            </p>
            <p className="truncate text-[11px] text-fg-muted">
              {query
                ? t("chat.matchingShortcut", { query })
                : t("chat.chooseSavedResponse")}
            </p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-fg-muted sm:flex">
          <span className="rounded border border-line/10 bg-surface px-1 py-0.5 font-mono">
            ↑↓
          </span>
          navigate
          <span className="ms-1 rounded border border-line/10 bg-surface px-1 py-0.5 font-mono">
            ↵
          </span>
          insert
        </span>
      </div>

      <div
        className="max-h-[280px] overflow-y-auto p-1.5"
        role="listbox"
        aria-label={t("quickReplies.suggestions", "Quick reply suggestions")}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-7 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("quickReplies.loading", "Loading saved replies…")}
          </div>
        ) : hasError ? (
          <div className="flex items-center justify-center gap-2 px-3 py-7 text-sm text-danger">
            <AlertCircle className="size-4" aria-hidden="true" />
            {t("quickReplies.loadFailed", "Quick replies could not be loaded")}
          </div>
        ) : quickReplies.length === 0 ? (
          <div className="px-4 py-7 text-center">
            <p className="text-sm font-medium text-fg">
              {t("quickReplies.noMatch", "No matching quick reply")}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {t(
                "quickReplies.noMatchHint",
                "Try another shortcut or continue typing your message.",
              )}
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
                className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-start outline-none transition-colors ${
                  isSelected ? "bg-accent-soft" : "hover:bg-muted"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(quickReply)}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-semibold ${
                    isSelected
                      ? "bg-surface text-accent shadow-sm"
                      : "bg-muted text-fg-muted"
                  }`}
                >
                  /{quickReply.shortcut}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {quickReply.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-fg-muted">
                    {quickReply.content}
                  </span>
                </span>
                <CornerDownLeft
                  className={`mt-1 size-4 shrink-0 transition-opacity ${
                    isSelected
                      ? "text-accent opacity-100"
                      : "text-fg-subtle opacity-0 group-hover:opacity-100"
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
