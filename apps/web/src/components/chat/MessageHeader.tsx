import type { Contact } from "@wateaminbox/shared";
import { formatLastSeen } from "@wateaminbox/shared";
import { ArrowLeft, Info, MoreVertical, Search } from "lucide-react";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { useGroup } from "@/hooks/useGroups";
import { cn, formatPhoneLikeText } from "@/lib/utils";
import { CONVERSATION_HEADER_INSET_CLASS } from "@/components/layout/conversation-chrome";
import { useOptionalMobileLayout } from "@/components/layout/MobileLayout";
import { ConnectionBadge, ConnectionRoute } from "./ConnectionIdentity";
import { useTranslation } from "react-i18next";

interface MessageHeaderProps {
  contact: Contact | undefined;
  onOpenProfile?: () => void;
  onSearch?: () => void;
  onMore?: () => void;
  /**
   * Force the back button on. Left unset, it appears automatically inside the
   * mobile view stack, where the thread covers the conversation list.
   */
  showBackButton?: boolean;
  /**
   * Callback when back button is pressed; defaults to popping the mobile view
   * stack. Tablet has no view stack to pop, so `ChatPage` supplies a handler
   * that deselects the conversation instead - which is the only way back to
   * the list route, and therefore to the bottom navigation, now that the bar
   * is withdrawn everywhere below `lg`.
   */
  onBack?: () => void;
  /** Whether the contact is currently typing */
  isTyping?: boolean;
}

/**
 * Touch action button. 44px hit target on phones - the header is the densest
 * row in the conversation and the one most often mis-tapped while scrolling.
 */
const actionButtonClass =
  "grid size-11 shrink-0 touch-manipulation place-items-center rounded-full text-[#54656f] transition-colors hover:bg-black/[0.055] active:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-dark-text-secondary dark:hover:bg-white/[0.06] dark:active:bg-white/10 md:size-10";

export function MessageHeader({
  contact,
  onOpenProfile,
  onSearch,
  onMore,
  showBackButton,
  onBack,
  isTyping = false,
}: MessageHeaderProps) {
  const { t } = useTranslation();

  const { data: group } = useGroup(contact?.isGroup ? contact.id : null);
  // Null on desktop, where the list and the thread are both on screen.
  const mobileLayout = useOptionalMobileLayout();
  const canGoBack = showBackButton ?? mobileLayout !== null;
  const handleBack = onBack ?? mobileLayout?.goBack;

  if (!contact) {
    return null;
  }

  const displayName = formatPhoneLikeText(
    contact.customName || contact.name || contact.jid || "Unknown",
  );
  const lastSeenText = contact.isGroup
    ? group?.participantCount
      ? t("chat.participantCount", {
          defaultValue: "{{count}} participants",
          count: group.participantCount,
        })
      : t("chat.group", "Group")
    : formatLastSeen(contact.lastSeen, contact.isOnline, t);
  const statusText = isTyping ? t("chat.typingShort", "typing") : lastSeenText;

  return (
    // Same surface as the composer at the other end of the column, so the
    // message canvas reads as one inset panel between two pieces of chrome.
    // The workspace header is withdrawn on this route, so this bar is the top
    // of the screen and owns the notch inset (height included, not eaten).
    <header
      className={cn(
        "flex shrink-0 items-center gap-0.5 border-b border-black/[0.06] bg-[#f0f2f5] px-1 dark:border-white/[0.06] dark:bg-dark-secondary md:gap-2 md:px-3",
        CONVERSATION_HEADER_INSET_CLASS,
      )}
    >
      {canGoBack && handleBack && (
        <button
          type="button"
          onClick={handleBack}
          // Runs to `lg`, not `md`: below `lg` this is the only control that
          // returns to the conversation list, and desktop shows the list in
          // its own column so it needs no back control at all.
          className={cn(actionButtonClass, "lg:hidden")}
          aria-label={t("common.goBack", "Go back")}
        >
          <ArrowLeft className="size-6" strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {/* Avatar and identity - opens the contact/group profile. */}
      <button
        type="button"
        onClick={onOpenProfile}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-left transition-colors hover:bg-black/[0.04] active:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:hover:bg-white/[0.05] dark:active:bg-white/[0.08] md:gap-3 md:px-2"
      >
        <span className="relative shrink-0">
          <span className="block size-10 overflow-hidden rounded-full bg-gray-300 dark:bg-dark-tertiary">
            {contact.avatarUrl ? (
              <img
                src={contact.avatarUrl}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <IdentityAvatarFallback
                displayName={displayName}
                identity={contact.jid || contact.phoneNumber || contact.id}
                kind={contact.isGroup ? "group" : "user"}
                className="text-lg"
              />
            )}
          </span>
          {contact.isOnline && (
            <span className="absolute bottom-0 right-0 size-3 rounded-full bg-whatsapp-green ring-2 ring-[#f0f2f5] dark:ring-dark-secondary" />
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold leading-5 tracking-[-0.01em] text-[#111b21] dark:text-dark-text-primary">
              {displayName}
            </h2>
            {/* The account pill needs room to stay legible; on a phone the
                same routing is carried by the status line below instead. */}
            {contact.connection && (
              <ConnectionBadge
                connection={contact.connection}
                compact
                className="hidden max-w-[110px] shrink md:inline-flex"
              />
            )}
          </span>

          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4">
            {isTyping ? (
              <span className="shrink-0 font-medium text-whatsapp-green">
                <span className="typing-indicator">
                  {t("chat.typingShort", "typing")}
                  <span className="typing-dots" />
                </span>
              </span>
            ) : (
              statusText && (
                <span className="truncate text-[#667781] dark:text-dark-text-secondary">
                  {statusText}
                </span>
              )
            )}
            {contact.connection && (
              <>
                {(isTyping || statusText) && (
                  <span
                    className="size-0.5 shrink-0 rounded-full bg-[#aebac1] dark:bg-dark-border"
                    aria-hidden="true"
                  />
                )}
                {/* Phones get the account name only; the number returns
                    from `sm` up, where the line has room for both. */}
                <ConnectionRoute
                  connection={contact.connection}
                  mode="receiving"
                  compact
                  className="min-w-0 truncate text-[12px]"
                />
              </>
            )}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center">
        {/* Tapping the header opens the profile on every layout, but that is
            not discoverable without a hover cursor - touch layouts get an
            explicit control. */}
        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className={cn(actionButtonClass, "lg:hidden")}
            aria-label={t("chat.contactInfo", "Contact info")}
          >
            <Info className="size-5.5" strokeWidth={1.9} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={onSearch}
          className={actionButtonClass}
          aria-label={t(
            "search.inConversationAria",
            "Search messages in conversation",
          )}
        >
          <Search className="size-5.5" strokeWidth={1.9} aria-hidden="true" />
        </button>

        {/* Omitted when the host wires no handler, so the header never shows a
            control that does nothing. */}
        {onMore && (
          <button
            type="button"
            onClick={onMore}
            className={actionButtonClass}
            aria-label={t("common.moreOptions", "More options")}
          >
            <MoreVertical
              className="size-5.5"
              strokeWidth={1.9}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </header>
  );
}

export default MessageHeader;
