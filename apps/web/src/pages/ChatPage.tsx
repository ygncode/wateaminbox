import type { WhatsAppConnectionIdentity } from "@wateaminbox/shared";
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  CircleAlert,
  MessagesSquare,
  QrCode,
  RotateCcw,
  Send,
  UsersRound,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { ChannelComposerGate } from "../components/chat/ChannelComposerGate";
import { ChatSidebar, type SidebarView } from "../components/chat/ChatSidebar";
import { ComposerLifecycleArea } from "../components/chat/ComposerLifecycleArea";
import { ConversationLifecycleActions } from "../components/chat/ConversationLifecycleActions";
import { ConversationSearch } from "../components/chat/ConversationSearch";
import { ContactProfile } from "../components/chat/contact-profile";
import { DeleteMessageDialog } from "../components/chat/DeleteMessageDialog";
import { ForwardMessageDialog } from "../components/chat/ForwardMessageDialog";
import {
  type InboxConnectionState,
  resolveInboxConnectionState,
} from "../components/chat/inbox-connection-state";
import { MessageComposer } from "../components/chat/MessageComposer";
import { MessageHeader } from "../components/chat/MessageHeader";
import { MessageThread } from "../components/chat/MessageThread";
import { ConversationMessagesSkeleton } from "../components/chat/ConversationMessagesSkeleton";
import { SharedContactSheet } from "../components/chat/SharedContactSheet";
import { channelDisplayName } from "../components/connections/channel-catalog";
import { AppLayout, ResponsiveLayout } from "../components/layout/app-layout";
import { CONVERSATION_HEADER_INSET_CLASS } from "../components/layout/conversation-chrome";
import { MainContent } from "../components/layout/main-content";
import { Sidebar } from "../components/layout/sidebar";
import { Skeleton } from "../components/ui";
import { useAuth } from "../contexts/auth-context";
import {
  MessageActionsProvider,
  type SharedContactCard,
} from "../contexts/message-actions-context";
import { useWorkspace } from "../contexts/workspace-context";
import { useChatPageState } from "../hooks/chat";
import { useCustomerChats } from "../hooks/contact/useCustomerChats";
import { useKeyboardInset } from "../hooks/ui";
import {
  useChannelAccountCapabilities,
  useChannelAccounts,
} from "../hooks/useChannelAccounts";
import { useChannelConversation } from "../hooks/useChannelConversations";
import { useComposerAccess } from "../hooks/useComposerAccess";
import { useCreateContact } from "../hooks/useContact";
import { useGroup } from "../hooks/useGroups";
import { useWhatsAppConnectionsList } from "../hooks/whatsapp";
import { sendChannelMessage } from "../lib/api/channel-conversations";
import { ApiRequestError } from "../lib/api/client";
import { uploadMedia } from "../lib/api/messages";
import { transformChannelConversationToChat } from "../lib/api/transformers";
import { cn } from "../lib/utils";
import {
  parseChatView,
  withChatView,
  workspacePath,
} from "../lib/workspace-routes";

