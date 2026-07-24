import type { Message } from "@wateaminbox/shared";
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePusherContext } from "../../contexts/PusherProvider";
import { useClickOutside, useTextareaAutoResize } from "../../hooks/ui";

// Lazy load emoji picker - only loaded when user opens it
// This keeps the emoji data (~1200 lines) out of the initial bundle
const EmojiInputPicker = lazy(() => import("./EmojiInputPicker"));

// JID suffix for WhatsApp individual chats
const WHATSAPP_JID_SUFFIX = "@s.whatsapp.net";

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
  replyToMessage: Message | null;
  onClearReply: () => void;
  onSendMessage: (content: string, replyToMessageId?: string) => void;
  onAttachFile: (file: File, type: "image" | "document") => void;
  disabled?: boolean;
  connectionStatus?: string;
}

export function MessageComposer({
  conversationId,
  replyToMessage,
  onClearReply,
  onSendMessage,
  onAttachFile,
  disabled = false,
  connectionStatus,
}: MessageComposerProps) {
  // Disable input when connection is not "connected"
  const isDisconnected = Boolean(
    connectionStatus && connectionStatus !== "connected",
  );
  const isInputDisabled = disabled || isDisconnected;
  const [message, setMessage] = useState("");
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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

  // Typing actions use REST and are broadcast to teammates through Pusher.
  const { sendTypingStart } = usePusherContext();

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

    // Only emit typing if we have a conversationId and content
    if (!conversationId || !newValue.trim()) {
      // User cleared input - just clear state (don't send typing:stop to avoid cooldown)
      if (currentTypingJidRef.current) {
        clearTypingState();
      }
      return;
    }

    // Build the JID for typing indicator
    const jid = conversationId.includes("@")
      ? conversationId
      : `${conversationId}${WHATSAPP_JID_SUFFIX}`;

    const now = Date.now();
    const timeSinceLastSent = now - lastTypingSentTimeRef.current;
    const isNewJid = currentTypingJidRef.current !== jid;

    // Send typing:start if: new JID, or 2+ seconds since last send
    if (isNewJid || timeSinceLastSent >= TYPING_REFRESH_MS) {
      sendTypingStart(jid);
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
    // Send on Enter, new line on Shift+Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isInputDisabled || !conversationId) return;

    // Just clear typing state - don't send typing:stop to avoid WhatsApp cooldown
    // WhatsApp will auto-dismiss the indicator
    clearTypingState();

    onSendMessage(trimmedMessage, replyToMessage?.id);
    setMessage("");
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
      onAttachFile(file, type);
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
    <div className="bg-gray-100 dark:bg-dark-secondary border-t border-gray-200 dark:border-dark-border safe-area-bottom">
      {/* Disconnected banner */}
      {isDisconnected && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-sm px-4 py-2 text-center border-b border-yellow-200 dark:border-yellow-800/30">
          WhatsApp is disconnected. Messages cannot be sent.
        </div>
      )}

      {/* Reply preview */}
      {replyToMessage && (
        <div className="px-4 pt-2">
          <div className="flex items-center bg-white dark:bg-dark-elevated rounded-lg border-l-4 border-whatsapp-green p-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-whatsapp-green truncate">
                {replyToMessage.senderType === "user" ? "You" : "Contact"}
              </p>
              <p className="text-sm text-gray-600 dark:text-dark-text-secondary truncate">
                {replyToMessage.isDeleted
                  ? "This message was deleted"
                  : replyToMessage.content}
              </p>
            </div>
            <button
              onClick={onClearReply}
              className="ml-2 p-1 text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary rounded-full hover:bg-gray-100 dark:hover:bg-dark-tertiary"
              aria-label="Cancel reply"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-1 md:gap-2 p-2 md:p-3">
        {/* Emoji button - hidden on small mobile */}
        <div className="relative hidden sm:block" ref={emojiPickerRef}>
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="flex-shrink-0 flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary rounded-full hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation"
            aria-label="Insert emoji"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
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
            className="flex-shrink-0 flex h-11 w-11 md:h-10 md:w-10 items-center justify-center text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary rounded-full hover:bg-gray-200 dark:hover:bg-dark-tertiary active:bg-gray-300 dark:active:bg-dark-border transition-colors touch-manipulation"
            onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
            aria-label="Attach file"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>

          {/* Attachment menu */}
          {showAttachmentMenu && (
            <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-dark-elevated rounded-lg shadow-lg py-2 min-w-[160px] z-10">
              <button
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                onClick={() => triggerFileInput("image")}
              >
                <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                  <svg
                    className="h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <span>Photos & Videos</span>
              </button>
              <button
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                onClick={() => triggerFileInput("document")}
              >
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <svg
                    className="h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <span>Document</span>
              </button>
            </div>
          )}

          {/* Hidden file inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => handleFileSelect(e, "image")}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
            className="hidden"
            onChange={(e) => handleFileSelect(e, "document")}
          />
        </div>

        {/* Text input */}
        <div
          className={`flex-1 rounded-xl border transition-colors ${
            isInputDisabled
              ? "bg-gray-100 dark:bg-dark-tertiary border-gray-200 dark:border-dark-border opacity-60"
              : "bg-white dark:bg-dark-tertiary border-gray-200 dark:border-dark-border focus-within:border-whatsapp-green"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isDisconnected ? "Disconnected…" : "Type a message"}
            disabled={isInputDisabled}
            rows={1}
            aria-label="Message input"
            className={`w-full px-4 py-2 bg-transparent resize-none focus:outline-none text-gray-900 dark:text-dark-text-primary placeholder-gray-500 dark:placeholder-dark-text-tertiary max-h-[150px] ${
              isInputDisabled ? "cursor-not-allowed" : ""
            }`}
            style={{ minHeight: "40px" }}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!message.trim() || isInputDisabled}
          className={`flex-shrink-0 flex h-11 w-11 md:h-10 md:w-10 items-center justify-center rounded-full transition-colors touch-manipulation ${
            message.trim() && !isInputDisabled
              ? "bg-whatsapp-green text-white hover:bg-whatsapp-dark-green active:bg-whatsapp-dark-green"
              : "bg-gray-200 dark:bg-dark-tertiary text-gray-400 dark:text-dark-text-tertiary cursor-not-allowed"
          }`}
          aria-label="Send message"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default MessageComposer;
