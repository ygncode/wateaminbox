import {
  ArrowLeft,
  CheckCheck,
  MessagesSquare,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { ChatSidebar, type SidebarView } from "../components/chat/ChatSidebar";
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
import { useAuth } from "../contexts/auth-context";
import { MessageActionsProvider } from "../contexts/message-actions-context";
import { useChatPageState } from "../hooks/chat";

export function ChatPage() {
  const { user } = useAuth();
  const [sidebarView, setSidebarView] = useState<SidebarView>("chats");

  const {
    // State
    selectedChatId,
    selectedContact,
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
    <MainContent className="min-w-0 flex-1 flex flex-col">
      {selectedChatId && selectedContact ? (
        <>
          <MessageHeader
            contact={selectedContact}
            onOpenProfile={handleOpenProfile}
            onSearch={handleOpenSearch}
            isTyping={isContactTyping}
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
              onReply={handleReplyToMessage}
              onForward={handleForwardMessage}
              onDelete={handleDeleteMessage}
              onStar={handleStarMessage}
              onReact={handleReactMessage}
            >
              <MessageThread
                conversationId={selectedChatId}
                currentUserId={user?.id || ""}
                isGroup={
                  selectedContact.isGroup ||
                  selectedContact.jid?.endsWith("@g.us")
                }
                highlightedMessageId={highlightedMessageId}
                onOpenContactInfo={handleOpenProfile}
              />
            </MessageActionsProvider>
          </div>
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
        </>
      ) : (
        <InboxEmptyState activeView={sidebarView} />
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
      <h1 className="sr-only">WATeamInbox - Conversations</h1>
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

function InboxEmptyState({ activeView }: { activeView: SidebarView }) {
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
          {isGroupView ? "Team groups" : "Team conversations"}
        </p>
        <h2 className="mt-2 text-[1.7rem] font-semibold tracking-[-0.025em] text-[#263a33] dark:text-dark-text-primary">
          {isGroupView ? "Choose a group to open" : "Choose a conversation"}
        </h2>
        <p className="mt-2.5 max-w-md text-[15px] leading-6 text-[#667781] dark:text-dark-text-secondary">
          {isGroupView
            ? "Open a group from the list to follow the discussion and reply with your team."
            : "Open any chat from the inbox to see its history, assignments, and shared team replies."}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce4e7] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#54656f] shadow-sm backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-dark-text-secondary">
            <UsersRound className="size-3.5 text-[#008069] dark:text-[#00a884]" />
            Shared team context
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce4e7] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#54656f] shadow-sm backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-dark-text-secondary">
            <CheckCheck className="size-3.5 text-[#008069] dark:text-[#00a884]" />
            WhatsApp synced
          </span>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 items-center gap-2 text-xs text-[#8696a0] dark:text-dark-text-tertiary sm:flex">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        <span>Select a chat from the list to begin</span>
      </div>
    </div>
  );
}
