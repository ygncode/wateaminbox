import { Check, Search, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useForwardContacts } from "@/hooks/useForwardContacts";
import { cn, formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface ContactMultiSelectProps {
  /** Selected contact ids mapped to their display names (for chips). */
  selected: ReadonlyMap<string, string>;
  onToggle: (contactId: string, displayName: string) => void;
}

/**
 * Searchable multi-select over workspace contacts with checkmarks and
 * removable chips for the current selection.
 */
export function ContactMultiSelect({
  selected,
  onToggle,
}: ContactMultiSelectProps) {
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState("");
  const { data: chats, isLoading } = useForwardContacts(searchQuery);

  // Broadcasts target individual contacts; groups are skipped server-side.
  const availableContacts = useMemo(
    () =>
      (chats || []).filter((chat) => !chat.isArchived && !chat.contact.isGroup),
    [chats],
  );

  return (
    <div>
      {selected.size > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {[...selected.entries()].map(([contactId, displayName]) => (
            <li key={contactId}>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#00a884]/10 py-1 pl-2.5 pr-1 text-xs font-medium text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300">
                {displayName}
                <button
                  type="button"
                  onClick={() => onToggle(contactId, displayName)}
                  aria-label={`Remove ${displayName}`}
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
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("chat.searchContactsEllipsis", "Search contacts…")}
          aria-label={t("chat.searchContactsAria", "Search contacts")}
          className="w-full rounded-lg border border-black/[0.1] bg-white py-2 pl-9 pr-9 text-sm text-[#111b21] outline-none placeholder:text-[#8696a0] focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]/40 dark:border-white/[0.1] dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label={t("common.clearSearch", "Clear search")}
            className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-[#8696a0] hover:bg-black/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-dark-text-tertiary dark:hover:bg-white/[0.06]"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-black/[0.06] dark:border-white/[0.07]">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-[#667781] dark:text-dark-text-secondary">
            {t("broadcasts.loadingContacts", "Loading contacts…")}
          </p>
        ) : availableContacts.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-6 text-center">
            <Users
              className="size-6 text-[#8696a0] dark:text-dark-text-tertiary"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-[#667781] dark:text-dark-text-secondary">
              {searchQuery
                ? `No contacts match "${searchQuery}"`
                : t("broadcasts.noContactsAvailable", "No contacts available")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {availableContacts.map((chat) => {
              const { contact } = chat;
              const displayName = formatPhoneLikeText(
                contact.customName || contact.name || contact.jid || "Unknown",
              );
              const isSelected = selected.has(chat.id);
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    onClick={() => onToggle(chat.id, displayName)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f5f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00a884]/40 dark:hover:bg-dark-tertiary/60"
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
                        {displayName}
                      </span>
                      {contact.phoneNumber && (
                        <span className="block truncate text-xs text-[#667781] dark:text-dark-text-tertiary">
                          {formatPhoneNumber(contact.phoneNumber)}
                        </span>
                      )}
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
