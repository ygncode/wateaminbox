import type { Message } from "@whatsapp-web/shared";

// Error code to human-readable message mapping
const ERROR_MESSAGES: Record<string, string> = {
  delivery_timeout: "Message delivery timed out",
  network_error: "Network error occurred",
  rate_limit: "Too many messages. Please try again later",
  unknown: "Failed to send message",
};

export function getErrorMessage(
  error?: string,
  customErrorMessage?: string,
): string {
  return (
    customErrorMessage || ERROR_MESSAGES[error || ""] || ERROR_MESSAGES.unknown
  );
}

interface MessageStatusIconProps {
  message: Message;
  isOwn: boolean;
}

/**
 * Renders the appropriate status icon for a message
 * (pending, sent, delivered, read, failed)
 */
export function MessageStatusIcon({ message, isOwn }: MessageStatusIconProps) {
  if (!isOwn) return null;

  switch (message.status) {
    case "pending":
      return (
        <span className="inline-flex" role="img" aria-label="Sending">
          <svg
            className="h-4 w-4 text-white/60"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" />
          </svg>
        </span>
      );
    case "sent":
      return (
        <span className="inline-flex" role="img" aria-label="Sent">
          <svg
            className="h-4 w-4 text-white/60"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.5 11.5L2 8l1-1 2.5 2.5L11 4l1 1-6.5 6.5z" />
          </svg>
        </span>
      );
    case "delivered":
      return (
        <span className="inline-flex" role="img" aria-label="Delivered">
          <svg
            className="h-4 w-4 text-white/60"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.5 11.5L2 8l1-1 2.5 2.5L11 4l1 1-6.5 6.5z" />
            <path d="M8.5 11.5L5 8l1-1 2.5 2.5L14 4l1 1-6.5 6.5z" />
          </svg>
        </span>
      );
    case "read":
      return (
        <span className="inline-flex" role="img" aria-label="Read">
          <svg
            className="h-4 w-4 text-blue-500"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.5 11.5L2 8l1-1 2.5 2.5L11 4l1 1-6.5 6.5z" />
            <path d="M8.5 11.5L5 8l1-1 2.5 2.5L14 4l1 1-6.5 6.5z" />
          </svg>
        </span>
      );
    case "failed": {
      const errorMsg = getErrorMessage(
        message.metadata?.error,
        message.metadata?.errorMessage,
      );
      return (
        <div
          className="group/tooltip relative flex items-center"
          role="img"
          aria-label={`Failed: ${errorMsg}`}
        >
          <svg
            className="h-4 w-4 text-red-500"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" />
            <path d="M8 4v5M8 11v1" />
          </svg>
          {/* Tooltip for failed messages */}
          <div
            className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-gray-900 dark:bg-dark-tertiary text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-10"
            aria-hidden="true"
          >
            {errorMsg}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
