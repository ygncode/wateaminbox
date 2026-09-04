import { useQueryClient } from "@tanstack/react-query";
import type { Contact, Message } from "@wateaminbox/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { createWhatsAppAlbumId } from "../../components/chat/media-gallery";
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
import { resolveActiveReplyDraft } from "./reply-draft";
import { isSendPendingForContact } from "./send-scope";

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
  /**
   * Contact the profile panel is describing. Usually the open conversation,
   * but a group member opened from the thread or the participant list points
   * it at that member instead, the way tapping a sender does on WhatsApp.
   */
  profileContactId: string | undefined;
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
  /** Opens the profile panel on a group member rather than the conversation. */
  handleOpenParticipantProfile: (participantContactId: string) => void;
  handleCloseProfile: () => void;

  // Search panel
  handleOpenSearch: () => void;
  handleCloseSearch: () => void;
  handleNavigateToMessage: (messageId: string) => void;

  // Reply
  handleReplyToMessage: (message: Message) => void;
  handleClearReply: () => void;

  // Send message
  handleSendMessage: (
    content: string,
    replyToMessageId?: string,
    mentionedJids?: string[],
  ) => void;
  handleAttachFile: (
    files: File[],
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
  const { t } = useTranslation();
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const { search } = useLocation();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  // The URL is the source of truth for chat selection. In particular, system
  // back/forward gestures update `contactId` immediately; mirroring it in
  // component state via an effect leaves the mobile shell and its panels on
  // different routes for an extra render and can strand both panels offscreen.
  const selectedChatId = contactId;

  // Panel visibility state
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);
  // Null means "the open conversation". Held separately from `selectedChatId`
  // so that opening a member's profile does not move the thread underneath it.
  const [participantProfileId, setParticipantProfileId] = React.useState<
    string | null
  >(null);
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<
    string | null
  >(null);

  // Reply state. Read through `replyToMessage` below, never directly - a
  // block invalidates the draft (see reply-draft.ts).
  const [replyDraft, setReplyDraft] = React.useState<Message | null>(null);

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

  // Defense in depth for the two outbound handlers this hook owns. The
  // composer is never MOUNTED while the contact is blocked (see
  // ComposerLifecycleArea's "blocked" state) and reply/react/retry are
  // withheld by ChatPage's `canSend`, but these handlers are exported and
  // the block can also flip mid-session from another surface (contact
  // profile, or a realtime block event from another agent). The API is
  // authoritative either way - `requireSendAccess` throws
  // ContactBlockedError - this just avoids firing a request that can only
  // be rejected, and avoids uploading media for it first.
  const isContactBlocked = contactDetail?.isBlocked ?? false;

  // One source for the copy both blocked-defense toasts show, matching the
  // wording of the composer's own blocked notice.
  const blockedSendMessage = t(
    "chat.blockedSendAttempt",
    "This contact is blocked - unblock them to send messages",
  );

  // A block invalidates any reply the agent had already picked: the
  // composer unmounts, which would otherwise just HIDE the draft until an
  // unblock silently restored it (see reply-draft.ts). The derived value
  // covers the render that first observes the block; the effect discards
  // the underlying state so it can't come back.
  const replyToMessage = resolveActiveReplyDraft({
    replyToMessage: replyDraft,
    isContactBlocked,
  });

  React.useEffect(() => {
    if (isContactBlocked) {
      setReplyDraft(null);
    }
  }, [isContactBlocked]);

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

  // See send-scope.ts: `sendMessage` is a single mutation instance shared
  // across every chat this page ever selects, so `sendMessage.isPending`
  // alone isn't scoped to the contact currently on screen.
  const isSendingToSelectedChat = isSendPendingForContact({
    isPending: sendMessage.isPending,
    pendingContactId: sendMessage.variables?.contactId,
    selectedChatId,
  });

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
      setIsProfileOpen(false);
      setIsSearchOpen(false);
      setHighlightedMessageId(null);
      if (!activeWorkspaceId) return;
      // Carry the query string across: it holds the Chats/Groups filter, so
      // dropping it would silently send the user back to the Chats list when
      // they close a group they opened from Groups.
      navigate({
        pathname: workspacePath(activeWorkspaceId, "chat", chatId || undefined),
        search,
      });
    },
    [activeWorkspaceId, navigate, search],
  );

  // Profile panel handlers
  const handleOpenProfile = React.useCallback(() => {
    // Re-opening from the header always means the conversation itself, even if
    // the panel last showed a member.
    setParticipantProfileId(null);
    setIsProfileOpen(true);
  }, []);

  const handleOpenParticipantProfile = React.useCallback(
    (participantContactId: string) => {
      setParticipantProfileId(participantContactId);
      setIsProfileOpen(true);
    },
    [],
  );

  const handleCloseProfile = React.useCallback(() => {
    setIsProfileOpen(false);
    // Retain the member while the bottom sheet slides out. Clearing it here
    // switches the closing surface back to the group's fullscreen side panel
    // for one frame. `handleOpenProfile` still resets it before the conversation
    // profile is opened again.
  }, []);

  // Switching conversations must not leave the panel pointed at a member of
  // the group that was just closed - the member is unrelated to the thread now
  // on screen, and the panel is shared between them.
  React.useEffect(() => {
    setParticipantProfileId(null);
  }, [selectedChatId]);

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
    setReplyDraft(message);
  }, []);

  const handleClearReply = React.useCallback(() => {
    setReplyDraft(null);
  }, []);

  // Send message handler
  const handleSendMessage = React.useCallback(
    (content: string, replyToMessageId?: string, mentionedJids?: string[]) => {
      if (!selectedChatId) return;
      if (isContactBlocked) {
        toast.error(blockedSendMessage);
        return;
      }

      sendMessage.mutate({
        contactId: selectedChatId,
        content,
        messageType: "text",
        replyToMessageId,
        mentionedJids,
      });
      setReplyDraft(null);
    },
    [selectedChatId, isContactBlocked, blockedSendMessage, sendMessage],
  );

  // File attachment handler
  const handleAttachFile = React.useCallback(
    async (
      files: File[],
      type: "image" | "document",
      caption: string,
    ): Promise<boolean> => {
      if (!selectedChatId || files.length === 0) return false;
      if (isContactBlocked) {
        toast.error(blockedSendMessage);
        return false;
      }

      const isAlbum = type === "image" && files.length > 1;
      const sendingToastId = toast.loading(
        isAlbum
          ? `Sending ${files.length} photos and videos...`
          : `Sending ${files[0].name}...`,
      );

      try {
        const uploads = await Promise.all(
          files.map((file) => uploadMedia(file)),
        );
        const prepared = uploads.map((uploadResponse) => {
          let messageType: "image" | "video" | "audio" | "document" =
            "document";
          if (uploadResponse.mimeType.startsWith("image/")) {
            messageType = "image";
          } else if (uploadResponse.mimeType.startsWith("video/")) {
            messageType = "video";
          } else if (uploadResponse.mimeType.startsWith("audio/")) {
            messageType = "audio";
          }
          return { uploadResponse, messageType };
        });

        if (
          isAlbum &&
          prepared.some(
            ({ messageType }) =>
              messageType !== "image" && messageType !== "video",
          )
        ) {
          throw new Error("A gallery can contain only photos and videos");
        }

        const albumId = isAlbum ? createWhatsAppAlbumId() : undefined;
        const imageCount = prepared.filter(
          ({ messageType }) => messageType === "image",
        ).length;
        const videoCount = prepared.filter(
          ({ messageType }) => messageType === "video",
        ).length;

        // Keep these sends ordered: item zero creates the WhatsApp album
        // manifest that every following image/video references.
        for (const [index, item] of prepared.entries()) {
          await sendMessage.mutateAsync({
            contactId: selectedChatId,
            content: index === 0 ? caption : "",
            messageType: item.messageType,
            mediaUrl: item.uploadResponse.mediaUrl,
            mediaAlbum: albumId
              ? {
                  id: albumId,
                  index,
                  count: prepared.length,
                  imageCount,
                  videoCount,
                }
              : undefined,
          });
        }
        toast.dismiss(sendingToastId);
        toast.success(isAlbum ? "Gallery sent" : "Attachment sent");
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
    [selectedChatId, isContactBlocked, blockedSendMessage, sendMessage],
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
    profileContactId: participantProfileId ?? selectedChatId,
    isSearchOpen,
    highlightedMessageId,
    replyToMessage,
    forwardDialogOpen,
    messageToForward,
    isForwarding: forwardMessage.isPending,
    deleteDialogOpen,
    messageToDelete,
    isDeleting: deleteMessage.isPending,
    isSending: isSendingToSelectedChat,

    // Actions
    handleChatSelect,
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
  };
}
