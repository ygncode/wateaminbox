import { ChevronDown, ChevronUp, History } from "lucide-react";
import { useState } from "react";
import { dayjs } from "@whatsapp-web/shared";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAssignmentHistory } from "@/hooks/useContact";
import { cn } from "@/lib/utils";

interface AssignmentHistorySectionProps {
  contactId: string;
}

/**
 * Assignment history section - shows past assignments
 */
export function AssignmentHistorySection({
  contactId,
}: AssignmentHistorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { renderState } = useAsyncData(useAssignmentHistory(contactId));

  return (
    <RightPanelSection title="Assignment History">
      {renderState({
        loading: () => <Skeleton className="h-12 w-full" />,
        error: () => (
          <div className="flex items-center gap-2 text-red-400 dark:text-red-500">
            <History className="h-4 w-4" />
            <p className="text-sm">Failed to load history</p>
          </div>
        ),
        empty: () => (
          <div className="flex items-center gap-2 text-gray-400 dark:text-dark-text-tertiary">
            <History className="h-4 w-4" />
            <p className="text-sm italic">No assignment history</p>
          </div>
        ),
        success: (history) => {
          const displayedHistory = isExpanded ? history : history.slice(0, 3);

          return (
            <>
              <div className="space-y-2">
                {displayedHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg p-2 text-sm",
                      entry.isActive
                        ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                        : "bg-gray-50 dark:bg-dark-elevated",
                    )}
                  >
                    <div className="mt-0.5">
                      <History
                        className={cn(
                          "h-4 w-4",
                          entry.isActive
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-400 dark:text-dark-text-tertiary",
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 font-medium text-gray-800 dark:text-dark-text-primary min-w-0">
                        <span className="truncate min-w-0 flex-1">
                          {entry.assignedToName}
                        </span>
                        {entry.isActive && (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs flex-shrink-0"
                          >
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                        Assigned by {entry.assignedByName}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-dark-text-tertiary">
                        {dayjs(entry.assignedAt).format("MMM D")} at{" "}
                        {dayjs(entry.assignedAt).format("HH:mm")}
                        {entry.unassignedAt && (
                          <>
                            {" -> "}
                            {dayjs(entry.unassignedAt).format("MMM D")} at{" "}
                            {dayjs(entry.unassignedAt).format("HH:mm")}
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {history.length > 3 && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-1 mt-2 text-xs text-whatsapp-teal-green hover:text-whatsapp-dark-green font-medium"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Show all ({history.length} entries)
                    </>
                  )}
                </button>
              )}
            </>
          );
        },
      })}
    </RightPanelSection>
  );
}
