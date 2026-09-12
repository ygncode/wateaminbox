import { Merge, Search } from "lucide-react";
import { isChannel } from "@wateaminbox/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/contexts/workspace-context";
import { useMergeContact } from "@/hooks/contact/useContactMerge";
import { useForwardContacts } from "@/hooks/useForwardContacts";
import { formatPhoneLikeText } from "@/lib/utils";
import type { Chat } from "@/types/chat";
import { ChannelBadge } from "../ChannelIdentity";
import type { ContactData } from "./types";

interface ManualMergeSectionProps {
  contact: ContactData;
}

/** The word an admin types to confirm. Deliberately not localized. */
const CONFIRM_WORD = "MERGE";

/**
 * Whether an admin may be offered a merge with a contact of their choosing.
 *
 * Manual merge has no evidence behind it - it is entirely the operator's
 * judgement - so the gate is stricter than the suggestion list: the workspace
 * must actually be allowed to execute merges, rather than merely allowed to
 * look at candidates.
 */
export function shouldOfferManualMerge(input: {
  role: string | null | undefined;
  isGroup: boolean;
  mergeEnabled: boolean | undefined;
}): boolean {
  if (input.role !== "owner" && input.role !== "admin") return false;
  // A group is a thread, not a person. The API refuses a group merge outright.
  if (input.isGroup) return false;
  // Absent on an older API: treat the unknown as "not allowed" rather than
  // offering an action that would be refused.
  return input.mergeEnabled === true;
}

/**
 * Candidates an admin may pick from, once the obvious refusals are removed.
 *
 * The server refuses each of these too. Filtering here is about not offering
 * a choice that can only fail: a contact cannot merge into itself, a group is
 * never a person, and a contact already merged away is not a separate
 * customer to merge again.
 */
export function selectableMergeCandidates(
  chats: Chat[],
  currentContactId: string,
): Chat[] {
  return chats.filter(
    (chat) => chat.contact.id !== currentContactId && !chat.contact.isGroup,
  );
}

/**
 * One candidate, shown the way the inbox shows a person.
 *
 * Name alone is not enough to pick the right record: two contacts can carry
 * the same display name, and the whole point of the merge is that they are
 * the same human. The avatar, the address, and the channel are what let an
 * admin tell them apart before making a decision that moves identity.
 */
function CandidateIdentity({ chat }: { chat: Chat }) {
  const { contact } = chat;
  const displayName = formatPhoneLikeText(
    contact.customName || contact.name || contact.jid || "Unknown",
  );
  return (
    <>
      <span className="size-9 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-dark-tertiary">
        {contact.avatarUrl ? (
          <img
            src={contact.avatarUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <IdentityAvatarFallback
            displayName={displayName}
            identity={contact.jid || contact.phoneNumber || contact.id}
            className="text-sm"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{displayName}</span>
        {contact.phoneNumber && (
          <span className="block truncate text-xs text-muted-foreground">
            {formatPhoneLikeText(contact.phoneNumber)}
          </span>
        )}
      </span>
      {contact.channel && isChannel(contact.channel) && (
        <ChannelBadge channel={contact.channel} compact iconOnly />
      )}
    </>
  );
}

/**
 * Merge a customer chosen by hand into this one.
 *
 * Separate from the suggestion list because the two carry different weight.
 * A suggestion is evidence - two contacts seen at the same address. This is an
 * assertion by an admin with nothing behind it but their own knowledge, so it
 * asks for a reason and a typed confirmation, and it says plainly what a merge
 * does and does not do before it happens.
 */
export function ManualMergeSection({ contact }: ManualMergeSectionProps) {
  const { t } = useTranslation();
  const { activeWorkspace } = useWorkspace();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Chat | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const merge = useMergeContact();
  const { data: candidates = [], isLoading } = useForwardContacts(search);

  if (
    !shouldOfferManualMerge({
      role: activeWorkspace?.role,
      isGroup: Boolean(contact.isGroup),
      mergeEnabled: contact.mergeEnabled,
    })
  ) {
    return null;
  }

  const close = () => {
    setIsPickerOpen(false);
    setSelected(null);
    setSearch("");
    setReason("");
    setConfirmation("");
  };

  const canSubmit =
    selected !== null &&
    reason.trim().length > 0 &&
    confirmation.trim().toUpperCase() === CONFIRM_WORD &&
    !merge.isPending;

  const handleMerge = async () => {
    if (!selected || !canSubmit) return;
    try {
      const result = await merge.mutateAsync({
        contactId: contact.id,
        // `Chat.id` is the id the chat route addresses, which is the
        // conversation once a thread has one. A merge names customers, so it
        // has to send the contact id or the API answers "Contact not found".
        sourceContactId: selected.contact.id,
        reason: reason.trim(),
      });
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
      close();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("contacts.mergeFailed", "Could not merge these contacts"),
      );
    }
  };

  const selectable = selectableMergeCandidates(candidates, contact.id);

  return (
    <>
      <RightPanelSection
        title={t("contacts.manualMergeTitle", "Same person, another contact?")}
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "contacts.manualMergeHint",
              "Pick the other contact yourself when you know two records are the same customer. Their channels move here; every conversation stays where it is.",
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setIsPickerOpen(true)}
          >
            <Merge className="mr-2 h-4 w-4" />
            {t("contacts.manualMergeAction", "Merge another contact in")}
          </Button>
        </div>
      </RightPanelSection>

      <Dialog
        open={isPickerOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("contacts.manualMergeDialogTitle", "Merge a contact in")}
            </DialogTitle>
            <DialogDescription>
              {t("contacts.manualMergeDialogBody", {
                defaultValue:
                  "The contact you pick stops appearing separately and its channels move to {{name}}. Conversations, messages, notes, and tags are never combined - each chat stays its own thread. An admin can reverse this later.",
                name: contact.displayName,
              })}
            </DialogDescription>
          </DialogHeader>

          {/* One fixed-height body for every state. The dialog is a decision
              surface: resizing it as the operator types moves the buttons out
              from under the cursor. */}
          {selected === null ? (
            <div className="flex h-[22rem] flex-col gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  className="pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t(
                    "contacts.manualMergeSearch",
                    "Search contacts",
                  )}
                />
              </div>
              <ul className="flex-1 space-y-1 overflow-y-auto">
                {isLoading && (
                  <li className="px-2 py-3 text-sm text-muted-foreground">
                    {t("common.loading", "Loading...")}
                  </li>
                )}
                {!isLoading && selectable.length === 0 && (
                  <li className="px-2 py-3 text-sm text-muted-foreground">
                    {t("contacts.manualMergeNoResults", "No other contacts")}
                  </li>
                )}
                {selectable.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(candidate)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                    >
                      <CandidateIdentity chat={candidate} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex h-[22rem] flex-col gap-3">
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <CandidateIdentity chat={selected} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 px-2 text-xs"
                  onClick={() => setSelected(null)}
                >
                  {t("contacts.manualMergeChangeSelection", "Choose another")}
                </Button>
              </div>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t(
                  "contacts.manualMergeReason",
                  "Why are these the same customer? This is recorded in the merge history.",
                )}
              />
              <Input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={t("contacts.manualMergeConfirmWord", {
                  defaultValue: "Type {{word}} to confirm",
                  word: CONFIRM_WORD,
                })}
                aria-label={t("contacts.manualMergeConfirmWord", {
                  defaultValue: "Type {{word}} to confirm",
                  word: CONFIRM_WORD,
                })}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={merge.isPending}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handleMerge} disabled={!canSubmit}>
              {t("contacts.mergeConfirmAction", "Merge")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
