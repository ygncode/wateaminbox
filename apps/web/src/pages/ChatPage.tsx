import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/auth-context";
import { AppLayout, ResponsiveLayout } from "../components/layout/app-layout";
import { Sidebar } from "../components/layout/sidebar";
import { MainContent } from "../components/layout/main-content";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { MessageThread } from "../components/chat/MessageThread";
import { MessageComposer } from "../components/chat/MessageComposer";
import { MessageHeader } from "../components/chat/MessageHeader";
import { ContactProfile } from "../components/chat/ContactProfile";
import { ConversationSearch } from "../components/chat/ConversationSearch";
import { useContact, type ContactDetail } from "../hooks/useContact";
import { useSendMessage } from "../hooks/useMessages";
import type { Message, Contact } from "@whatsapp-web/shared";

// Helper to map ContactDetail to Contact type expected by MessageHeader
function mapContactDetailToContact(detail: ContactDetail): Contact {
  return {
    id: detail.id,
    name: detail.displayName,
    phoneNumber: detail.phoneNumber || "",
    avatarUrl: detail.profilePictureUrl || undefined,
    customName: detail.customName || undefined,
  };
}

export function ChatPage() {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedChatId, setSelectedChatId] = React.useState<
    string | undefined
  >(contactId);
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = React.useState<Message | null>(
    null,
  );

  // Fetch contact data for the selected chat
  const { data: contactDetail } = useContact(selectedChatId || null);
  const selectedContact = contactDetail
    ? mapContactDetailToContact(contactDetail)
    : undefined;

  // Send message mutation
  const sendMessage = useSendMessage();

  // Sync URL with selected chat
  React.useEffect(() => {
    setSelectedChatId(contactId);
  }, [contactId]);

  const handleChatSelect = React.useCallback(
    (chatId: string | null) => {
      setSelectedChatId(chatId || undefined);
      setIsProfileOpen(false);
      setIsSearchOpen(false);
      setHighlightedMessageId(null);
      if (chatId) {
        navigate(`/chat/${chatId}`);
      } else {
        navigate("/chat");
      }
    },
    [navigate],
  );

  const handleOpenProfile = React.useCallback(() => {
    setIsProfileOpen(true);
  }, []);

  const handleCloseProfile = React.useCallback(() => {
    setIsProfileOpen(false);
  }, []);

  const handleOpenSearch = React.useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const handleCloseSearch = React.useCallback(() => {
    setIsSearchOpen(false);
    setHighlightedMessageId(null);
  }, []);

  const handleNavigateToMessage = React.useCallback((messageId: string) => {
    setHighlightedMessageId(messageId);
  }, []);

  const handleReplyToMessage = React.useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);

  const handleClearReply = React.useCallback(() => {
    setReplyToMessage(null);
  }, []);

  const handleSendMessage = React.useCallback(
    (content: string, _replyToMessageId?: string) => {
      if (!selectedChatId) return;

      sendMessage.mutate({
        contactId: selectedChatId,
        content,
        messageType: "text",
      });
      setReplyToMessage(null);
    },
    [selectedChatId, sendMessage],
  );

  const handleAttachFile = React.useCallback(
    (file: File, type: "image" | "document") => {
      // TODO: Implement file upload
      console.log("Attaching file:", file.name, type);
    },
    [],
  );

  // Build the sidebar component
  const sidebar = (
    <Sidebar className="w-full md:w-[350px] lg:w-[400px] flex-shrink-0">
      <ChatSidebar
        selectedChatId={selectedChatId}
        onChatSelect={handleChatSelect}
      />
    </Sidebar>
  );

  // Build the main content component
  const main = (
    <MainContent className="flex-1 flex flex-col">
      {selectedChatId && selectedContact ? (
        <>
          <MessageHeader
            contact={selectedContact}
            onOpenProfile={handleOpenProfile}
            onSearch={handleOpenSearch}
          />
          {isSearchOpen && (
            <ConversationSearch
              contactId={selectedChatId}
              onClose={handleCloseSearch}
              onNavigateToMessage={handleNavigateToMessage}
            />
          )}
          <div className="flex-1 overflow-hidden">
            <MessageThread
              conversationId={selectedChatId}
              currentUserId={user?.id || ""}
              onReplyToMessage={handleReplyToMessage}
              highlightedMessageId={highlightedMessageId}
            />
          </div>
          <MessageComposer
            conversationId={selectedChatId}
            replyToMessage={replyToMessage}
            onClearReply={handleClearReply}
            onSendMessage={handleSendMessage}
            onAttachFile={handleAttachFile}
            disabled={sendMessage.isPending}
          />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md px-4">
            <div className="w-20 h-20 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-12 h-12 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              WhatsApp Web
            </h2>
            <p className="text-gray-500">
              Select a conversation from the list to start messaging
            </p>
          </div>
        </div>
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
      <ResponsiveLayout
        sidebar={sidebar}
        main={main}
        rightPanel={rightPanel}
        isRightPanelOpen={isProfileOpen}
        onRightPanelClose={handleCloseProfile}
        selectedChatId={selectedChatId}
        onChatSelect={handleChatSelect}
      />
    </AppLayout>
  );
}
