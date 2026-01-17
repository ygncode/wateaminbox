import type { MediaDownloadStatus } from "@wateaminbox/shared";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRequestMediaDownload } from "../../hooks/useMessages";
import { MediaTypeIcons } from "./MessageIcons";

interface MediaPendingPlaceholderProps {
  type: "image" | "video" | "audio" | "document" | "sticker";
  caption?: string;
  downloadStatus?: MediaDownloadStatus;
  messageId: string;
  conversationId: string;
  isOwn: boolean;
}

/**
 * Placeholder component for pending media with auto-download on scroll
 */
export function MediaPendingPlaceholder({
  type,
  caption,
  downloadStatus,
  messageId,
  conversationId,
  isOwn,
}: MediaPendingPlaceholderProps) {
  const { t } = useTranslation();
  const placeholderRef = useRef<HTMLDivElement>(null);
  const hasTriggeredDownload = useRef(false);
  const requestDownload = useRequestMediaDownload();

  // Auto-download when placeholder enters viewport
  useEffect(() => {
    const element = placeholderRef.current;
    if (!element) return;
    // Don't trigger if already downloading or completed or failed
    if (
      downloadStatus === "downloading" ||
      downloadStatus === "completed" ||
      downloadStatus === "failed"
    ) {
      return;
    }
    // Don't trigger if we already requested download for this message
    if (hasTriggeredDownload.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !hasTriggeredDownload.current) {
          hasTriggeredDownload.current = true;
          requestDownload.mutate({
            messageId,
            conversationId,
          });
        }
      },
      {
        threshold: 0.5, // Trigger when 50% visible
        rootMargin: "100px", // Start loading slightly before fully visible
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [downloadStatus, requestDownload, messageId, conversationId]);

  const isDownloading =
    downloadStatus === "downloading" || requestDownload.isPending;
  const hasFailed = downloadStatus === "failed";

  const handleRetryDownload = useCallback(() => {
    hasTriggeredDownload.current = true;
    requestDownload.mutate({
      messageId,
      conversationId,
    });
  }, [requestDownload, messageId, conversationId]);

  return (
    <div className="max-w-xs" ref={placeholderRef}>
      <div
        className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg ${
          isOwn
            ? "bg-whatsapp-dark-green/30"
            : "bg-gray-100 dark:bg-dark-tertiary"
        }`}
      >
        {isDownloading ? (
          // Loading spinner
          <>
            <svg
              className={`animate-spin h-8 w-8 ${
                isOwn
                  ? "text-white/60"
                  : "text-gray-400 dark:text-dark-text-tertiary"
              }`}
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
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span
              className={`text-xs ${
                isOwn
                  ? "text-white/60"
                  : "text-gray-500 dark:text-dark-text-secondary"
              }`}
            >
              {t("chat.downloadingMedia")}
            </span>
          </>
        ) : hasFailed ? (
          // Failed state with retry button
          <>
            <div className={isOwn ? "text-red-300" : "text-red-500"}>
              <svg
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span
              className={`text-xs ${isOwn ? "text-red-300" : "text-red-500"}`}
            >
              {t("chat.downloadFailed")}
            </span>
            <button
              onClick={handleRetryDownload}
              className={`text-xs px-2 py-1 rounded ${
                isOwn
                  ? "bg-white/20 hover:bg-white/30 text-white"
                  : "bg-gray-200 hover:bg-gray-300 dark:bg-dark-border dark:hover:bg-dark-tertiary text-gray-700 dark:text-dark-text-primary"
              }`}
            >
              {t("chat.retryDownload")}
            </button>
          </>
        ) : (
          // Pending state
          <>
            <div
              className={
                isOwn
                  ? "text-white/60"
                  : "text-gray-400 dark:text-dark-text-tertiary"
              }
            >
              {MediaTypeIcons[type]}
            </div>
            <span
              className={`text-xs ${
                isOwn
                  ? "text-white/60"
                  : "text-gray-500 dark:text-dark-text-secondary"
              }`}
            >
              {t("chat.mediaNotDownloaded")}
            </span>
          </>
        )}
      </div>
      {caption && (
        <p className="mt-1 whitespace-pre-wrap break-words">{caption}</p>
      )}
    </div>
  );
}
