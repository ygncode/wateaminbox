import { Ban, Loader2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useBlockContact } from "@/hooks/contact";

interface BlockedContactBarProps {
  contactId: string;
  /** Display name of the blocked contact, used only for the toast copy. */
  contactName?: string;
}

/**
 * Replaces the composer entirely while the contact is blocked - a hard
 * outbound invariant, not a UI preference: the API's `requireSendAccess`
 * throws ContactBlockedError for every interactive send/attach/forward/
 * retry/react/typing path, so a composer here could only ever produce a
 * rejected send.
 *
 * Unblocking reuses `useBlockContact` (the same mutation the contact
 * profile's Block Status section uses), so the optimistic update,
 * rollback-on-error, and cache invalidation all behave identically no
 * matter which surface the action is taken from. The success path needs no
 * local state: the invalidated contact query flips `isBlocked`, which
 * flips this component back to the real composer.
 */
export function BlockedContactBar({
  contactId,
  contactName,
}: BlockedContactBarProps) {
  const { t } = useTranslation();
  const descriptionId = useId();

  const blockContact = useBlockContact();

  const handleUnblock = () => {
    blockContact.mutate(
      { contactId, isBlocked: false },
      {
        onSuccess: () =>
          toast.success(
            contactName
              ? t("chat.unblockSuccessNamed", {
                  defaultValue: "{{name}} is unblocked",
                  name: contactName,
                })
              : t("chat.unblockSuccess", "Contact unblocked"),
          ),
        // Deliberately NOT surfacing `error.message`: unblock failures come
        // back as raw server/WhatsApp text ("Contact not found", protocol
        // errors) that is untranslated and means nothing to an agent. The
        // sibling AssignmentGateBar forwards raw text, but takeover errors
        // are a small, human-meaningful set; these are not. The detail is
        // kept in the console for debugging instead.
        onError: (error) => {
          console.error("Failed to unblock contact:", error);
          toast.error(t("chat.unblockError", "Could not unblock this contact"));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex items-start gap-2.5 sm:items-center">
        <span
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-danger-soft text-danger ring-1 ring-danger sm:mt-0"
          aria-hidden="true"
        >
          <Ban className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">
            {t("chat.contactBlocked", "This contact is blocked")}
          </p>
          <p id={descriptionId} className="text-xs leading-5 text-fg-subtle">
            {t(
              "chat.contactBlockedHint",
              "You can't send messages until you unblock them.",
            )}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleUnblock}
        disabled={blockContact.isPending}
        aria-describedby={descriptionId}
        aria-busy={blockContact.isPending}
        className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {blockContact.isPending && (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        )}
        {blockContact.isPending
          ? t("chat.unblocking", "Unblocking...")
          : t("chat.unblockContact", "Unblock contact")}
      </button>
    </div>
  );
}