export function ChatPage() {
  const { t } = useTranslation();

  const { user } = useAuth();
  const { activeWorkspace, can } = useWorkspace();
  const navigate = useNavigate();
  const createSharedContact = useCreateContact();
  const [sharedContactCard, setSharedContactCard] =
    useState<SharedContactCard | null>(null);
  const { pathname, search } = useLocation();
  const {
    data: connections = [],
    isLoading: areConnectionsLoading,
    isError: areConnectionsUnavailable,
  } = useWhatsAppConnectionsList();
  const {
    data: channelAccounts = [],
    isLoading: areChannelAccountsLoading,
    isError: areChannelAccountsUnavailable,
  } = useChannelAccounts();
  const inboxConnectionState = resolveInboxConnectionState({
    connections,
    channelAccounts,
    isLoading: areConnectionsLoading || areChannelAccountsLoading,
    isError: areConnectionsUnavailable || areChannelAccountsUnavailable,
  });
  const canManageConnections = can("can_manage_connections");
  const handleConnectChannels = useCallback(() => {
    if (!activeWorkspace || !canManageConnections) return;
    navigate(workspacePath(activeWorkspace.id, "settings", "connections"));
  }, [activeWorkspace, canManageConnections, navigate]);

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
    selectedRowId,
    selectedContact,
    contactLoadError,
    isContactLoading,
    isContactTyping,
    isProfileOpen,
    profileContactId,
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
    handleThreadSelect,
    retryContactLoad,
    handleOpenProfile,
    handleOpenParticipantProfile,
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
  const { data: channelConversation, isLoading: isChannelConversationLoading } =
    useChannelConversation(selectedChatId);
  const conversationContact = useMemo(
    () =>
      channelConversation
        ? transformChannelConversationToChat(channelConversation).contact
        : undefined,
    [channelConversation],
  );
  const threadContact = selectedContact ?? conversationContact;
  // The thread being read, as the switcher describes it. A contact read
  // canonicalises to the surviving customer, so for a merged customer it
  // answers with the wrong thread's identity - and with no JID at all when
  // that customer arrived on a channel other than WhatsApp, which left the
  // composer with nothing to address and so removed it from the screen.
  const { data: customerThreads = [] } = useCustomerChats(selectedRowId);
  const activeThread = customerThreads.find(
    (thread) => thread.chatId === selectedChatId,
  );
  const isThreadLoading =
    Boolean(selectedChatId) &&
    !threadContact &&
    (isContactLoading || isChannelConversationLoading);
  const isThreadMissing =
    Boolean(selectedChatId) && !threadContact && !isThreadLoading;
  const {
    data: channelCapabilities,
    isLoading: areChannelCapabilitiesLoading,
  } = useChannelAccountCapabilities(channelConversation?.channelAccountId);
  const handleChannelSendMessage = useCallback(
    (content: string, replyToMessageId?: string, mentionedJids?: string[]) => {
      if (channelConversation) {
        void sendChannelMessage(channelConversation.id, {
          content,
          messageType: "text",
          replyToMessageId,
        });
        handleClearReply();
        return;
      }
      handleSendMessage(content, replyToMessageId, mentionedJids);
    },
    [channelConversation, handleClearReply, handleSendMessage],
  );
  const handleChannelAttachFile = useCallback(
    async (
      files: File[],
      type: "image" | "document",
      caption: string,
    ): Promise<boolean> => {
      if (!channelConversation) {
        return handleAttachFile(files, type, caption);
      }
      try {
        for (const [index, file] of files.entries()) {
          const uploaded = await uploadMedia(file);
          let messageType: "image" | "video" | "audio" | "document" =
            "document";
          if (uploaded.mimeType.startsWith("image/")) messageType = "image";
          else if (uploaded.mimeType.startsWith("video/"))
            messageType = "video";
          else if (uploaded.mimeType.startsWith("audio/"))
            messageType = "audio";
          await sendChannelMessage(channelConversation.id, {
            content: index === 0 ? caption : "",
            messageType,
            mediaUrl: uploaded.mediaUrl,
          });
        }
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to send attachment",
        );
        return false;
      }
    },
    [channelConversation, handleAttachFile],
  );

  const handleOpenSharedContact = useCallback((contact: SharedContactCard) => {
    setSharedContactCard(contact);
  }, []);

  const handleCloseSharedContact = useCallback(() => {
    if (!createSharedContact.isPending) setSharedContactCard(null);
  }, [createSharedContact.isPending]);

  const handleMessageSharedContact = useCallback(
    async (contact: SharedContactCard) => {
      const phoneNumber = contact.phoneNumbers[0]?.value;
      if (!phoneNumber || createSharedContact.isPending) return;

      try {
        const destination = await createSharedContact.mutateAsync({
          phoneNumber,
          connectionId:
            activeThread?.connection?.id ?? selectedContact?.connection?.id,
          customName: contact.displayName.slice(0, 100),
        });
        setSharedContactCard(null);
        handleChatSelect(destination.id);
      } catch (error) {
        const existingContactId =
          error instanceof ApiRequestError && error.statusCode === 409
            ? error.details?.id
            : undefined;
        if (typeof existingContactId === "string") {
          setSharedContactCard(null);
          handleChatSelect(existingContactId);
          return;
        }

        toast.error(
          error instanceof Error
            ? error.message
            : t(
                "chat.messageContactFailed",
                "Could not open this contact's conversation",
              ),
        );
      }
    },
    [
      activeThread?.connection?.id,
      createSharedContact,
      handleChatSelect,
      selectedContact?.connection?.id,
      t,
    ],
  );

  const handleMessageProfileContact = useCallback(() => {
    if (!profileContactId || profileContactId === selectedChatId) return;
    handleCloseProfile();
    handleChatSelect(profileContactId);
  }, [handleChatSelect, handleCloseProfile, profileContactId, selectedChatId]);

  // Single source of truth for the composer gate, shared with
  // ComposerLifecycleArea below - both must agree on whether this user can
  // currently send, or the reply/react/retry affordances rendered here could
  // diverge from what the composer itself shows.
  // Assignment and blocked state belong to the thread being read. Asking
  // about the surviving customer gates the wrong conversation: a thread
  // assigned to someone else shows a live composer, and one assigned to this
  // user shows the take-over bar that assigning cannot clear.
  // Contact reads accept a conversation UUID and resolve it to a contact, but
  // contact mutations do not. Keep the thread's real contact UUID once it has
  // been resolved so Take over/Unblock never POST a conversation UUID to a
  // `/contacts/:id/*` route (which responds with "Contact not found").
  const composerContactId =
    activeThread?.contactId ?? selectedContact?.id ?? selectedChatId ?? null;
  const { access: composerAccess } = useComposerAccess(composerContactId);
  const canSend = composerAccess.kind === "sendable";
  // The thread's own JID decides this. A merged customer's surviving contact
  // may be neutral and JID-less, which read as "not a group" and stripped
  // mentions from a WhatsApp group thread the operator was actually in.
  const threadJid = activeThread?.jid ?? threadContact?.jid;
  const isSelectedGroup = Boolean(
    threadContact && (threadContact.isGroup || threadJid?.endsWith("@g.us")),
  );
  const { data: selectedGroup } = useGroup(
    isSelectedGroup ? (selectedChatId ?? null) : null,
  );

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
        selectedChatId={selectedRowId}
        onChatSelect={handleChatSelect}
        activeView={sidebarView}
        onActiveViewChange={setSidebarView}
      />
    </Sidebar>
  );

  // Build the main content component
  const main = (
    <MainContent>
      {!selectedChatId && inboxConnectionState === "loading" && (
        <InboxConnectionLoadingState />
      )}

      {!selectedChatId && inboxConnectionState === "no-connections" && (
        <InboxFirstRunState
          canManageConnections={canManageConnections}
          onConnect={handleConnectChannels}
        />
      )}

      {!selectedChatId &&
        inboxConnectionState !== "loading" &&
        inboxConnectionState !== "no-connections" && (
          <InboxEmptyState
            activeView={sidebarView}
            connectionState={inboxConnectionState}
          />
        )}

      {isThreadLoading && <ConversationLoadingState />}

      {isThreadMissing && (
        <ConversationLoadError
          message={contactLoadError?.message ?? "Conversation not found"}
          onRetry={retryContactLoad}
          onBackToInbox={() => handleChatSelect(null)}
        />
      )}

      {selectedChatId && threadContact && (
        <>
          <MessageHeader
            contact={threadContact}
            thread={activeThread}
            threadCount={customerThreads.length}
            onOpenProfile={handleOpenProfile}
            onSearch={handleOpenSearch}
            isTyping={isContactTyping}
            showBackButton
            onBack={handleBackFromConversation}
          />
          {isSearchOpen && (
            <ConversationSearch
              // Scoped to the thread on screen. The canonical contact's id
              // searched the surviving customer's other conversation, and the
              // API prefers `contactId` when both are given, so results came
              // from a thread whose messages are not even rendered.
              contactId={activeThread?.contactId ?? selectedContact?.id}
              conversationId={
                activeThread?.conversationId ??
                threadContact.conversationId ??
                channelConversation?.id
              }
              onClose={handleCloseSearch}
              onNavigateToMessage={handleNavigateToMessage}
            />
          )}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <MessageActionsProvider
              // Reply/react are outbound actions gated exactly like the
              // composer itself (server-side, requireSendAccess enforces
              // this too) - offering them to an assigned-other/resolved/
              // blocked/no-permission user would let stale reply state
              // linger and reappear after a takeover, even though every
              // click would still 403/409 server-side.
              onReply={canSend ? handleReplyToMessage : undefined}
              onForward={handleForwardMessage}
              onDelete={handleDeleteMessage}
              onStar={handleStarMessage}
              onReact={canSend ? handleReactMessage : undefined}
              // Read-only: opening a member's profile is a detail view, so it
              // is offered regardless of whether this user can send here.
              onOpenParticipantProfile={handleOpenParticipantProfile}
              onOpenSharedContact={handleOpenSharedContact}
              onMessageSharedContact={handleMessageSharedContact}
              // Neutral channel threads are additionally bounded by their
              // adapter contract; legacy linked-device threads pass undefined
              // and keep their existing action set.
              capabilities={channelConversation ? channelCapabilities : null}
            >
              <MessageThread
                conversationId={selectedChatId}
                customerRowId={selectedRowId}
                currentUserId={user?.id || ""}
                currentUserName={user?.name}
                currentUserAvatarUrl={user?.avatarUrl}
                currentUserGravatarUrl={user?.gravatarUrl}
                isGroup={isSelectedGroup}
                highlightedMessageId={highlightedMessageId}
                onOpenContactInfo={handleOpenProfile}
                canRetry={canSend}
                // Only an adapter that reports remote history can be asked
                // for it; legacy linked-device threads keep the affordance.
                canLoadRemoteHistory={
                  channelConversation
                    ? (channelCapabilities?.actions.remoteHistory ?? false)
                    : true
                }
              />
            </MessageActionsProvider>
          </div>
          <ComposerLifecycleArea
            contactId={composerContactId!}
            access={composerAccess}
            isSending={isSending}
            contactName={threadContact.name}
          >
            {channelConversation ? (
              <ChannelComposerGate
                capabilities={channelCapabilities}
                isLoading={areChannelCapabilitiesLoading}
              >
                <MessageComposer
                  conversationId={channelConversation.id}
                  contactId={selectedChatId}
                  replyToMessage={replyToMessage}
                  onClearReply={handleClearReply}
                  onSendMessage={handleChannelSendMessage}
                  onAttachFile={handleChannelAttachFile}
                  disabled={isSending}
                  connection={null}
                  channelAccount={{
                    displayName: channelConversation.account.displayName,
                    username: channelConversation.account.username,
                    channelName: channelDisplayName(
                      channelConversation.channel,
                    ),
                    status: channelConversation.account.status,
                  }}
                  currentUserName={user?.name}
                  mentionParticipants={selectedGroup?.participants}
                  onSelectChat={handleThreadSelect}
                  // The account a reply leaves on, not the customer it reaches.
                  channelAddress={
                    channelConversation.account.username
                      ? `@${channelConversation.account.username}`
                      : null
                  }
                  trailing={
                    <ConversationLifecycleActions
                      contactId={selectedChatId}
                      isSending={isSending}
                    />
                  }
                />
              </ChannelComposerGate>
            ) : (
              <MessageComposer
                conversationId={activeThread?.jid ?? threadContact.jid}
                contactId={activeThread?.contactId ?? selectedChatId}
                replyToMessage={replyToMessage}
                onClearReply={handleClearReply}
                onSendMessage={handleSendMessage}
                onAttachFile={handleChannelAttachFile}
                disabled={isSending}
                // The thread's own connection, not the surviving customer's:
                // a merged customer whose canonical contact arrived on another
                // channel has none, which the composer read as "disconnected"
                // and refused to send.
                connection={
                  activeThread?.connection
                    ? {
                        id: activeThread.connection.id,
                        name: activeThread.connection.name,
                        phoneNumber: activeThread.connection.phoneNumber,
                        status: activeThread.connection
                          .status as WhatsAppConnectionIdentity["status"],
                      }
                    : selectedContact?.connection
                }
                currentUserName={user?.name}
                mentionParticipants={selectedGroup?.participants}
                onSelectChat={handleThreadSelect}
                channelAddress={null}
                trailing={
                  <ConversationLifecycleActions
                    contactId={selectedChatId}
                    isSending={isSending}
                  />
                }
              />
            )}
          </ComposerLifecycleArea>
        </>
      )}
    </MainContent>
  );

  // Build the right panel component (contact profile)
  const rightPanel = (
    <ContactProfile
      contactId={profileContactId || null}
      isOpen={isProfileOpen}
      onClose={handleCloseProfile}
      onMessage={
        profileContactId && profileContactId !== selectedChatId
          ? handleMessageProfileContact
          : undefined
      }
      onOpenParticipantProfile={handleOpenParticipantProfile}
      onSelectThread={handleThreadSelect}
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
        rightPanelPresentation={
          profileContactId && profileContactId !== selectedChatId
            ? "bottom-sheet"
            : "side"
        }
        selectedChatId={selectedChatId}
        onChatSelect={handleChatSelect}
      />
      <SharedContactSheet
        contact={sharedContactCard}
        onClose={handleCloseSharedContact}
        onMessage={handleMessageSharedContact}
        isMessaging={createSharedContact.isPending}
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

      {/* Same inset utility as the real header, so the bar does not change
          height when the contact resolves. */}
      <div
        className={cn(
          "flex items-center gap-3 border-b border-line bg-muted px-4",
          CONVERSATION_HEADER_INSET_CLASS,
        )}
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

      <ConversationMessagesSkeleton decorative />

      <div
        className="flex min-h-[64px] items-center gap-3 border-t border-line bg-muted px-3 py-2.5"
        aria-hidden="true"
      >
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <Skeleton className="h-10 flex-1 rounded-[1.35rem] bg-surface" />
        <Skeleton className="size-10 shrink-0 rounded-full bg-accent/30" />
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
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-subtle px-6">
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
        <span className="grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger ring-1 ring-danger">
          <CircleAlert className="size-6" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-lg font-semibold tracking-tight text-fg">
          {t("chat.couldNotOpen", "Couldn't open this conversation")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
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
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("chat.tryAgain", "Try again")}
          </button>
          <button
            type="button"
            onClick={onBackToInbox}
            className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-fg-muted transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("chat.backToInbox", "Back to inbox")}
          </button>
        </div>
      </div>
    </div>
  );
}

