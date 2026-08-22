import {
  ArrowLeft,
  CheckCheck,
  CircleAlert,
  MessagesSquare,
  RotateCcw,
  UsersRound,
} from "lucide-react";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChatSidebar, type SidebarView } from "../components/chat/ChatSidebar";
import { ComposerLifecycleArea } from "../components/chat/ComposerLifecycleArea";
import { ConversationSearch } from "../components/chat/ConversationSearch";
import { ContactProfile } from "../components/chat/contact-profile";
import { DeleteMessageDialog } from "../components/chat/DeleteMessageDialog";
import { ForwardMessageDialog } from "../components/chat/ForwardMessageDialog";
import { MessageComposer } from "../components/chat/MessageComposer";
import { MessageHeader } from "../components/chat/MessageHeader";
import { MessageThread } from "../components/chat/MessageThread";
import { AppLayout, ResponsiveLayout } from "../components/layout/app-layout";
import { MainContent } from "../components/layout/main-content";
import { Sidebar } from "../components/layout/sidebar";
import { Skeleton } from "../components/ui";
import { useAuth } from "../contexts/auth-context";
import { MessageActionsProvider } from "../contexts/message-actions-context";
import { useChatPageState } from "../hooks/chat";
import { useKeyboardInset } from "../hooks/ui";
import { useComposerAccess } from "../hooks/useComposerAccess";
import { parseChatView, withChatView } from "../lib/workspace-routes";
import { useTranslation } from "react-i18next";

