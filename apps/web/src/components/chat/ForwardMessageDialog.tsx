import { ArrowRight, Loader2, RefreshCw, Search, Users, X } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";
import { useForwardContacts } from "../../hooks/useForwardContacts";
import type { Chat } from "../../types/chat";
import { useTranslation } from "react-i18next";

interface ForwardMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForward: (targetContactId: string) => void;
  isForwarding?: boolean;
}

/**
 * Skeleton loading item with pulse animation
 */
const ContactSkeleton = memo(function ContactSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      {/* Avatar skeleton */}
      <div className="w-12 h-12 rounded-full bg-muted" />
      {/* Text skeleton */}
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-3 w-24 rounded bg-muted" />
      </div>
    </div>
  );
});

/**
 * Dialog for selecting a contact to forward a message to
 */
export const ForwardMessageDialog = memo(function ForwardMessageDialog({
  open,
  onOpenChange,
  onForward,
  isForwarding = false,
}: ForwardMessageDialogProps) {
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: chats,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useForwardContacts(searchQuery, open);

  // Filter to contacts that have a JID (can receive messages)
  const availableContacts = useMemo(() => {
    return (chats || []).filter((chat) => !chat.isArchived);
  }, [chats]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setSearchQuery("");
  }, []);

  const handleSelectContact = useCallback(
    (contactId: string) => {
      onForward(contactId);
    },
    [onForward],
  );

  // Reset search when dialog closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchQuery("");
      }
      onOpenChange(newOpen);
    },
    [onOpenChange],
  );

  // Show loading only when we have no data at all (including placeholder)
  // isLoading is true on initial load, isFetching is true during any fetch
  const showSkeletons =
    (isLoading || isFetching) && availableContacts.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-surface border-line">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-line">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold text-fg">
              {t("chat.forwardMessage", "Forward message")}
            </DialogTitle>
            {/* Updating indicator - show when fetching with existing data */}
            {isFetching && availableContacts.length > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent/10">
                <RefreshCw className="h-3 w-3 text-accent animate-spin" />
                <span className="text-xs font-medium text-accent">
                  Updating
                </span>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-4 py-3 bg-page/30">
          <div className="relative group">
            <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-subtle transition-colors group-focus-within:text-accent" />
            <input
              type="text"
              placeholder={t("chat.searchContactsEllipsis", "Search contacts…")}
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full ps-10 pe-10 py-2.5 text-sm bg-raised border border-line rounded-xl text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary transition-all duration-200"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleSearchClear}
                className="absolute end-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-fg-subtle hover:text-fg-muted hover:bg-muted-strong transition-all duration-150"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Contact List */}
        <div
          className="flex-1 overflow-auto min-h-0 scroll-smooth"
          style={{ maxHeight: "50vh" }}
        >
          {error ? (
            // Error state
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-danger-soft flex items-center justify-center mb-4">
                <X className="h-8 w-8 text-danger" />
              </div>
              <p className="text-sm font-medium text-fg mb-1">
                {t("chat.contactsLoadFailed", "Failed to load contacts")}
              </p>
              <p className="text-xs text-fg-muted mb-4">
                {error.message || t("chat.pleaseTryAgain")}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-4 py-2 text-sm font-medium text-on-primary bg-primary hover:bg-primary-hover rounded-lg transition-colors"
              >
                {t("chat.tryAgain", "Try again")}
              </button>
            </div>
          ) : showSkeletons ? (
            // Skeleton loading state
            <div className="divide-y divide-line">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <ContactSkeleton key={i} />
              ))}
            </div>
          ) : availableContacts.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-fg-subtle" />
              </div>
              <p className="text-sm font-medium text-fg mb-1">
                {searchQuery
                  ? t("chat.noContactsFound", "No contacts found")
                  : t(
                      "broadcasts.noContactsAvailable",
                      "No contacts available",
                    )}
              </p>
              <p className="text-xs text-fg-muted max-w-[200px]">
                {searchQuery
                  ? t("chat.noResultsFor", { query: searchQuery })
                  : t(
                      "chat.startConversationHint",
                      "Start a conversation to see contacts here",
                    )}
              </p>
            </div>
          ) : (
            // Contact list - use simple scroll for reliability
            <div className="divide-y divide-line">
              {availableContacts.map((chat) => (
                <ContactListItem
                  key={chat.id}
                  chat={chat}
                  onClick={() => handleSelectContact(chat.id)}
                  isDisabled={isForwarding}
                />
              ))}
            </div>
          )}
        </div>

        {/* Forwarding overlay */}
        {isForwarding && (
          <div className="absolute inset-0 bg-surface flex items-center justify-center rounded-lg z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-accent animate-spin" />
              </div>
              <span className="text-sm font-medium text-fg">
                {t("chat.forwardingMessage", "Forwarding message...")}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

interface ContactListItemProps {
  chat: Chat;
  onClick: () => void;
  isDisabled?: boolean;
}

const ContactListItem = memo(function ContactListItem({
  chat,
  onClick,
  isDisabled,
}: ContactListItemProps) {
  const { t } = useTranslation();

  const { contact } = chat;
  const displayName = formatPhoneLikeText(
    contact.customName || contact.name || contact.jid || t("chat.unknownName"),
  );

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className="group w-full flex items-center gap-3 px-4 py-3 text-start transition-all duration-150 hover:bg-subtle active:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-muted ring-2 ring-transparent group-hover:ring-ring/20 transition-all duration-200">
          {contact.avatarUrl ? (
            <img
              src={contact.avatarUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : contact.isGroup ? (
            <div className="w-full h-full flex items-center justify-center bg-fg-subtle text-white">
              <Users className="w-5 h-5" />
            </div>
          ) : (
            <IdentityAvatarFallback
              displayName={displayName}
              identity={contact.jid || contact.phoneNumber || contact.id}
              className="text-base"
            />
          )}
        </div>
        {/* Online Indicator */}
        {!contact.isGroup && contact.isOnline && (
          <span
            className="absolute bottom-0.5 end-0.5 w-3 h-3 bg-signal border-2 border-surface rounded-full shadow-sm"
            aria-label={t("chat.online", "Online")}
          />
        )}
      </div>

      {/* Contact Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg truncate">
            {displayName}
          </span>
          {contact.isGroup && (
            <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium uppercase text-fg-subtle bg-muted rounded">
              Group
            </span>
          )}
        </div>
        {contact.phoneNumber && !contact.isGroup && (
          <span className="text-xs text-fg-muted truncate block mt-0.5">
            {formatPhoneNumber(contact.phoneNumber)}
          </span>
        )}
      </div>

      {/* Forward arrow indicator */}
      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <ArrowRight className="h-4 w-4 text-accent rtl:-scale-x-100" />
      </div>
    </button>
  );
});

export default ForwardMessageDialog;