function InboxConnectionLoadingState() {
  const { t } = useTranslation();

  return (
    <div
      className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-subtle"
      role="status"
      aria-label={t("chat.checkingChannels", "Checking connected channels")}
      aria-busy="true"
    >
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.09]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />
      <div className="relative flex w-full max-w-md flex-col items-center px-8">
        <Skeleton className="size-20 rounded-[1.65rem]" />
        <Skeleton className="mt-7 h-3 w-32 rounded-full" />
        <Skeleton className="mt-4 h-8 w-72 max-w-full rounded-lg" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-md" />
      </div>
    </div>
  );
}

function InboxFirstRunState({
  canManageConnections,
  onConnect,
}: {
  canManageConnections: boolean;
  onConnect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-subtle px-5 py-8 sm:px-8">
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.085]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />

      <section className="relative grid w-full max-w-4xl overflow-hidden rounded-[2rem] border border-line bg-overlay/90 shadow-lg backdrop-blur-sm lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col justify-center px-7 py-9 sm:px-10 sm:py-12 lg:px-12">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-subtle px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-accent">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            {t("chat.sharedInboxSetup", "Shared inbox setup")}
          </div>

          <h1 className="mt-6 max-w-lg text-[2rem] font-semibold leading-[1.08] tracking-[-0.045em] text-fg sm:text-[2.55rem]">
            {t("chat.connectChannelsTitle", "Connect your first channel")}
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-7 text-fg-muted">
            {canManageConnections
              ? t(
                  "chat.connectChannelsHint",
                  "Bring WhatsApp and Telegram into one team inbox. Messages, assignments, and follow-ups stay together as you add more channels.",
                )
              : t(
                  "chat.askAdminToConnectChannel",
                  "Ask a workspace owner or admin to connect a channel. Conversations will appear here once an account is linked.",
                )}
          </p>

          {canManageConnections && (
            <button
              type="button"
              onClick={onConnect}
              className="mt-8 inline-flex h-12 w-fit items-center gap-3 rounded-xl bg-primary px-5 text-sm font-semibold text-on-primary shadow-lg transition-all hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t("chat.connectChannels", "Connect channels")}
              <span className="grid size-6 place-items-center rounded-md bg-on-primary/15">
                <ArrowRight
                  className="size-4 rtl:-scale-x-100"
                  aria-hidden="true"
                />
              </span>
            </button>
          )}

          <div className="mt-8 flex items-start gap-2.5 border-t border-line pt-5 text-xs leading-5 text-fg-muted">
            <CheckCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              {t(
                "chat.channelCredentialsHint",
                "Channel credentials are encrypted, and each connected account stays under your control.",
              )}
            </span>
          </div>
        </div>

        <div className="relative flex min-h-[27rem] flex-col border-t border-line bg-muted p-7 lg:border-s lg:border-t-0">
          <div>
            <p className="text-sm font-semibold text-accent">
              {t("chat.chooseChannelTitle", "Choose where to start")}
            </p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">
              {t(
                "chat.chooseChannelHint",
                "Connect the channels your customers already use.",
              )}
            </p>
          </div>

          <div className="my-7 grid gap-3">
            <div className="group relative overflow-hidden rounded-2xl border border-line-strong bg-surface/70 p-4 shadow-lg">
              <div className="absolute -end-8 -top-8 size-24 rounded-full bg-accent/10 blur-2xl" />
              <div className="relative flex items-center gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent ring-1 ring-ring">
                  <QrCode
                    className="size-6"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-accent">
                      {t("chat.whatsappChannel", "WhatsApp")}
                    </p>
                    <span className="rounded-full bg-accent-soft px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-accent">
                      {t("chat.readyNow", "Ready now")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">
                    {t(
                      "chat.whatsappConnectHint",
                      "Pair securely with a QR code",
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl border border-line-strong bg-surface/70 p-4 shadow-lg">
              <div className="absolute -end-8 -top-8 size-24 rounded-full bg-info/10 blur-2xl" />
              <div className="relative flex items-center gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-info-soft text-info ring-1 ring-info">
                  <Send
                    className="size-6"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-accent">
                      {t("chat.telegramChannel", "Telegram Bot")}
                    </p>
                    <span className="rounded-full bg-info-soft px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-info">
                      {t("chat.readyNow", "Ready now")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">
                    {t(
                      "chat.telegramConnectHint",
                      "Add a bot token from BotFather",
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto flex items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-subtle px-4 py-3">
            <span
              className="flex -space-x-1.5 rtl:space-x-reverse"
              aria-hidden="true"
            >
              {["bg-id-5", "bg-id-7", "bg-id-3"].map((color) => (
                <span
                  key={color}
                  className={`size-5 rounded-full border-2 border-surface ${color}`}
                />
              ))}
            </span>
            <p className="text-[11px] font-semibold text-fg-muted">
              {t("chat.moreChannelsSoon", "More channels are on the way")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function InboxEmptyState({
  activeView,
  connectionState,
}: {
  activeView: SidebarView;
  connectionState: Exclude<InboxConnectionState, "loading" | "no-connections">;
}) {
  const { t } = useTranslation();

  const isGroupView = activeView === "groups";

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-subtle">
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
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--surface)_0%,transparent_76%)]"
        aria-hidden="true"
      />

      <div className="relative -mt-8 flex max-w-lg flex-col items-center px-8 text-center">
        <div className="relative mb-7 h-36 w-52" aria-hidden="true">
          <div className="absolute start-1 top-7 h-24 w-32 -rotate-6 rounded-2xl border border-line bg-overlay/70 p-4 shadow-sm backdrop-blur-sm">
            <span className="block h-2 w-14 rounded-full bg-muted-strong" />
            <span className="mt-3 block h-2 w-20 rounded-full bg-muted" />
            <span className="mt-2 block h-2 w-12 rounded-full bg-muted" />
          </div>

          <div className="absolute end-1 top-3 h-28 w-36 rotate-6 rounded-2xl border border-line bg-overlay/80 p-4 shadow-sm backdrop-blur-sm">
            <span className="ms-auto block h-8 w-20 rounded-xl rounded-ee-sm bg-accent-soft" />
            <span className="mt-3 block h-8 w-24 rounded-xl rounded-es-sm bg-muted" />
          </div>

          <div className="absolute start-1/2 top-1/2 grid size-20 -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 place-items-center rounded-[1.65rem] border border-surface bg-primary text-on-primary shadow-lg">
            <MessagesSquare className="size-9" strokeWidth={1.65} />
          </div>

          {connectionState !== "unavailable" && (
            <span
              className={cn(
                "absolute bottom-2 end-4 grid size-9 place-items-center rounded-full border-4 border-line shadow-sm",
                connectionState === "connected"
                  ? "bg-accent-soft text-accent"
                  : "bg-warning-soft text-warning",
              )}
            >
              {connectionState === "connected" ? (
                <CheckCheck className="size-4.5" strokeWidth={2.1} />
              ) : (
                <CircleAlert className="size-4" strokeWidth={2} />
              )}
            </span>
          )}
          <span className="absolute bottom-0 start-5 grid size-10 place-items-center rounded-full border-4 border-line bg-warning-soft text-warning shadow-sm">
            <UsersRound className="size-4.5" strokeWidth={1.9} />
          </span>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-[0.19em] text-accent">
          {isGroupView
            ? t("chat.teamGroups", "Team groups")
            : t("chat.teamConversations", "Team conversations")}
        </p>
        <h2 className="mt-2 text-[1.7rem] font-semibold tracking-[-0.025em] text-fg">
          {isGroupView
            ? t("chat.chooseGroup", "Choose a group to open")
            : t("chat.chooseConversation", "Choose a conversation")}
        </h2>
        <p className="mt-2.5 max-w-md text-[15px] leading-6 text-fg-muted">
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-xs font-medium text-fg-muted shadow-sm backdrop-blur-sm">
            <UsersRound className="size-3.5 text-accent" />
            {t("chat.sharedTeamContext", "Shared team context")}
          </span>
          {connectionState !== "unavailable" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-xs font-medium text-fg-muted shadow-sm backdrop-blur-sm">
              {connectionState === "connected" ? (
                <CheckCheck className="size-3.5 text-accent" />
              ) : (
                <CircleAlert className="size-3.5 text-warning" />
              )}
              {connectionState === "connected"
                ? t("chat.whatsappSynced", "WhatsApp synced")
                : t("chat.whatsappOffline", "WhatsApp needs attention")}
            </span>
          )}
        </div>
      </div>

      <div className="absolute bottom-8 start-1/2 hidden -translate-x-1/2 rtl:translate-x-1/2 items-center gap-2 text-xs text-fg-muted sm:flex">
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        <span>
          {t("chat.selectChatHint", "Select a chat from the list to begin")}
        </span>
      </div>
    </div>
  );
}
