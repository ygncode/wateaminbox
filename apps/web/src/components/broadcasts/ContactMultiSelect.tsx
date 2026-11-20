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
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 py-1 ps-2.5 pe-1 text-xs font-medium text-accent">
                {displayName}
                <button
                  type="button"
                  onClick={() => onToggle(contactId, displayName)}
                  aria-label={`Remove ${displayName}`}
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
          className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
          aria-hidden="true"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("chat.searchContactsEllipsis", "Search contacts…")}
          aria-label={t("chat.searchContactsAria", "Search contacts")}
          className="w-full rounded-lg border border-line/[0.1] bg-surface py-2 ps-9 pe-9 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent focus:ring-1 focus:ring-ring/40"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label={t("common.clearSearch", "Clear search")}
            className="absolute end-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-fg-muted hover:bg-fg/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line/[0.06]">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-fg-muted">
            {t("broadcasts.loadingContacts", "Loading contacts…")}
          </p>
        ) : availableContacts.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-6 text-center">
            <Users className="size-6 text-fg-muted" aria-hidden="true" />
            <p className="mt-2 text-sm text-fg-muted">
              {searchQuery
                ? `No contacts match "${searchQuery}"`
                : t("broadcasts.noContactsAvailable", "No contacts available")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line/[0.04]">
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
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                        isSelected
                          ? "border-accent bg-primary text-on-primary"
                          : "border-line-strong",
                      )}
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {displayName}
                      </span>
                      {contact.phoneNumber && (
                        <span className="block truncate text-xs text-fg-muted">
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
