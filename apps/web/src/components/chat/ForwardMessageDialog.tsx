import { ArrowRight, Loader2, RefreshCw, Search, Users, X } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";
import { useForwardContacts } from "../../hooks/useForwardContacts";
import type { Chat } from "../../types/chat";

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
      <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-dark-tertiary" />
      {/* Text skeleton */}
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 rounded bg-gray-200 dark:bg-dark-tertiary" />
        <div className="h-3 w-24 rounded bg-gray-200 dark:bg-dark-tertiary" />
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
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: chats,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useForwardContacts(searchQuery);

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
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-white dark:bg-dark-elevated border-gray-200 dark:border-dark-border">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100 dark:border-dark-border/50">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
              Forward message
            </DialogTitle>
            {/* Updating indicator - show when fetching with existing data */}
            {isFetching && availableContacts.length > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-whatsapp-teal-green/10 dark:bg-whatsapp-teal-green/20">
                <RefreshCw className="h-3 w-3 text-whatsapp-teal-green animate-spin" />
                <span className="text-xs font-medium text-whatsapp-teal-green">
                  Updating
                </span>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-4 py-3 bg-gray-50/50 dark:bg-dark-primary/30">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary transition-colors group-focus-within:text-whatsapp-teal-green" />
            <input
              type="text"
              placeholder="Search contacts…"
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-10 py-2.5 text-sm bg-white dark:bg-dark-tertiary border border-gray-200 dark:border-dark-border rounded-xl text-gray-900 dark:text-dark-text-primary placeholder-gray-400 dark:placeholder-dark-text-tertiary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green/30 focus:border-whatsapp-teal-green transition-all duration-200"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleSearchClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-border transition-all duration-150"
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
              <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
                <X className="h-8 w-8 text-red-500 dark:text-red-400" />
              </div>
              <p className="text-sm font-medium text-gray-700 dark:text-dark-text-primary mb-1">
                Failed to load contacts
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary mb-4">
                {error.message || "Please try again"}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-4 py-2 text-sm font-medium text-white bg-whatsapp-teal-green hover:bg-whatsapp-green rounded-lg transition-colors"
              >
                Try again
              </button>
            </div>
          ) : showSkeletons ? (
            // Skeleton loading state
            <div className="divide-y divide-gray-50 dark:divide-dark-border/30">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <ContactSkeleton key={i} />
              ))}
            </div>
          ) : availableContacts.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-dark-tertiary flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-gray-400 dark:text-dark-text-tertiary" />
              </div>
              <p className="text-sm font-medium text-gray-700 dark:text-dark-text-primary mb-1">
                {searchQuery ? "No contacts found" : "No contacts available"}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary max-w-[200px]">
                {searchQuery
                  ? `No results for "${searchQuery}"`
                  : "Start a conversation to see contacts here"}
              </p>
            </div>
          ) : (
            // Contact list - use simple scroll for reliability
            <div className="divide-y divide-gray-50 dark:divide-dark-border/30">
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
          <div className="absolute inset-0 bg-white dark:bg-dark-elevated flex items-center justify-center rounded-lg z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-whatsapp-teal-green/10 dark:bg-whatsapp-teal-green/20 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-whatsapp-teal-green animate-spin" />
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-dark-text-primary">
                Forwarding message...
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
  const { contact } = chat;
  const displayName = formatPhoneLikeText(
    contact.customName || contact.name || contact.jid || "Unknown",
  );

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className="group w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 hover:bg-gray-50 dark:hover:bg-dark-tertiary/50 active:bg-gray-100 dark:active:bg-dark-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 dark:bg-dark-tertiary ring-2 ring-transparent group-hover:ring-whatsapp-teal-green/20 transition-all duration-200">
          {contact.avatarUrl ? (
            <img
              src={contact.avatarUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : contact.isGroup ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-400 dark:bg-dark-text-tertiary text-white">
              <Users className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-whatsapp-teal-green text-white text-base font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        {/* Online Indicator */}
        {!contact.isGroup && contact.isOnline && (
          <span
            className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-whatsapp-green border-2 border-white dark:border-dark-elevated rounded-full shadow-sm"
            aria-label="Online"
          />
        )}
      </div>

      {/* Contact Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-dark-text-primary truncate">
            {displayName}
          </span>
          {contact.isGroup && (
            <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500 dark:text-dark-text-tertiary bg-gray-100 dark:bg-dark-tertiary rounded">
              Group
            </span>
          )}
        </div>
        {contact.phoneNumber && !contact.isGroup && (
          <span className="text-xs text-gray-500 dark:text-dark-text-secondary truncate block mt-0.5">
            {formatPhoneNumber(contact.phoneNumber)}
          </span>
        )}
      </div>

      {/* Forward arrow indicator */}
      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <ArrowRight className="h-4 w-4 text-whatsapp-teal-green" />
      </div>
    </button>
  );
});

export default ForwardMessageDialog;
