import { Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useMergeHistory,
  useUnmergeContact,
} from "@/hooks/contact/useContactMerge";
import type { MergeHistoryEntry } from "@/lib/api/contacts";
import type { ContactData } from "./types";

interface MergeHistorySectionProps {
  contact: ContactData;
}

/**
 * Whether this customer has a merge worth showing.
 *
 * Extracted so the gate is testable on its own. Unlike the merge actions, this
 * is not hidden behind the workspace merge gate: a workspace that may no
 * longer merge must still be able to see what it already did.
 */
export function shouldShowMergeHistory(input: {
  role: string | null | undefined;
  isLoading: boolean;
  entryCount: number;
}): boolean {
  if (input.role !== "owner" && input.role !== "admin") return false;
  if (input.isLoading) return false;
  return input.entryCount > 0;
}

/**
 * The merges that produced this customer, and the way back.
 *
 * Without this a merge is invisible the moment it happens: the merged-away
 * customer stops appearing in the inbox, search, and every picker, so nobody
 * can tell which records were folded together or undo the wrong one. The
 * reason and the actor are shown because a merge is a judgement, and the
 * person reversing it is usually not the person who made it.
 */
export function MergeHistorySection({ contact }: MergeHistorySectionProps) {
  const { t } = useTranslation();
  const { activeWorkspace } = useWorkspace();
  const canSee =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const { data: merges = [], isLoading } = useMergeHistory(
    canSee ? contact.id : null,
  );
  const [pending, setPending] = useState<MergeHistoryEntry | null>(null);
  const unmerge = useUnmergeContact();

  if (
    !shouldShowMergeHistory({
      role: activeWorkspace?.role,
      isLoading,
      entryCount: merges.length,
    })
  ) {
    return null;
  }

  const handleConfirm = async () => {
    if (!pending) return;
    try {
      const result = await unmerge.mutateAsync({
        mergeEventId: pending.mergeEventId,
        reason: `Reversed from the contact profile: ${pending.reason}`,
      });
      toast.success(
        t("contacts.unmergeSucceeded", {
          defaultValue: "Separated. {{count}} channel(s) moved back.",
          count: result.restoredEndpoints,
        }),
        // An endpoint that a later decision moved on is deliberately left
        // alone, and saying so is the difference between a partial result and
        // a silent one.
        result.skippedEndpoints > 0
          ? {
              description: t("contacts.unmergeSkipped", {
                defaultValue:
                  "{{count}} channel(s) stayed, because something moved them after this merge.",
                count: result.skippedEndpoints,
              }),
              duration: 12_000,
            }
          : undefined,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("contacts.unmergeFailed", "Could not separate these contacts"),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <RightPanelSection
        title={t("contacts.mergeHistoryTitle", "Merged into this contact")}
      >
        <div className="space-y-3">
          {merges.map((entry) => (
            <div
              key={entry.mergeEventId}
              className="rounded-md border border-border p-3 text-sm"
            >
              <span className="block truncate font-medium">
                {entry.sourceName ||
                  t("contacts.mergeHistoryUnnamed", "Unnamed contact")}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(entry.mergedAt).toLocaleDateString()} ·{" "}
                {entry.reason}
              </p>
              {entry.reversible ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setPending(entry)}
                  disabled={unmerge.isPending}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {t("contacts.unmergeAction", "Separate them again")}
                </Button>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(
                    "contacts.unmergeUnavailable",
                    "This one can no longer be reversed - the contact has been merged again since.",
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      </RightPanelSection>

      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("contacts.unmergeConfirmTitle", "Separate these contacts?")}
        description={t("contacts.unmergeConfirmBody", {
          defaultValue:
            "The other customer comes back as its own contact and the channels this merge moved return to it. Conversations were never combined, so none of them move. A channel that something else moved since stays where it is.",
        })}
        confirmText={t("contacts.unmergeConfirmAction", "Separate")}
        onConfirm={handleConfirm}
        isLoading={unmerge.isPending}
      />
    </>
  );
}
