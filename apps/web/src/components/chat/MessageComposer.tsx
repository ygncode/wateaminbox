import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import type { Message } from "@whatsapp-web/shared";
import { EmojiInputPicker } from "./EmojiInputPicker";

interface MessageComposerProps {
  conversationId: string | undefined;
  replyToMessage: Message | null;
  onClearReply: () => void;
  onSendMessage: (content: string, replyToMessageId?: string) => void;
  onAttachFile: (file: File, type: "image" | "document") => void;
  disabled?: boolean;
}

export function MessageComposer({
  conversationId,
  replyToMessage,
  onClearReply,
  onSendMessage,
  onAttachFile,
  disabled = false,
}: MessageComposerProps) {
  const [message, setMessage] = useState("");
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 150);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  // Close attachment menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        attachmentMenuRef.current &&
        !attachmentMenuRef.current.contains(event.target as Node)
      ) {
        setShowAttachmentMenu(false);
      }
    }

    if (showAttachmentMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showAttachmentMenu]);

  // Focus textarea when reply is set
  useEffect(() => {
    if (replyToMessage) {
      textareaRef.current?.focus();
    }
  }, [replyToMessage]);

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
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
    if (!trimmedMessage || disabled || !conversationId) return;

    onSendMessage(trimmedMessage, replyToMessage?.id);
    setMessage("");
    onClearReply();

    // Reset textarea height and maintain focus for continued typing
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
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
  const insertEmoji = useCallback((emoji: string) => {
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
  }, [message]);

  if (!conversationId) {
    return null;
  }

  return (
    <div className="bg-gray-100 dark:bg-dark-secondary border-t border-gray-200 dark:border-dark-border safe-area-bottom">
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

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <EmojiInputPicker
              onSelectEmoji={insertEmoji}
              onClose={() => setShowEmojiPicker(false)}
            />
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
        <div className="flex-1 bg-white dark:bg-dark-tertiary rounded-xl border border-gray-200 dark:border-dark-border focus-within:border-whatsapp-green transition-colors">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message"
            disabled={disabled}
            rows={1}
            className="w-full px-4 py-2 bg-transparent resize-none focus:outline-none text-gray-900 dark:text-dark-text-primary placeholder-gray-500 dark:placeholder-dark-text-tertiary max-h-[150px]"
            style={{ minHeight: "40px" }}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className={`flex-shrink-0 flex h-11 w-11 md:h-10 md:w-10 items-center justify-center rounded-full transition-colors touch-manipulation ${
            message.trim() && !disabled
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
