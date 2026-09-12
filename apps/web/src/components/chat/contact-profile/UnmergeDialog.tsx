import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useMergeHistory,
  useUnmergeContact,
} from "@/hooks/contact/useContactMerge";
import type { MergeHistoryEntry } from "@/lib/api/contacts";
import type { ContactData } from "./types";

interface UnmergeDialogProps {
  contact: ContactData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Split a merged customer back into separate contacts.
 *
 * One merge is the common case and is asked as a plain question, because that
 * is what the operator is actually deciding: whether these chats stay
 * together. Several merges cannot be asked that way - each one moved
 * different channels and only the operator knows which was the mistake - so
 * they are listed and reversed one at a time.
 *
 * A merge that something has since merged again cannot be reversed, and says
 * so rather than offering a button that can only fail.
 */
export function UnmergeDialog({
  contact,
  open,
  onOpenChange,
}: UnmergeDialogProps) {
  const { t } = useTranslation();
  const all = useMergeHistory(open ? contact.id : null).data ?? [];
  // A reversed merge keeps its event as history; offering it here would be an
  // action that can only fail. Only merges still in effect are listed.
  const merges = all.filter((entry) => entry.reversible);
  const unmerge = useUnmergeContact();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const single = merges.length === 1 ? merges[0] : null;

  const run = async (entry: MergeHistoryEntry) => {
    setPendingId(entry.mergeEventId);
    try {
      const result = await unmerge.mutateAsync({
        mergeEventId: entry.mergeEventId,
        reason: `Reversed from the contact profile: ${entry.reason}`,
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
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("contacts.unmergeFailed", "Could not separate these contacts"),
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("contacts.unmergeDialogTitle", "Unmerge chats?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "contacts.unmergeDialogBody",
              "This splits the merged customer back into separate contacts and moves their channels back. No conversation moves - each chat has always been its own thread.",
            )}
          </DialogDescription>
        </DialogHeader>

        {!single && (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {merges.map((entry) => (
              <li
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
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => run(entry)}
                  disabled={unmerge.isPending}
                >
                  {pendingId === entry.mergeEventId
                    ? t("contacts.unmergeInProgress", "Separating...")
                    : t("contacts.unmergeAction", "Separate them again")}
                </Button>
              </li>
            ))}
            {merges.length === 0 && (
              <li className="text-sm text-muted-foreground">
                {t("contacts.unmergeNothing", "Nothing has been merged in.")}
              </li>
            )}
          </ul>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={unmerge.isPending}
          >
            {t("contacts.unmergeKeep", "Keep chats merged")}
          </Button>
          {single && (
            <Button
              variant="destructive"
              onClick={() => run(single)}
              disabled={unmerge.isPending}
            >
              {unmerge.isPending
                ? t("contacts.unmergeInProgress", "Separating...")
                : t("contacts.unmergeConfirmAction", "Unmerge")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
