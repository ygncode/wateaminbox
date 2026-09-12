import { ChevronRight, Merge, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
      {/* Beeper-style prompt: the operator is being offered one thing - to see
          these chats as one customer - so the row says that, and the detail
          that earned the suggestion sits under it rather than above it in a
          paragraph nobody reads twice. */}
      <div className="mt-2 space-y-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.contactId}
            type="button"
            onClick={() => setPending(suggestion)}
            disabled={merge.isPending}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-2.5 py-2 text-left transition-colors hover:bg-black/[0.03] disabled:opacity-60 dark:border-dark-border dark:hover:bg-white/[0.04]"
          >
            <Merge
              className="size-4 shrink-0 text-whatsapp-teal-green"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-gray-900 dark:text-dark-text-primary">
                {t(
                  "contacts.mergeSuggestionPrompt",
                  "View all these chats together",
                )}
              </span>
              <span className="block truncate text-[11px] text-gray-500 dark:text-dark-text-tertiary">
                {suggestion.matchedAddress} · {suggestion.channels.join(", ")}
                {suggestion.sameChannel
                  ? ` · ${t("contacts.mergeSameChannel", "same channel")}`
                  : ""}
              </span>
            </span>
            {suggestion.verified && (
              <ShieldCheck
                className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-label={t(
                  "contacts.mergeVerifiedHint",
                  "The matching endpoint is verified by the provider",
                )}
              />
            )}
            <ChevronRight
              className="size-4 shrink-0 opacity-50"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>

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