export function ChatPage() {
  const { t } = useTranslation();

  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  // Chats vs Groups lives in the URL: the desktop sidebar tabs and the
  // mobile bottom navigation both drive it, and component state would let the
  // two disagree after a back/forward navigation or a shared link.
  const sidebarView = parseChatView(search);
  const setSidebarView = useCallback(
    (view: SidebarView) => {
      navigate(
        { pathname, search: withChatView(search, view) },
        { replace: true },
      );
    },
    [navigate, pathname, search],
  );

  const {
    // State
    selectedChatId,
    selectedContact,
    contactLoadError,
    isContactTyping,
    isProfileOpen,
    isSearchOpen,
    highlightedMessageId,
    replyToMessage,
    forwardDialogOpen,
    isForwarding,
    deleteDialogOpen,
    isDeleting,
    isSending,

    // Actions
    handleChatSelect,
    retryContactLoad,
    handleOpenProfile,
    handleCloseProfile,
    handleOpenSearch,
    handleCloseSearch,
    handleNavigateToMessage,
    handleReplyToMessage,
    handleClearReply,
    handleSendMessage,
    handleAttachFile,
    handleDeleteMessage,
    handleConfirmDelete,
    handleCloseDeleteDialog,
    handleStarMessage,
    handleReactMessage,
    handleForwardMessage,
    handleForwardToContact,
    handleCloseForwardDialog,
  } = useChatPageState();

  // Single source of truth for the composer gate, shared with
  // ComposerLifecycleArea below - both must agree on whether this user can
  // currently send, or the reply/react/retry affordances rendered here could
  // diverge from what the composer itself shows.
  const { access: composerAccess } = useComposerAccess(selectedChatId ?? null);
  const canSend = composerAccess.kind === "sendable";

  // Publishes the on-screen keyboard overlap for the composer footer to pad
  // by. Gated on an open conversation: the inbox list has no composer to keep
  // above the keyboard, so it should not hold visual-viewport listeners or a
  // stale inset while it is the only thing on screen.
  useKeyboardInset(Boolean(selectedChatId));

  // The floating navigation is withdrawn everywhere below `lg` while a
  // conversation is open, so the header's back control is the only way out of
  // one on a tablet, which has no mobile view stack to pop. Mirrors the mobile
  // stack's own semantics: dismiss the profile drawer first, then deselect.
  const handleBackFromConversation = useCallback(() => {
    if (isProfileOpen) {
      handleCloseProfile();
      return;
    }
    handleChatSelect(null);
  }, [isProfileOpen, handleCloseProfile, handleChatSelect]);

  // Build the sidebar component
  const sidebar = (
    <Sidebar className="flex-shrink-0">
      <ChatSidebar
        selectedChatId={selectedChatId}
        onChatSelect={handleChatSelect}
        activeView={sidebarView}
        onActiveViewChange={setSidebarView}
      />
    </Sidebar>
  );

  // Build the main content component
  const main = (
    <MainContent>
      {!selectedChatId && <InboxEmptyState activeView={sidebarView} />}

      {selectedChatId && !selectedContact && !contactLoadError && (
        <ConversationLoadingState />
      )}

      {selectedChatId && !selectedContact && contactLoadError && (
        <ConversationLoadError
          message={contactLoadError.message}
          onRetry={retryContactLoad}
          onBackToInbox={() => handleChatSelect(null)}
        />
      )}

      {selectedChatId && selectedContact && (
        <>
          <MessageHeader
            contact={selectedContact}
            onOpenProfile={handleOpenProfile}
            onSearch={handleOpenSearch}
            isTyping={isContactTyping}
            showBackButton
            onBack={handleBackFromConversation}
          />
          {isSearchOpen && (
            <ConversationSearch
              contactId={selectedChatId}
              onClose={handleCloseSearch}
              onNavigateToMessage={handleNavigateToMessage}
            />
          )}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <MessageActionsProvider
              // Reply/react are outbound actions gated exactly like the
              // composer itself (server-side, requireSendAccess enforces
              // this too) - offering them to an assigned-other/resolved/
              // no-permission user would let stale reply state linger and
              // reappear after a takeover, even though every click would
              // still 403/409 server-side.
              onReply={canSend ? handleReplyToMessage : undefined}
              onForward={handleForwardMessage}
              onDelete={handleDeleteMessage}
              onStar={handleStarMessage}
              onReact={canSend ? handleReactMessage : undefined}
            >
              <MessageThread
                conversationId={selectedChatId}
                currentUserId={user?.id || ""}
                currentUserName={user?.name}
                currentUserAvatarUrl={user?.avatarUrl}
                currentUserGravatarUrl={user?.gravatarUrl}
                isGroup={
                  selectedContact.isGroup ||
                  selectedContact.jid?.endsWith("@g.us")
                }
                highlightedMessageId={highlightedMessageId}
                onOpenContactInfo={handleOpenProfile}
                canRetry={canSend}
              />
            </MessageActionsProvider>
          </div>
          <ComposerLifecycleArea
            contactId={selectedChatId}
            access={composerAccess}
            isSending={isSending}
          >
            <MessageComposer
              conversationId={selectedContact?.jid}
              contactId={selectedChatId}
              replyToMessage={replyToMessage}
              onClearReply={handleClearReply}
              onSendMessage={handleSendMessage}
              onAttachFile={handleAttachFile}
              disabled={isSending}
              connection={selectedContact.connection}
              currentUserName={user?.name}
            />
          </ComposerLifecycleArea>
        </>
      )}
    </MainContent>
  );

  // Build the right panel component (contact profile)
  const rightPanel = (
    <ContactProfile
      contactId={selectedChatId || null}
      isOpen={isProfileOpen}
      onClose={handleCloseProfile}
    />
  );

  return (
    <AppLayout>
      <h1 className="sr-only">
        {t("chat.pageTitle", "WATeamInbox - Conversations")}
      </h1>
      <ResponsiveLayout
        sidebar={sidebar}
        main={main}
        rightPanel={rightPanel}
        isRightPanelOpen={isProfileOpen}
        onRightPanelClose={handleCloseProfile}
        selectedChatId={selectedChatId}
        onChatSelect={handleChatSelect}
      />
      <ForwardMessageDialog
        open={forwardDialogOpen}
        onOpenChange={handleCloseForwardDialog}
        onForward={handleForwardToContact}
        isForwarding={isForwarding}
      />
      <DeleteMessageDialog
        open={deleteDialogOpen}
        onOpenChange={handleCloseDeleteDialog}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </AppLayout>
  );
}

