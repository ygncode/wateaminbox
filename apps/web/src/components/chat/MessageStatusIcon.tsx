import type { Message } from "@wateaminbox/shared";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

// Error code to translation key + English fallback mapping
const ERROR_MESSAGES: Record<string, [key: string, fallback: string]> = {
  delivery_timeout: [
    "chat.sendErrors.deliveryTimeout",
    "Message delivery timed out",
  ],
  network_error: ["chat.sendErrors.networkError", "Network error occurred"],
  rate_limit: [
    "chat.sendErrors.rateLimit",
    "Too many messages. Please try again later",
  ],
  unknown: ["chat.sendErrors.unknown", "Failed to send message"],
};

export function getErrorMessage(
  t: TFunction,
  error?: string,
  customErrorMessage?: string,
): string {
  if (customErrorMessage) return customErrorMessage;
  const [key, fallback] = ERROR_MESSAGES[error || ""] || ERROR_MESSAGES.unknown;
  return t(key, fallback);
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
  const { t } = useTranslation();

  if (!isOwn) return null;

  switch (message.status) {
    case "pending":
      return (
        <span
          className="inline-flex"
          role="img"
          aria-label={t("chat.statusLabels.sending", "Sending")}
        >
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
        <span
          className="inline-flex"
          role="img"
          aria-label={t("chat.statusLabels.sent", "Sent")}
        >
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
        <span
          className="inline-flex"
          role="img"
          aria-label={t("chat.statusLabels.delivered", "Delivered")}
        >
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
        <span
          className="inline-flex"
          role="img"
          aria-label={t("chat.statusLabels.read", "Read")}
        >
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
        t,
        message.metadata?.error,
        message.metadata?.errorMessage,
      );
      return (
        <div
          className="group/tooltip relative flex items-center"
          role="img"
          aria-label={t("chat.statusLabels.failedWithReason", {
            defaultValue: "Failed: {{reason}}",
            reason: errorMsg,
          })}
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
