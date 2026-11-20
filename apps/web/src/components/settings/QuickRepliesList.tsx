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
      <div className="flex items-center justify-center rounded-xl border border-line bg-subtle py-10">
        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" />
      </div>
    );
  }

  if (quickReplies.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-subtle px-5 py-10 text-center text-fg-muted">
        <Zap className="h-12 w-12 mx-auto mb-3 text-fg-subtle" />
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