function ConversationLoadingState() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      role="status"
      aria-live="polite"
      aria-label={t("chat.loadingConversation", "Loading conversation")}
      aria-busy="true"
    >
      <span className="sr-only">
        {t("chat.loadingConversation", "Loading conversation")}
      </span>

      <div
        className="flex h-[60px] min-h-[60px] items-center gap-3 border-b border-gray-200 bg-gray-100 px-4 dark:border-dark-border dark:bg-dark-secondary"
        aria-hidden="true"
      >
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-36 max-w-[42%]" />
          <Skeleton className="h-2.5 w-24 max-w-[30%]" />
        </div>
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="size-9 rounded-full" />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#e5ddd5] dark:bg-dark-primary">
        <div
          className="absolute inset-0 opacity-[0.045] dark:opacity-100"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000000' fill-opacity='0.16'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />

        <div
          className="relative mx-auto flex h-full w-full max-w-4xl flex-col justify-end gap-3 px-5 py-8 sm:px-10"
          aria-hidden="true"
        >
          <div className="flex justify-center pb-2">
            <Skeleton className="h-5 w-20 rounded-full bg-black/10 dark:bg-white/10" />
          </div>
          <Skeleton className="h-12 w-[58%] max-w-md rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
          <Skeleton className="h-16 w-[46%] max-w-sm rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
          <div className="flex justify-end">
            <Skeleton className="h-12 w-[52%] max-w-md rounded-2xl rounded-br-sm bg-[#d9fdd3]/80 dark:bg-[#005c4b]/70" />
          </div>
          <Skeleton className="h-10 w-[36%] max-w-xs rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
          <div className="flex justify-end">
            <Skeleton className="h-16 w-[44%] max-w-sm rounded-2xl rounded-br-sm bg-[#d9fdd3]/80 dark:bg-[#005c4b]/70" />
          </div>
        </div>
      </div>

      <div
        className="flex min-h-[64px] items-center gap-3 border-t border-gray-200 bg-gray-100 px-3 py-2.5 dark:border-dark-border dark:bg-dark-secondary"
        aria-hidden="true"
      >
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <Skeleton className="h-10 flex-1 rounded-[1.35rem] bg-white dark:bg-dark-tertiary" />
        <Skeleton className="size-10 shrink-0 rounded-full bg-[#0b6b5d]/30 dark:bg-[#00a884]/30" />
      </div>
    </div>
  );
}

function ConversationLoadError({
  message,
  onRetry,
  onBackToInbox,
}: {
  message: string;
  onRetry: () => void;
  onBackToInbox: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#f6f8f9] px-6 dark:bg-[#0b141a]">
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.09]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
      <div className="relative flex max-w-sm flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50">
          <CircleAlert className="size-6" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-lg font-semibold tracking-tight text-[#263a33] dark:text-dark-text-primary">
          {t("chat.couldNotOpen", "Couldn't open this conversation")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#667781] dark:text-dark-text-secondary">
          {message ||
            t(
              "chat.conversationLoadFailed",
              "The conversation details could not be loaded.",
            )}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0b6b5d] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#095b50] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] focus-visible:ring-offset-2 dark:bg-[#00a884] dark:text-[#071b16] dark:hover:bg-[#06bd96]"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("chat.tryAgain", "Try again")}
          </button>
          <button
            type="button"
            onClick={onBackToInbox}
            className="inline-flex h-10 items-center rounded-full border border-[#dce4e7] bg-white px-4 text-sm font-semibold text-[#54656f] transition-colors hover:bg-[#edf1f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/[0.055] dark:text-dark-text-secondary dark:hover:bg-white/10"
          >
            {t("chat.backToInbox", "Back to inbox")}
          </button>
        </div>
      </div>
    </div>
  );
}

