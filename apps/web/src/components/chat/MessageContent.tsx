import type { Message, MessageType } from "@whatsapp-web/shared";
import { useTranslation } from "react-i18next";
import { MediaPendingPlaceholder } from "./MediaPendingPlaceholder";

interface MessageContentProps {
  message: Message;
  isOwn: boolean;
}

/**
 * Renders the content of a message based on its type
 */
export function MessageContent({ message, isOwn }: MessageContentProps) {
  const { t } = useTranslation();

  if (message.isDeleted) {
    return (
      <span className="italic text-gray-500 dark:text-gray-400">
        {t("chat.messageDeleted")}
      </span>
    );
  }

  const contentRenderer: Record<MessageType, () => React.ReactNode> = {
    text: () => (
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
    ),
    image: () => {
      // Show placeholder if media is pending download
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="image"
            caption={message.metadata?.caption}
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      return (
        <div className="max-w-xs">
          <img
            src={message.metadata?.mediaUrl}
            alt={message.metadata?.caption || "Image"}
            className="rounded-lg max-w-full h-auto cursor-pointer"
            loading="lazy"
          />
          {message.metadata?.caption && (
            <p className="mt-1 whitespace-pre-wrap break-words">
              {message.metadata.caption}
            </p>
          )}
        </div>
      );
    },
    video: () => {
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="video"
            caption={message.metadata?.caption}
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      return (
        <div className="max-w-xs">
          <video
            src={message.metadata?.mediaUrl}
            poster={message.metadata?.thumbnailUrl}
            controls
            className="rounded-lg max-w-full h-auto"
          />
          {message.metadata?.caption && (
            <p className="mt-1 whitespace-pre-wrap break-words">
              {message.metadata.caption}
            </p>
          )}
        </div>
      );
    },
    audio: () => {
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="audio"
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      return (
        <div className="flex items-center gap-2 min-w-[200px]">
          <audio
            src={message.metadata?.mediaUrl}
            controls
            className="w-full"
          />
          {message.metadata?.duration && (
            <span className="text-xs text-gray-500">
              {Math.floor(message.metadata.duration / 60)}:
              {String(message.metadata.duration % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      );
    },
    document: () => {
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="document"
            caption={message.metadata?.fileName}
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      return (
        <a
          href={message.metadata?.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-dark-tertiary rounded-lg hover:bg-gray-200 dark:hover:bg-dark-border transition-colors"
        >
          <div className="flex-shrink-0">
            <svg
              className="h-10 w-10 text-gray-500 dark:text-dark-text-secondary"
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
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary truncate">
              {message.metadata?.fileName || "Document"}
            </p>
            {message.metadata?.fileSize && (
              <p className="text-xs text-gray-500 dark:text-dark-text-secondary">
                {formatFileSize(message.metadata.fileSize)}
              </p>
            )}
          </div>
        </a>
      );
    },
    sticker: () => {
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="sticker"
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      return (
        <div className="max-w-[200px]">
          <img
            src={message.metadata?.mediaUrl}
            alt="Sticker"
            className="w-full h-auto"
            loading="lazy"
          />
        </div>
      );
    },
    location: () => (
      <div className="max-w-xs">
        <div className="bg-gray-200 dark:bg-dark-tertiary rounded-lg h-32 flex items-center justify-center">
          <svg
            className="h-8 w-8 text-gray-500 dark:text-dark-text-secondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <p className="mt-1 text-sm">
          {message.metadata?.latitude}, {message.metadata?.longitude}
        </p>
      </div>
    ),
    template: () => (
      <div className="p-3 bg-gray-50 dark:bg-dark-tertiary rounded-lg border border-gray-200 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-dark-text-secondary mb-1">
          Template Message
        </p>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    ),
  };

  return (
    contentRenderer[message.messageType]?.() || (
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
    )
  );
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
