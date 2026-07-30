import { useQueryClient } from "@tanstack/react-query";
import type { Contact, Message } from "@wateaminbox/shared";
import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useWorkspace } from "../../contexts/workspace-context";
import { markConversationAsRead, uploadMedia } from "../../lib/api";
import { workspacePath } from "../../lib/workspace-routes";
import { useChatStore } from "../../stores/chat-store";
import { getReactionMutationEmoji } from "../messages/useReactionMutations";
import { chatKeys } from "../useChats";
import { type ContactDetail, useContact } from "../useContact";
import {
  useDeleteMessage,
  useForwardMessage,
  useReactMessage,
  useSendMessage,
  useStarMessage,
} from "../useMessages";

// Helper to map ContactDetail to Contact type expected by MessageHeader
function mapContactDetailToContact(detail: ContactDetail): Contact {
  return {
    id: detail.id,
    name: detail.displayName,
    phoneNumber: detail.phoneNumber || "",
    jid: detail.jid || undefined,
    avatarUrl: detail.profilePictureUrl || undefined,
    customName: detail.customName || undefined,
    isOnline: detail.isOnline,
    lastSeen: detail.lastSeen ? new Date(detail.lastSeen) : undefined,
    isGroup: detail.isGroup,
    connection: detail.connection,
  };
}

export interface ChatPageState {
  // Chat selection
  selectedChatId: string | undefined;
  selectedContact: Contact | undefined;
  contactLoadError: Error | null;
  isContactTyping: boolean;

  // Panel visibility
  isProfileOpen: boolean;
  isSearchOpen: boolean;
  highlightedMessageId: string | null;

  // Reply state
  replyToMessage: Message | null;

  // Forward dialog state
  forwardDialogOpen: boolean;
  messageToForward: Message | null;
  isForwarding: boolean;

  // Delete dialog state
  deleteDialogOpen: boolean;
  messageToDelete: Message | null;
  isDeleting: boolean;

  // Send state
  isSending: boolean;
}

export interface ChatPageActions {
  // Chat selection
  handleChatSelect: (chatId: string | null) => void;
  retryContactLoad: () => void;

  // Profile panel
  handleOpenProfile: () => void;
  handleCloseProfile: () => void;

  // Search panel
  handleOpenSearch: () => void;
  handleCloseSearch: () => void;
  handleNavigateToMessage: (messageId: string) => void;

  // Reply
  handleReplyToMessage: (message: Message) => void;
  handleClearReply: () => void;

  // Send message
  handleSendMessage: (content: string, replyToMessageId?: string) => void;
  handleAttachFile: (
    file: File,
    type: "image" | "document",
    caption: string,
  ) => Promise<boolean>;

  // Delete message
  handleDeleteMessage: (message: Message) => void;
  handleConfirmDelete: () => void;
  handleCloseDeleteDialog: () => void;

  // Star message
  handleStarMessage: (message: Message) => void;

  // React to message
  handleReactMessage: (message: Message, emoji: string) => void;

  // Forward message
  handleForwardMessage: (message: Message) => void;
  handleForwardToContact: (targetContactId: string) => void;
  handleCloseForwardDialog: () => void;
}