function InboxEmptyState({ activeView }: { activeView: SidebarView }) {
  const { t } = useTranslation();

  const isGroupView = activeView === "groups";

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#f6f8f9] dark:bg-[#0b141a]">
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.09]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.96)_0%,rgba(246,248,249,0.72)_46%,rgba(246,248,249,0)_76%)] dark:bg-[radial-gradient(circle_at_center,rgba(32,44,51,0.68)_0%,rgba(11,20,26,0.32)_48%,rgba(11,20,26,0)_78%)]"
        aria-hidden="true"
      />

      <div className="relative -mt-8 flex max-w-lg flex-col items-center px-8 text-center">
        <div className="relative mb-7 h-36 w-52" aria-hidden="true">
          <div className="absolute left-1 top-7 h-24 w-32 -rotate-6 rounded-2xl border border-[#dce4e7] bg-white/70 p-4 shadow-sm backdrop-blur-sm dark:border-white/[0.07] dark:bg-[#202c33]/60">
            <span className="block h-2 w-14 rounded-full bg-[#dfe6e8] dark:bg-white/10" />
            <span className="mt-3 block h-2 w-20 rounded-full bg-[#edf1f2] dark:bg-white/[0.06]" />
            <span className="mt-2 block h-2 w-12 rounded-full bg-[#edf1f2] dark:bg-white/[0.06]" />
          </div>

          <div className="absolute right-1 top-3 h-28 w-36 rotate-6 rounded-2xl border border-[#dce4e7] bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-white/[0.07] dark:bg-[#202c33]/70">
            <span className="ml-auto block h-8 w-20 rounded-xl rounded-br-sm bg-[#d9fdd3] dark:bg-[#005c4b]" />
            <span className="mt-3 block h-8 w-24 rounded-xl rounded-bl-sm bg-[#edf1f2] dark:bg-white/[0.07]" />
          </div>

          <div className="absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[1.65rem] border border-white bg-[#0b6b5d] text-white shadow-[0_18px_45px_rgba(11,107,93,0.25)] dark:border-white/10 dark:bg-[#00a884] dark:shadow-black/30">
            <MessagesSquare className="size-9" strokeWidth={1.65} />
          </div>

          <span className="absolute bottom-2 right-4 grid size-9 place-items-center rounded-full border-4 border-[#f6f8f9] bg-[#d9fdd3] text-[#008069] shadow-sm dark:border-[#0b141a] dark:bg-[#005c4b] dark:text-[#53bdeb]">
            <CheckCheck className="size-4.5" strokeWidth={2.1} />
          </span>
          <span className="absolute bottom-0 left-5 grid size-10 place-items-center rounded-full border-4 border-[#f6f8f9] bg-[#fff0c7] text-[#a15c00] shadow-sm dark:border-[#0b141a] dark:bg-[#3b3525] dark:text-[#ffd279]">
            <UsersRound className="size-4.5" strokeWidth={1.9} />
          </span>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-[0.19em] text-[#008069] dark:text-[#00a884]">
          {isGroupView
            ? t("chat.teamGroups", "Team groups")
            : t("chat.teamConversations", "Team conversations")}
        </p>
        <h2 className="mt-2 text-[1.7rem] font-semibold tracking-[-0.025em] text-[#263a33] dark:text-dark-text-primary">
          {isGroupView
            ? t("chat.chooseGroup", "Choose a group to open")
            : t("chat.chooseConversation", "Choose a conversation")}
        </h2>
        <p className="mt-2.5 max-w-md text-[15px] leading-6 text-[#667781] dark:text-dark-text-secondary">
          {isGroupView
            ? t(
                "chat.chooseGroupHint",
                "Open a group from the list to follow the discussion and reply with your team.",
              )
            : t(
                "chat.chooseConversationHint",
                "Open any chat from the inbox to see its history, assignments, and shared team replies.",
              )}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce4e7] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#54656f] shadow-sm backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-dark-text-secondary">
            <UsersRound className="size-3.5 text-[#008069] dark:text-[#00a884]" />
            {t("chat.sharedTeamContext", "Shared team context")}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce4e7] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#54656f] shadow-sm backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-dark-text-secondary">
            <CheckCheck className="size-3.5 text-[#008069] dark:text-[#00a884]" />
            {t("chat.whatsappSynced", "WhatsApp synced")}
          </span>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 items-center gap-2 text-xs text-[#8696a0] dark:text-dark-text-tertiary sm:flex">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        <span>
          {t("chat.selectChatHint", "Select a chat from the list to begin")}
        </span>
      </div>
    </div>
  );
}
