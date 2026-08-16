import { useQuery } from "@tanstack/react-query";
import { GROUP_PARTICIPANT_BATCH_LIMIT } from "@wateaminbox/shared";
import { Check, Search, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { queryKeys } from "@/hooks/query-keys";
import { api, buildQueryString } from "@/lib/api/client";
import type { ContactsListResponse } from "@/lib/api/transformers";
import { cn, formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";

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
              <span className="inline-flex items-center gap-1 rounded-full bg-[#00a884]/10 py-1 pl-2.5 pr-1 text-xs font-medium text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300">
                {participant.displayName}
                <button
                  type="button"
                  onClick={() => onToggle(participant)}
                  aria-label={`Remove ${participant.displayName}`}
                  className="grid size-4.5 place-items-center rounded-full hover:bg-black/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:hover:bg-white/[0.1]"
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
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8696a0] dark:text-dark-text-tertiary"
          aria-hidden="true"
        />
        <input
          id={searchInputId}
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search contacts…"
          aria-label="Search contacts to add"
          disabled={!connectionId}
          className="w-full rounded-lg border border-black/[0.1] bg-white py-2 pl-9 pr-9 text-sm text-[#111b21] outline-none placeholder:text-[#8696a0] focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.1] dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-[#8696a0] hover:bg-black/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-dark-text-tertiary dark:hover:bg-white/[0.06]"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Announced on change so a screen-reader user hears the selection count
          move, and hears when the cap has been reached. */}
      <p
        className="mt-1.5 text-xs text-[#667781] dark:text-dark-text-tertiary"
        aria-live="polite"
      >
        {selected.size} of {limit} selected
        {atLimit ? " · limit reached" : ""}
      </p>

      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-black/[0.06] dark:border-white/[0.07]">
        {!connectionId ? (
          <p className="px-4 py-6 text-center text-sm text-[#667781] dark:text-dark-text-secondary">
            Choose a WhatsApp account first.
          </p>
        ) : isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-[#667781] dark:text-dark-text-secondary">
            Loading contacts…
          </p>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-6 text-center">
            <Users
              className="size-6 text-[#8696a0] dark:text-dark-text-tertiary"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-[#667781] dark:text-dark-text-secondary">
              {searchQuery
                ? `No contacts match "${searchQuery}"`
                : "No contacts on this WhatsApp account"}
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-black/[0.04] dark:divide-white/[0.05]"
            role="group"
            aria-label={labelledBy ? undefined : "Contacts"}
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
                  ? `Selection limit of ${limit} reached`
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
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f5f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00a884]/40 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-tertiary/60"
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                        isSelected
                          ? "border-[#00a884] bg-[#00a884] text-white"
                          : "border-black/[0.15] dark:border-white/[0.2]",
                      )}
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
                        {participant.displayName}
                      </span>
                      <span className="block truncate text-xs text-[#667781] dark:text-dark-text-tertiary">
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