export function useChatPageState(): ChatPageState & ChatPageActions {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  // Chat selection state
  const [selectedChatId, setSelectedChatId] = React.useState<
    string | undefined
  >(contactId);

  // Panel visibility state
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<
    string | null
  >(null);

  // Reply state
  const [replyToMessage, setReplyToMessage] = React.useState<Message | null>(
    null,
  );

  // Forward dialog state
  const [forwardDialogOpen, setForwardDialogOpen] = React.useState(false);
  const [messageToForward, setMessageToForward] =
    React.useState<Message | null>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [messageToDelete, setMessageToDelete] = React.useState<Message | null>(
    null,
  );

  // Fetch contact data for the selected chat
  const {
    data: contactDetail,
    error: contactLoadError,
    refetch: refetchContact,
  } = useContact(selectedChatId || null);
  const selectedContact = contactDetail
    ? mapContactDetailToContact(contactDetail)
    : undefined;

  const retryContactLoad = React.useCallback(() => {
    void refetchContact();
  }, [refetchContact]);

  // Get typing indicators from store - use selector with specific conversation ID
  // to avoid re-renders on typing changes in other conversations
  const jid = contactDetail?.jid;
  const typingIndicators = useChatStore(
    React.useCallback(
      (state) => (jid ? state.typingIndicators.get(jid) : undefined),
      [jid],
    ),
  );
  const isContactTyping = Boolean(
    typingIndicators && typingIndicators.length > 0,
  );

  // Message mutations
  const sendMessage = useSendMessage();
  const deleteMessage = useDeleteMessage();
  const starMessage = useStarMessage();
  const reactMessage = useReactMessage();
  const forwardMessage = useForwardMessage();

  // Sync URL with selected chat
  React.useEffect(() => {
    setSelectedChatId(contactId);
  }, [contactId]);

  // Sync selected chat ID with the global store
  // Access action via getState() to avoid unnecessary subscription
  React.useEffect(() => {
    useChatStore.getState().selectConversation(selectedChatId || null);
    return () => {
      useChatStore.getState().selectConversation(null);
    };
  }, [selectedChatId]);

  // Mark conversation as read when chat is selected
  const lastMarkedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (selectedChatId && lastMarkedRef.current !== selectedChatId) {
      lastMarkedRef.current = selectedChatId;

      const timeoutId = setTimeout(() => {
        if (lastMarkedRef.current === selectedChatId) {
          markConversationAsRead(selectedChatId)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: chatKeys.lists() });
            })
            .catch((error) => {
              console.error("Failed to mark conversation as read:", error);
            });
        }
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [selectedChatId, queryClient]);

  // Chat selection handlers
  const handleChatSelect = React.useCallback(
    (chatId: string | null) => {
      setSelectedChatId(chatId || undefined);
      setIsProfileOpen(false);
      setIsSearchOpen(false);
      setHighlightedMessageId(null);
      if (!activeWorkspaceId) return;
      navigate(workspacePath(activeWorkspaceId, "chat", chatId || undefined));
    },
    [activeWorkspaceId, navigate],
  );

  // Profile panel handlers
  const handleOpenProfile = React.useCallback(() => {
    setIsProfileOpen(true);
  }, []);

  const handleCloseProfile = React.useCallback(() => {
    setIsProfileOpen(false);
  }, []);

  // Search panel handlers
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

  // Reply handlers
  const handleReplyToMessage = React.useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);

  const handleClearReply = React.useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // Send message handler
  const handleSendMessage = React.useCallback(
    (content: string, replyToMessageId?: string) => {
      if (!selectedChatId) return;

      sendMessage.mutate({
        contactId: selectedChatId,
        content,
        messageType: "text",
        replyToMessageId,
      });
      setReplyToMessage(null);
    },
    [selectedChatId, sendMessage],
  );

  // File attachment handler
  const handleAttachFile = React.useCallback(
    async (
      file: File,
      type: "image" | "document",
      caption: string,
    ): Promise<boolean> => {
      if (!selectedChatId) return false;

      const sendingToastId = toast.loading(`Sending ${file.name}...`);

      try {
        console.log("Uploading file:", file.name, type);

        const uploadResponse = await uploadMedia(file);

        console.log("File uploaded successfully:", uploadResponse.mediaUrl);

        let messageType: "image" | "video" | "audio" | "document" = "document";
        if (uploadResponse.mimeType.startsWith("image/")) {
          messageType = "image";
        } else if (uploadResponse.mimeType.startsWith("video/")) {
          messageType = "video";
        } else if (uploadResponse.mimeType.startsWith("audio/")) {
          messageType = "audio";
        }

        await sendMessage.mutateAsync({
          contactId: selectedChatId,
          content: caption,
          messageType,
          mediaUrl: uploadResponse.mediaUrl,
        });
        toast.dismiss(sendingToastId);
        toast.success("Attachment sent");
        return true;
      } catch (error) {
        toast.dismiss(sendingToastId);
        console.error("Failed to send attachment:", error);

        if (error instanceof Error) {
          toast.error(`Failed to send attachment: ${error.message}`);
        } else {
          toast.error("Failed to send attachment. Please try again.");
        }
        return false;
      }
    },
    [selectedChatId, sendMessage],
  );

  // Delete message handlers
  const handleDeleteMessage = React.useCallback(
    (message: Message) => {
      if (!selectedChatId) return;
      setMessageToDelete(message);
      setDeleteDialogOpen(true);
    },
    [selectedChatId],
  );

  const handleConfirmDelete = React.useCallback(() => {
    if (!selectedChatId || !messageToDelete) return;

    deleteMessage.mutate(
      {
        messageId: messageToDelete.id,
        conversationId: selectedChatId,
      },
      {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setMessageToDelete(null);
        },
        onError: (error) => {
          toast.error(`Failed to delete message: ${error.message}`);
        },
      },
    );
  }, [selectedChatId, messageToDelete, deleteMessage]);

  const handleCloseDeleteDialog = React.useCallback(() => {
    setDeleteDialogOpen(false);
    setMessageToDelete(null);
  }, []);

  // Star message handler
  const handleStarMessage = React.useCallback(
    (message: Message) => {
      if (!selectedChatId) return;

      starMessage.mutate({
        messageId: message.id,
        conversationId: selectedChatId,
        isStarred: !message.isStarred,
      });
    },
    [selectedChatId, starMessage],
  );

  // React to message handler
  const handleReactMessage = React.useCallback(
    (message: Message, emoji: string) => {
      if (!selectedChatId) return;

      reactMessage.mutate({
        messageId: message.id,
        conversationId: selectedChatId,
        emoji: getReactionMutationEmoji(message.reactions, emoji),
      });
    },
    [selectedChatId, reactMessage],
  );

  // Forward message handlers
  const handleForwardMessage = React.useCallback(
    (message: Message) => {
      if (!selectedChatId) return;
      setMessageToForward(message);
      setForwardDialogOpen(true);
    },
    [selectedChatId],
  );

  const handleForwardToContact = React.useCallback(
    (targetContactId: string) => {
      if (!selectedChatId || !messageToForward) return;

      forwardMessage.mutate(
        {
          messageId: messageToForward.id,
          sourceConversationId: selectedChatId,
          targetContactId,
        },
        {
          onSuccess: (data) => {
            toast.success("Message forwarded successfully");
            if (data.autoAssigned) {
              toast.info("Contact was automatically assigned to you");
            }
            setForwardDialogOpen(false);
            setMessageToForward(null);
          },
          onError: (error) => {
            toast.error(`Failed to forward message: ${error.message}`);
          },
        },
      );
    },
    [selectedChatId, messageToForward, forwardMessage],
  );

  const handleCloseForwardDialog = React.useCallback(() => {
    setForwardDialogOpen(false);
    setMessageToForward(null);
  }, []);

  return {
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
    messageToForward,
    isForwarding: forwardMessage.isPending,
    deleteDialogOpen,
    messageToDelete,
    isDeleting: deleteMessage.isPending,
    isSending: sendMessage.isPending,

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
  };
}
