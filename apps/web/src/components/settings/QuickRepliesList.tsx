import { Loader2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QuickReply } from "@/lib/api/types";
import { QuickReplyCard } from "./QuickReplyCard";

interface QuickRepliesListProps {
  quickReplies: QuickReply[];
  isLoading: boolean;
  hasSearchQuery: boolean;
  onEdit: (qr: QuickReply) => void;
  onDelete: (id: string) => void;
}

/**
 * Quick Replies List Component
 * Displays a list of quick replies with loading and empty states
 */
export function QuickRepliesList({
  quickReplies,
  isLoading,
  hasSearchQuery,
  onEdit,
  onDelete,
}: QuickRepliesListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-[#e2e8e3] bg-[#f8faf8] py-10 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-dark-text-tertiary" />
      </div>
    );
  }

  if (quickReplies.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d6dfd9] bg-[#f8faf8] px-5 py-10 text-center text-gray-500 dark:border-white/[0.1] dark:bg-white/[0.025] dark:text-dark-text-secondary">
        <Zap className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-dark-text-tertiary" />
        <p className="font-medium">
          {hasSearchQuery
            ? t("quickReplies.noResults", "No quick replies found")
            : t("quickReplies.empty", "No quick replies yet")}
        </p>
        <p className="text-sm mt-1">
          {hasSearchQuery
            ? t(
                "quickReplies.tryDifferentSearch",
                "Try a different search term",
              )
            : t(
                "quickReplies.createFirst",
                "Create your first quick reply to get started",
              )}
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-2 max-h-[400px] overflow-y-auto"
      data-testid="quick-replies-list"
    >
      {quickReplies.map((qr) => (
        <QuickReplyCard
          key={qr.id}
          quickReply={qr}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
