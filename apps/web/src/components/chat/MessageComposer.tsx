import type { Message, WhatsAppConnectionIdentity } from "@wateaminbox/shared";
import {
  FileText,
  Image as ImageIcon,
  Paperclip,
  Send,
  Smile,
  UserRound,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRealtimeContext } from "../../contexts/RealtimeProvider";
import { useClickOutside, useTextareaAutoResize } from "../../hooks/ui";
import { useQuickReplySuggestions } from "../../hooks/useQuickReplies";
import { AttachmentPreviewDialog } from "./AttachmentPreviewDialog";
import { ConnectionRoute } from "./ConnectionIdentity";
import { QuickReplyPicker } from "./QuickReplyPicker";
import {
  filterQuickReplies,
  getActiveQuickReplyToken,
  insertQuickReply,
} from "./quick-reply-matching";

// Lazy load emoji picker - only loaded when user opens it
// This keeps the emoji data (~1200 lines) out of the initial bundle
const EmojiInputPicker = lazy(() => import("./EmojiInputPicker"));

/**
 * Skeleton loading state for the emoji picker
 * Shows a placeholder while the emoji picker chunk loads
 */
function EmojiPickerSkeleton() {
  return (
    <div className="absolute bottom-full mb-2 left-0 w-80 bg-white dark:bg-dark-elevated rounded-xl shadow-lg border border-gray-200 dark:border-dark-border overflow-hidden z-20">
      {/* Search placeholder */}
      <div className="p-2 border-b border-gray-200 dark:border-dark-border">
        <div className="h-8 bg-gray-100 dark:bg-dark-tertiary rounded-lg animate-pulse" />
      </div>
      {/* Category tabs placeholder */}
      <div className="flex gap-1 p-2 border-b border-gray-200 dark:border-dark-border">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-8 bg-gray-100 dark:bg-dark-tertiary rounded animate-pulse"
          />
        ))}
      </div>
      {/* Emoji grid placeholder */}
      <div className="h-64 p-2 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <svg
            className="animate-spin h-6 w-6 text-whatsapp-green"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm text-gray-500 dark:text-dark-text-secondary">
            Loading emojis...
          </span>
        </div>
      </div>
    </div>
  );
}

// Typing indicator timing constants
// Based on research: WhatsApp auto-dismisses on receiver side when it stops receiving composing states
// We refresh every 2 seconds to keep indicator alive, and clear state after 3 seconds of no typing
const TYPING_REFRESH_MS = 2000; // Send typing:start every 2 seconds while typing
const TYPING_IDLE_MS = 3000; // Clear state after 3 seconds of no typing (no typing:stop sent)

interface MessageComposerProps {
  conversationId: string | undefined;
  contactId: string | undefined;
  replyToMessage: Message | null;
  onClearReply: () => void;
  onSendMessage: (content: string, replyToMessageId?: string) => void;
  onAttachFile: (
    file: File,
    type: "image" | "document",
    caption: string,
  ) => Promise<boolean>;
  disabled?: boolean;
  connection?: WhatsAppConnectionIdentity | null;
  currentUserName?: string;
}

