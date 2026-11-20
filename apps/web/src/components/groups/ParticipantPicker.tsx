import { useQuery } from "@tanstack/react-query";
import { GROUP_PARTICIPANT_BATCH_LIMIT } from "@wateaminbox/shared";
import { Check, Search, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { queryKeys } from "@/hooks/query-keys";
import { api, buildQueryString } from "@/lib/api/client";
import type { ContactsListResponse } from "@/lib/api/transformers";
import { cn, formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export interface PickableParticipant {
  jid: string;
  displayName: string;
  phoneNumber: string | null;
}

interface ParticipantPickerProps {
  /** Id given to the search input so an external <Label> can point at it. */
  searchInputId?: string;
  /** Element id that labels the option list for assistive technology. */
  labelledBy?: string;
  /**
   * Restrict the list to contacts of one WhatsApp account. A group only exists
   * on the account that is in it, so offering contacts from another number
   * would build a selection WhatsApp cannot act on.
   */
  connectionId: string | null;
  /** Selected participants, keyed by JID. */
  selected: ReadonlyMap<string, PickableParticipant>;
  onToggle: (participant: PickableParticipant) => void;
  /** JIDs that cannot be picked, with the reason shown in place of the check. */
  disabledJids?: ReadonlyMap<string, string>;
  /** Upper bound on the selection; defaults to WhatsApp's per-request batch. */
  limit?: number;
}

/**
 * Searchable multi-select over the contacts of one WhatsApp account, producing
 * WhatsApp JIDs rather than workspace contact ids - group membership is
 * addressed by JID.
 */
export function ParticipantPicker({
  connectionId,
  selected,
  onToggle,
  disabledJids,
  limit = GROUP_PARTICIPANT_BATCH_LIMIT,
  searchInputId,
  labelledBy,
}: ParticipantPickerProps) {
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.contacts.list({
      search: searchQuery,
      connectionId,
      scope: "group-participants",
    }),
    queryFn: async () => {
      const query = buildQueryString({
        limit: 100,
        includeGroups: "false",
        conversationStatus: "all",
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
        ...(connectionId ? { connectionId } : {}),
      });
      return api.get<ContactsListResponse>(`/contacts${query}`);
    },
    enabled: Boolean(connectionId),
    staleTime: 30_000,
  });

  const candidates = useMemo(
    () =>
      (data?.data ?? [])
        .filter((contact) => !contact.isGroup && Boolean(contact.jid))
        .map((contact) => ({
          jid: contact.jid as string,
          displayName: formatPhoneLikeText(
            contact.customName || contact.displayName || contact.jid || "",
          ),
          phoneNumber: contact.phoneNumber ?? null,
        })),
    [data],
  );

  const atLimit = selected.size >= limit;

  return (
    <div>
      {selected.size > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {[...selected.values()].map((participant) => (
            <li key={participant.jid}>
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 py-1 ps-2.5 pe-1 text-xs font-medium text-accent">
                {participant.displayName}
                <button
                  type="button"
                  onClick={() => onToggle(participant)}
                  aria-label={t("groups.removeParticipantAria", {
                    name: participant.displayName,
                  })}
                  className="grid size-4.5 place-items-center rounded-full hover:bg-fg/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search
          className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <input
          id={searchInputId}
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("chat.searchContactsEllipsis", "Search contacts…")}
          aria-label={t("groups.searchContactsToAdd", "Search contacts to add")}
          disabled={!connectionId}
          className="w-full rounded-lg border border-line/[0.1] bg-raised py-2 ps-9 pe-9 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-1 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label={t("common.clearSearch", "Clear search")}
            className="absolute end-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-fg-subtle hover:bg-fg/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Announced on change so a screen-reader user hears the selection count
          move, and hears when the cap has been reached. */}
      <p className="mt-1.5 text-xs text-fg-subtle" aria-live="polite">
        {selected.size} of {limit} selected
        {atLimit ? " · limit reached" : ""}
      </p>

      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line/[0.06]">
        {!connectionId ? (
          <p className="px-4 py-6 text-center text-sm text-fg-muted">
            {t("groups.chooseAccountFirst", "Choose a WhatsApp account first.")}
          </p>
        ) : isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-fg-muted">
            {t("broadcasts.loadingContacts", "Loading contacts…")}
          </p>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-6 text-center">
            <Users className="size-6 text-fg-subtle" aria-hidden="true" />
            <p className="mt-2 text-sm text-fg-muted">
              {searchQuery
                ? t("groups.noContactsMatch", { query: searchQuery })
                : t("groups.noContactsOnAccount")}
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-line/[0.04]"
            role="group"
            aria-label={labelledBy ? undefined : t("chat.contacts")}
            aria-labelledby={labelledBy}
          >
            {candidates.map((participant) => {
              const isSelected = selected.has(participant.jid);
              const explicitReason = disabledJids?.get(participant.jid);
              const blocked =
                Boolean(explicitReason) || (atLimit && !isSelected);
              // A disabled row must say why. Hitting the cap disables rows that
              // have no per-contact reason, which without this reads as an
              // unexplained dead control.
              const disabledReason =
                explicitReason ??
                (atLimit && !isSelected
                  ? t("groups.selectionLimit", { limit })
                  : undefined);
              return (
                <li key={participant.jid}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-disabled={blocked}
                    disabled={blocked}
                    onClick={() => onToggle(participant)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                        isSelected
                          ? "border-accent bg-primary text-on-primary"
                          : "border-line/[0.15]",
                      )}
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {participant.displayName}
                      </span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {disabledReason ||
                          (participant.phoneNumber
                            ? formatPhoneNumber(participant.phoneNumber)
                            : participant.jid)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
