import { Merge, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useMergeContact,
  useMergeSuggestions,
} from "@/hooks/contact/useContactMerge";
import type { MergeSuggestion } from "@/lib/api/contacts";
import type { ContactData } from "./types";

interface MergeSuggestionsSectionProps {
  contact: ContactData;
}

/**
 * Whether the merge section has anything to say.
 *
 * Extracted so the gate is testable on its own: it decides whether a customer
 * is shown a destructive, hard-to-reverse action, and every clause is a
 * deliberate refusal rather than a rendering detail.
 */
export function shouldOfferMergeSuggestions(input: {
  role: string | null | undefined;
  isGroup: boolean;
  isLoading: boolean;
  suggestionCount: number;
}): boolean {
  // Merging is admin/owner only, and the API refuses either way; hiding it
  // keeps a member from being offered an action that can only fail.
  if (input.role !== "owner" && input.role !== "admin") return false;
  // A group is a thread, not a person. The API refuses a group merge outright.
  if (input.isGroup) return false;
  // Never claim "no duplicates" before the answer has arrived.
  if (input.isLoading) return false;
  return input.suggestionCount > 0;
}

/**
 * Candidate duplicate customers, and the action to merge one in.
 *
 * Evidence, not a decision: candidates come only from a shared normalized
 * phone or email, never from a matching name or avatar, because a display-name
 * collision is the most common way two different people look like one. Every
 * merge is operator-initiated and names the surviving customer explicitly.
 */
export function MergeSuggestionsSection({
  contact,
}: MergeSuggestionsSectionProps) {
  const { t } = useTranslation();
  const { activeWorkspace } = useWorkspace();
  const canMerge =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const [pending, setPending] = useState<MergeSuggestion | null>(null);
  const { data: suggestions = [], isLoading } = useMergeSuggestions(
    canMerge && !contact.isGroup ? contact.id : null,
  );
  const merge = useMergeContact();

  if (
    !shouldOfferMergeSuggestions({
      role: activeWorkspace?.role,
      isGroup: Boolean(contact.isGroup),
      isLoading,
      suggestionCount: suggestions.length,
    })
  ) {
    return null;
  }

  const handleConfirm = async () => {
    if (!pending) return;
    try {
      const result = await merge.mutateAsync({
        contactId: contact.id,
        sourceContactId: pending.contactId,
        reason: `Merged from the contact profile: shared ${pending.matchedAddress}`,
      });
      // The merge id is what an admin needs to reverse this, and it is the
      // only place it is ever shown.
      toast.success(
        t("contacts.mergeSucceeded", {
          defaultValue:
            "Merged. {{count}} channel(s) now belong to this contact.",
          count: result.movedEndpoints,
        }),
        {
          description: t("contacts.mergeReference", {
            defaultValue: "Reference for reversing this: {{id}}",
            id: result.mergeEventId,
          }),
          duration: 12_000,
        },
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("contacts.mergeFailed", "Could not merge these contacts"),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <RightPanelSection
        title={t("contacts.mergeSuggestions", "Possible duplicates")}
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "contacts.mergeSuggestionsHint",
              "These customers were seen at the same phone number or email address. Merging keeps every conversation and note exactly where it is.",
            )}
          </p>
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.contactId}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium break-all">
                  {suggestion.matchedAddress}
                </span>
                {suggestion.verified && (
                  <span
                    className="flex shrink-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                    title={t(
                      "contacts.mergeVerifiedHint",
                      "The matching endpoint is verified by the provider",
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t("contacts.mergeVerified", "Verified")}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {suggestion.channels.join(", ")}
                {suggestion.sameChannel
                  ? ` · ${t("contacts.mergeSameChannel", "same channel")}`
                  : ""}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setPending(suggestion)}
                disabled={merge.isPending}
              >
                <Merge className="mr-2 h-4 w-4" />
                {t("contacts.mergeIntoThis", "Merge into this contact")}
              </Button>
            </div>
          ))}
        </div>
      </RightPanelSection>

      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("contacts.mergeConfirmTitle", "Merge these contacts?")}
        description={t("contacts.mergeConfirmBody", {
          defaultValue:
            "The other customer's channels move to this contact and it stops appearing separately. Every conversation, message, note, and tag stays exactly where it is. An admin can reverse this later.",
        })}
        confirmText={t("contacts.mergeConfirmAction", "Merge")}
        onConfirm={handleConfirm}
        isLoading={merge.isPending}
      />
    </>
  );
}