export function MessageComposer({
  conversationId,
  contactId,
  replyToMessage,
  onClearReply,
  onSendMessage,
  onAttachFile,
  disabled = false,
  connection,
  currentUserName,
}: MessageComposerProps) {
  // A conversation is permanently routed through the account that owns it.
  const isDisconnected = !connection || connection.status !== "connected";
  const isInputDisabled = disabled || isDisconnected;
  const [message, setMessage] = useState("");
  const [caretPosition, setCaretPosition] = useState(0);
  const [selectedQuickReplyIndex, setSelectedQuickReplyIndex] = useState(0);
  const [isQuickReplyPickerDismissed, setIsQuickReplyPickerDismissed] =
    useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File;
    type: "image" | "document";
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Track when we need to restore focus after sending a message
  // (flushSync from TanStack Virtual can steal focus during re-renders)
  const shouldRestoreFocusRef = useRef(false);

  // Typing indicator refs
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const currentTypingJidRef = useRef<string | null>(null);
  const lastTypingSentTimeRef = useRef<number>(0);

  // Typing actions use REST and are broadcast to teammates through Centrifugo.
  const { sendTypingStart } = useRealtimeContext();
  const activeQuickReplyToken = useMemo(
    () => getActiveQuickReplyToken(message, caretPosition),
    [caretPosition, message],
  );
  const shouldShowQuickReplyPicker =
    activeQuickReplyToken !== null &&
    !isQuickReplyPickerDismissed &&
    !isInputDisabled;
  const {
    quickReplies: quickReplyLibrary,
    isLoading: isLoadingQuickReplies,
    error: quickReplyError,
  } = useQuickReplySuggestions(shouldShowQuickReplyPicker);
  const quickReplySuggestions = useMemo(
    () =>
      filterQuickReplies(quickReplyLibrary, activeQuickReplyToken?.query ?? ""),
    [activeQuickReplyToken?.query, quickReplyLibrary],
  );

  // Auto-resize textarea using the hook
  const { reset: resetTextareaHeight } = useTextareaAutoResize(textareaRef, {
    maxHeight: 150,
    deps: [message],
  });

  // Close attachment menu when clicking outside
  useClickOutside(attachmentMenuRef, () => setShowAttachmentMenu(false), {
    enabled: showAttachmentMenu,
  });

  // Focus textarea when reply is set
  useEffect(() => {
    if (replyToMessage) {
      textareaRef.current?.focus();
    }
  }, [replyToMessage]);

  useEffect(() => {
    setPendingAttachment(null);
  }, [conversationId]);

  useEffect(() => {
    setSelectedQuickReplyIndex(0);
  }, [activeQuickReplyToken?.query]);

  useEffect(() => {
    if (selectedQuickReplyIndex >= quickReplySuggestions.length) {
      setSelectedQuickReplyIndex(Math.max(0, quickReplySuggestions.length - 1));
    }
  }, [quickReplySuggestions.length, selectedQuickReplyIndex]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingIdleTimeoutRef.current) {
        clearTimeout(typingIdleTimeoutRef.current);
      }
    };
  }, []);

  // Restore focus after renders if we just sent a message
  // This runs after every render to catch focus loss from flushSync
  useLayoutEffect(() => {
    if (
      shouldRestoreFocusRef.current &&
      textareaRef.current &&
      !isInputDisabled
    ) {
      textareaRef.current.focus();
      shouldRestoreFocusRef.current = false;
    }
  });

  // Clear typing state - does NOT send typing:stop (let WhatsApp auto-dismiss)
  // Only clears internal state so next keystroke triggers fresh typing:start
  const clearTypingState = useCallback(() => {
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }
    currentTypingJidRef.current = null;
    lastTypingSentTimeRef.current = 0;
  }, []);

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setMessage(newValue);
    setCaretPosition(e.target.selectionStart);
    setIsQuickReplyPickerDismissed(false);

    // Only emit typing if we have a conversationId and content
    if (!conversationId || !contactId || !newValue.trim()) {
      // User cleared input - just clear state (don't send typing:stop to avoid cooldown)
      if (currentTypingJidRef.current) {
        clearTypingState();
      }
      return;
    }

    const jid = conversationId;

    const now = Date.now();
    const timeSinceLastSent = now - lastTypingSentTimeRef.current;
    const isNewJid = currentTypingJidRef.current !== jid;

    // Send typing:start if: new JID, or 2+ seconds since last send
    if (isNewJid || timeSinceLastSent >= TYPING_REFRESH_MS) {
      sendTypingStart(jid, contactId);
      currentTypingJidRef.current = jid;
      lastTypingSentTimeRef.current = now;
    }

    // Reset idle timeout on every keystroke
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
    }
    typingIdleTimeoutRef.current = setTimeout(() => {
      clearTypingState(); // Just clear state, no typing:stop sent
    }, TYPING_IDLE_MS);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldShowQuickReplyPicker) {
      if (e.key === "ArrowDown" && quickReplySuggestions.length > 0) {
        e.preventDefault();
        setSelectedQuickReplyIndex(
          (current) => (current + 1) % quickReplySuggestions.length,
        );
        return;
      }

      if (e.key === "ArrowUp" && quickReplySuggestions.length > 0) {
        e.preventDefault();
        setSelectedQuickReplyIndex(
          (current) =>
            (current - 1 + quickReplySuggestions.length) %
            quickReplySuggestions.length,
        );
        return;
      }

      if (
        ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") &&
        quickReplySuggestions[selectedQuickReplyIndex]
      ) {
        e.preventDefault();
        handleQuickReplySelect(quickReplySuggestions[selectedQuickReplyIndex]);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setIsQuickReplyPickerDismissed(true);
        return;
      }
    }

    // Send on Enter, new line on Shift+Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickReplySelect = (
    quickReply: (typeof quickReplySuggestions)[number],
  ) => {
    if (!activeQuickReplyToken) return;

    const insertion = insertQuickReply(
      message,
      activeQuickReplyToken,
      quickReply,
    );
    setMessage(insertion.message);
    setCaretPosition(insertion.cursor);
    setIsQuickReplyPickerDismissed(true);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        insertion.cursor,
        insertion.cursor,
      );
    });
  };

  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isInputDisabled || !conversationId) return;

    // Just clear typing state - don't send typing:stop to avoid WhatsApp cooldown
    // WhatsApp will auto-dismiss the indicator
    clearTypingState();

    onSendMessage(trimmedMessage, replyToMessage?.id);
    setMessage("");
    setCaretPosition(0);
    setIsQuickReplyPickerDismissed(false);
    onClearReply();

    // Mark that we need to restore focus after re-renders
    // (flushSync from TanStack Virtual steals focus during message list updates)
    shouldRestoreFocusRef.current = true;

    // Reset textarea height
    resetTextareaHeight();

    // Fallback: restore focus after a delay to catch focus loss from sibling re-renders
    // The flushSync from MessageThread can steal focus after MessageComposer has rendered
    setTimeout(() => {
      if (textareaRef.current && !isInputDisabled) {
        textareaRef.current.focus();
        shouldRestoreFocusRef.current = false;
      }
    }, 100);
  };

  const handleFileSelect = (
    e: ChangeEvent<HTMLInputElement>,
    type: "image" | "document",
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingAttachment({ file, type });
    }
    // Reset input
    e.target.value = "";
    setShowAttachmentMenu(false);
  };

  const triggerFileInput = (type: "image" | "document") => {
    if (type === "image") {
      imageInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  // Insert emoji at cursor position
  const insertEmoji = useCallback(
    (emoji: string) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        setMessage((prev) => prev + emoji);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newMessage =
        message.substring(0, start) + emoji + message.substring(end);
      setMessage(newMessage);

      // Restore focus and cursor position after emoji insertion
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursorPos = start + emoji.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      });
    },
    [message],
  );

  if (!conversationId) {
    return null;
  }

  return (
    <>
      <footer className="safe-area-bottom border-t border-[#d7dfe2] bg-[#f0f2f5] dark:border-dark-border dark:bg-dark-secondary">
        {/* Disconnected banner */}
        {isDisconnected && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-800/30 dark:bg-amber-900/20 dark:text-amber-200">
            {connection?.name ||
              connection?.phoneNumber ||
              "This WhatsApp account"}{" "}
            is disconnected. This conversation cannot be rerouted to another
            number.
          </div>
        )}

        {/* Persistent sender and account context prevents wrong-identity replies. */}
        <div className="flex min-h-8 min-w-0 items-center gap-1.5 border-b border-black/[0.055] bg-white/55 px-4 py-1 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <UserRound
            className="size-3.5 shrink-0 text-[#667781] dark:text-dark-text-tertiary"
            aria-hidden="true"
          />
          <span className="truncate text-[11px] text-[#667781] dark:text-dark-text-secondary">
            Sending as{" "}
            <strong className="font-semibold text-[#3b4a54] dark:text-dark-text-primary">
              {currentUserName || "You"}
            </strong>
          </span>
          {connection && (
            <>
              <span
                className="size-0.5 shrink-0 rounded-full bg-[#aebac1] dark:bg-dark-border"
                aria-hidden="true"
              />
              <ConnectionRoute
                connection={connection}
                mode="sending"
                className="min-w-0 text-[11px]"
              />
            </>
          )}
        </div>

        {/* Reply preview */}
        {replyToMessage && (
          <div className="px-3 pt-2">
            <div className="flex items-center overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-sm dark:border-white/[0.07] dark:bg-dark-elevated">
              <span
                className="w-1 self-stretch bg-[#00a884]"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="truncate px-3 pt-2 text-xs font-semibold text-[#008069] dark:text-emerald-300">
                  {replyToMessage.senderType === "user" ? "You" : "Contact"}
                </p>
                <p className="truncate px-3 pb-2 text-sm text-[#667781] dark:text-dark-text-secondary">
                  {replyToMessage.isDeleted
                    ? "This message was deleted"
                    : replyToMessage.content}
                </p>
              </div>
              <button
                type="button"
                onClick={onClearReply}
                className="mr-2 grid size-8 shrink-0 place-items-center rounded-full text-[#8696a0] transition-colors hover:bg-black/[0.055] hover:text-[#54656f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-dark-text-tertiary dark:hover:bg-white/[0.06] dark:hover:text-dark-text-secondary"
                aria-label="Cancel reply"
              >
                <X className="size-4.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-1 px-2 py-2 sm:gap-1.5 sm:px-3">
          {/* Emoji button - hidden on small mobile */}
          <div className="relative hidden sm:block" ref={emojiPickerRef}>
            <button
              type="button"
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowAttachmentMenu(false);
              }}
              className="grid size-10 shrink-0 touch-manipulation place-items-center rounded-full text-[#54656f] transition-colors hover:bg-black/[0.055] active:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 dark:text-dark-text-secondary dark:hover:bg-white/[0.06] dark:active:bg-white/10"
              aria-label="Insert emoji"
              aria-expanded={showEmojiPicker}
            >
              <Smile className="size-6" strokeWidth={1.8} aria-hidden="true" />
            </button>

            {/* Emoji Picker - lazy loaded */}
            {showEmojiPicker && (
              <Suspense fallback={<EmojiPickerSkeleton />}>
                <EmojiInputPicker
                  onSelectEmoji={insertEmoji}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </Suspense>
            )}
          </div>

          {/* Attachment button */}
          <div className="relative" ref={attachmentMenuRef}>
            <button
              type="button"
              disabled={isInputDisabled}
              className={`grid size-10 shrink-0 touch-manipulation place-items-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 ${
                isInputDisabled
                  ? "cursor-not-allowed text-[#aebac1] dark:text-dark-text-tertiary"
                  : showAttachmentMenu
                    ? "rotate-45 bg-black/[0.07] text-[#008069] dark:bg-white/[0.08] dark:text-emerald-300"
                    : "text-[#54656f] hover:bg-black/[0.055] active:bg-black/10 dark:text-dark-text-secondary dark:hover:bg-white/[0.06] dark:active:bg-white/10"
              }`}
              onClick={() => {
                setShowAttachmentMenu(!showAttachmentMenu);
                setShowEmojiPicker(false);
              }}
              aria-label="Attach file"
              aria-expanded={showAttachmentMenu}
              aria-controls="message-attachment-menu"
            >
              <Paperclip
                className="size-6"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>

            {/* Attachment menu */}
            {showAttachmentMenu && (
              <div
                id="message-attachment-menu"
                className="absolute bottom-full left-0 z-30 mb-3 w-52 origin-bottom-left animate-in rounded-2xl border border-black/[0.07] bg-white p-2 shadow-[0_12px_36px_rgba(11,20,26,0.18)] fade-in-0 zoom-in-95 duration-150 dark:border-white/[0.08] dark:bg-dark-elevated dark:shadow-black/40"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-[#3b4a54] transition-colors hover:bg-[#f0f2f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/35 dark:text-dark-text-primary dark:hover:bg-white/[0.06]"
                  onClick={() => triggerFileInput("image")}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#bf59cf] text-white">
                    <ImageIcon className="size-4.5" aria-hidden="true" />
                  </span>
                  <span>Photos & Videos</span>
                </button>
                <button
                  type="button"
                  className="mt-0.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-[#3b4a54] transition-colors hover:bg-[#f0f2f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/35 dark:text-dark-text-primary dark:hover:bg-white/[0.06]"
                  onClick={() => triggerFileInput("document")}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#5157ae] text-white">
                    <FileText className="size-4.5" aria-hidden="true" />
                  </span>
                  <span>Document</span>
                </button>
              </div>
            )}

            {/* Hidden file inputs */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*,video/*"
              disabled={isInputDisabled}
              className="hidden"
              onChange={(e) => handleFileSelect(e, "image")}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
              disabled={isInputDisabled}
              className="hidden"
              onChange={(e) => handleFileSelect(e, "document")}
            />
          </div>

          {/* Text input */}
          <div className="relative min-w-0 flex-1">
            {shouldShowQuickReplyPicker && activeQuickReplyToken && (
              <QuickReplyPicker
                quickReplies={quickReplySuggestions}
                query={activeQuickReplyToken.query}
                selectedIndex={selectedQuickReplyIndex}
                isLoading={isLoadingQuickReplies}
                hasError={quickReplyError !== null}
                onSelect={handleQuickReplySelect}
                onHighlight={setSelectedQuickReplyIndex}
              />
            )}
            <div
              className={`overflow-hidden rounded-[1.35rem] ring-1 transition-shadow ${
                isInputDisabled
                  ? "bg-black/[0.035] opacity-60 ring-black/[0.05] dark:bg-white/[0.045] dark:ring-white/[0.05]"
                  : shouldShowQuickReplyPicker
                    ? "bg-white shadow-[0_1px_1px_rgba(11,20,26,0.08)] ring-[#00a884]/50 dark:bg-dark-tertiary dark:ring-emerald-400/40"
                    : "bg-white shadow-[0_1px_1px_rgba(11,20,26,0.08)] ring-black/[0.055] focus-within:ring-[#00a884]/35 dark:bg-dark-tertiary dark:ring-white/[0.06]"
              }`}
            >
              <textarea
                ref={textareaRef}
                value={message}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onClick={(event) => {
                  setCaretPosition(event.currentTarget.selectionStart);
                  setIsQuickReplyPickerDismissed(false);
                }}
                onSelect={(event) =>
                  setCaretPosition(event.currentTarget.selectionStart)
                }
                placeholder={
                  isDisconnected ? "Disconnected…" : "Type a message"
                }
                disabled={isInputDisabled}
                rows={1}
                aria-label="Message input"
                aria-autocomplete="list"
                aria-controls={
                  shouldShowQuickReplyPicker ? "quick-reply-picker" : undefined
                }
                aria-expanded={shouldShowQuickReplyPicker}
                aria-activedescendant={
                  shouldShowQuickReplyPicker &&
                  quickReplySuggestions[selectedQuickReplyIndex]
                    ? `quick-reply-option-${quickReplySuggestions[selectedQuickReplyIndex].id}`
                    : undefined
                }
                className={`block max-h-[150px] w-full resize-none bg-transparent px-4 py-2.5 text-[15px] leading-5 text-[#111b21] outline-none placeholder:text-[#667781] dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary ${
                  isInputDisabled ? "cursor-not-allowed" : ""
                }`}
                style={{ minHeight: "40px" }}
              />
            </div>
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!message.trim() || isInputDisabled}
            className={`grid size-10 shrink-0 touch-manipulation place-items-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f5] dark:focus-visible:ring-offset-dark-secondary ${
              message.trim() && !isInputDisabled
                ? "bg-[#00a884] text-white shadow-sm shadow-[#00a884]/25 hover:bg-[#008f72] active:scale-95"
                : "cursor-not-allowed bg-transparent text-[#aebac1] dark:text-dark-text-tertiary"
            }`}
            aria-label="Send message"
          >
            <Send className="size-5.5" strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </footer>

      {pendingAttachment && (
        <AttachmentPreviewDialog
          file={pendingAttachment.file}
          attachmentType={pendingAttachment.type}
          onCancel={() => setPendingAttachment(null)}
          onSend={onAttachFile}
        />
      )}
    </>
  );
}

export default MessageComposer;
