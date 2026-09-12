import { isChannel } from "@wateaminbox/shared";
import { Check, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useMergeContact,
  useMergeHistory,
  useUnmergeContact,
} from "@/hooks/contact/useContactMerge";
import { useForwardContacts } from "@/hooks/useForwardContacts";
import type { MergeHistoryEntry } from "@/lib/api/contacts";
import { cn, formatPhoneLikeText } from "@/lib/utils";
import type { Chat } from "@/types/chat";
import { ChannelBadge } from "../ChannelIdentity";
import {
  currentMembers,
  isEmptyPlan,
  type MergedMember,
  planMergeSelection,
  selectableMergeCandidates,
  shouldOfferManualMerge,
} from "./merge-selection";
import type { ContactData } from "./types";

interface MergeEditDialogProps {
  contact: ContactData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Choose everyone this customer is, in one list.
 *
 * Merging was a one-at-a-time action with a typed confirmation, which made
 * assembling a person out of three records three separate decisions and gave
 * no way to see who was already in. The list shows the current members ticked
 * alongside everyone else, so one pass says who this person is - and unticking
 * is how you take someone back out.
 *
 * The typed confirmation is replaced by a summary the operator has to read and
 * accept: it names exactly what is about to happen, which the word MERGE never
 * did.
 */
export function MergeEditDialog({
  contact,
  open,
  onOpenChange,
}: MergeEditDialogProps) {
  const { t } = useTranslation();
  const { activeWorkspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const { data: merges = [] } = useMergeHistory(open ? contact.id : null);
  const { data: candidates = [], isLoading } = useForwardContacts(search);
  const merge = useMergeContact();
  const unmerge = useUnmergeContact();

  const members: MergedMember[] = useMemo(
    () => currentMembers(merges),
    [merges],
  );
  const memberIds = useMemo(
    () => new Set(members.map((member) => member.contactId)),
    [members],
  );

  // Everyone already folded in starts ticked, so the list reads as the
  // customer's current membership rather than as an empty picker.
  useEffect(() => {
    if (open) setSelected(new Set(memberIds));
  }, [open, memberIds]);

  const close = () => {
    onOpenChange(false);
    setSearch("");
    setReason("");
    setIsConfirming(false);
  };

  if (
    !shouldOfferManualMerge({
      role: activeWorkspace?.role,
      isGroup: Boolean(contact.isGroup),
      mergeEnabled: contact.mergeEnabled,
    })
  ) {
    return null;
  }

  const plan = planMergeSelection({ members, selected });
  const selectable = selectableMergeCandidates(
    candidates,
    contact.id,
    memberIds,
  );
  const candidateNames = new Map(
    candidates.map((chat) => [chat.contact.id, displayNameOf(chat)]),
  );

  const toggle = (contactId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const run = async () => {
    setIsRunning(true);
    const note = reason.trim() || "Edited from the contact profile";
    const failed: string[] = [];
    let merged = 0;
    let separated = 0;
    // Unmerges run first on purpose: a merge executed now would make the
    // pending unmerge's event "merged again since", which the API refuses -
    // the batch would fail the half the operator could still see ticked.
    for (const entry of plan.toUnmerge) {
      try {
        await unmerge.mutateAsync({
          mergeEventId: entry.mergeEventId,
          reason: note,
        });
        separated += 1;
      } catch (error) {
        failed.push(describeFailure(merges, entry.contactId, error));
      }
    }
    for (const sourceContactId of plan.toMerge) {
      try {
        await merge.mutateAsync({
          contactId: contact.id,
          sourceContactId,
          reason: note,
        });
        merged += 1;
      } catch (error) {
        failed.push(
          `${candidateNames.get(sourceContactId) ?? sourceContactId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    setIsRunning(false);

    if (merged > 0 || separated > 0) {
      toast.success(
        t("contacts.mergeEditApplied", {
          defaultValue: "Merged {{merged}} in, separated {{separated}} out.",
          merged,
          separated,
        }),
      );
    }
    // A partial batch is reported rather than swallowed: some of what the
    // operator ticked did happen, and they need to know which part did not.
    if (failed.length > 0) {
      toast.error(
        t("contacts.mergeEditPartial", {
          defaultValue: "{{count}} change(s) could not be applied.",
          count: failed.length,
        }),
        { description: failed.join("; "), duration: 12_000 },
      );
      setIsConfirming(false);
      return;
    }
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("contacts.mergeEditTitle", "Merged chats")}
          </DialogTitle>
          <DialogDescription>
            {isConfirming
              ? t("contacts.mergeEditConfirmBody", {
                  defaultValue:
                    "Channels move between contacts. Conversations, messages, notes, and tags never move - each chat stays its own thread.",
                })
              : t("contacts.mergeEditBody", {
                  defaultValue:
                    "Tick everyone who is {{name}}. Unticking someone takes them back out as their own contact.",
                  name: contact.displayName,
                })}
          </DialogDescription>
        </DialogHeader>

        {/* One fixed-height body for every step. The dialog is a decision
            surface: resizing it as the operator picks moves the buttons out
            from under the cursor. */}
        {isConfirming ? (
          <div className="flex h-[22rem] flex-col gap-3">
            <ul className="flex-1 space-y-1.5 overflow-y-auto text-sm">
              {plan.toMerge.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <Plus
                    className="size-4 shrink-0 text-whatsapp-teal-green"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {t("contacts.mergeEditWillMerge", {
                      defaultValue: "Merge in {{name}}",
                      name: candidateNames.get(id) ?? id,
                    })}
                  </span>
                </li>
              ))}
              {plan.toUnmerge.map((entry) => (
                <li
                  key={entry.mergeEventId}
                  className="flex items-center gap-2"
                >
                  <span
                    className="size-4 shrink-0 text-center text-red-600 dark:text-red-400"
                    aria-hidden="true"
                  >
                    −
                  </span>
                  <span className="truncate">
                    {t("contacts.mergeEditWillUnmerge", {
                      defaultValue: "Separate {{name}}",
                      name: nameOfMerge(merges, entry.contactId),
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t(
                "contacts.mergeEditReason",
                "Why are these the same customer? This is recorded in the merge history.",
              )}
            />
          </div>
        ) : (
          <div className="flex h-[22rem] flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("contacts.manualMergeSearch", "Search contacts")}
              />
            </div>
            <ul className="flex-1 space-y-1 overflow-y-auto">
              {members.map((member) => (
                <li key={member.contactId}>
                  <PickerRow
                    name={nameOfMerge(merges, member.contactId)}
                    checked={selected.has(member.contactId)}
                    onToggle={() => toggle(member.contactId)}
                  />
                </li>
              ))}
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
              {selectable.map((chat) => (
                <li key={chat.contact.id}>
                  <PickerRow
                    chat={chat}
                    name={displayNameOf(chat)}
                    checked={selected.has(chat.contact.id)}
                    onToggle={() => toggle(chat.contact.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={isConfirming ? () => setIsConfirming(false) : close}
            disabled={isRunning}
          >
            {isConfirming
              ? t("common.back", "Back")
              : t("common.cancel", "Cancel")}
          </Button>
          <Button
            onClick={isConfirming ? run : () => setIsConfirming(true)}
            disabled={isEmptyPlan(plan) || isRunning}
          >
            {isConfirming
              ? isRunning
                ? t("contacts.mergeEditApplying", "Applying...")
                : t("contacts.mergeEditApply", "Apply")
              : t("contacts.mergeEditContinue", "Continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function displayNameOf(chat: Chat): string {
  const { contact } = chat;
  return formatPhoneLikeText(
    contact.customName || contact.name || contact.jid || "Unknown",
  );
}

function nameOfMerge(merges: MergeHistoryEntry[], contactId: string): string {
  return (
    merges.find((entry) => entry.sourceContactId === contactId)?.sourceName ??
    contactId
  );
}

function describeFailure(
  merges: MergeHistoryEntry[],
  contactId: string,
  error: unknown,
): string {
  return `${nameOfMerge(merges, contactId)}: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

/**
 * One person in the list, with the tick that decides whether they are this
 * customer.
 *
 * Name alone is not enough to pick the right record: two contacts can carry
 * the same display name, and the whole point of the merge is that they are the
 * same human. The avatar, the address, and the channel are what let an admin
 * tell them apart before making a decision that moves identity.
 */
function PickerRow({
  chat,
  name,
  checked,
  onToggle,
}: {
  chat?: Chat;
  name: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const contact = chat?.contact;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
    >
      <span className="size-9 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-dark-tertiary">
        {contact?.avatarUrl ? (
          <img
            src={contact.avatarUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <IdentityAvatarFallback
            displayName={name}
            identity={contact?.jid || contact?.phoneNumber || name}
            className="text-sm"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        {contact?.phoneNumber && (
          <span className="block truncate text-xs text-muted-foreground">
            {formatPhoneLikeText(contact.phoneNumber)}
          </span>
        )}
      </span>
      {contact?.channel && isChannel(contact.channel) && (
        <ChannelBadge channel={contact.channel} compact iconOnly />
      )}
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          checked
            ? "border-whatsapp-teal-green bg-whatsapp-teal-green text-white"
            : "border-gray-300 text-transparent dark:border-dark-border",
        )}
        aria-hidden="true"
      >
        {checked ? <Check className="size-3.5" /> : <Plus className="size-3" />}
      </span>
    </button>
  );
}
