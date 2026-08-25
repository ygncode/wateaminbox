import type { Message, MessageType } from "@wateaminbox/shared";
import { Maximize2, Play } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroupParticipant } from "@/hooks/useGroups";
import { LinkifiedText } from "./LinkifiedText";
import { MediaLightbox } from "./MediaLightbox";
import { MediaPendingPlaceholder } from "./MediaPendingPlaceholder";

interface MessageContentProps {
  message: Message;
  isOwn: boolean;
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "mentionIds" | "displayName"
  >[];
  enableMediaPreview?: boolean;
}

/**
 * Renders the content of a message based on its type
 */
export function MessageContent({
  message,
  isOwn,
  mentionParticipants = [],
  enableMediaPreview = true,
}: MessageContentProps) {
  const { t } = useTranslation();
  const [mediaPreviewOpen, setMediaPreviewOpen] = useState(false);

  if (message.isDeleted) {
    return (
      <span className="italic text-gray-500 dark:text-gray-400">
        {t("chat.messageDeleted")}
      </span>
    );
  }

  // WhatsApp media captions are stored as message content by the worker. Newer
  // payloads may also expose metadata.caption, so support both shapes.
  const mediaCaption =
    message.metadata?.caption || message.content || undefined;

  const contentRenderer: Record<MessageType, () => React.ReactNode> = {
    text: () => (
      <LinkifiedText
        text={message.content}
        isOwn={isOwn}
        mentionParticipants={mentionParticipants}
      />
    ),
    image: () => {
      // Show placeholder if media is pending download
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="image"
            caption={mediaCaption}
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      const mediaUrl = message.metadata?.mediaUrl;
      const imageAlt = mediaCaption || "Image message";

      return (
        <div className="max-w-xs">
          {mediaUrl ? (
            <>
              <button
                type="button"
                className={`group/media relative block max-w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 ${
                  isOwn
                    ? "focus-visible:ring-offset-whatsapp-green"
                    : "focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-elevated"
                } ${enableMediaPreview ? "cursor-zoom-in" : "pointer-events-none"}`}
                onClick={(event) => {
                  if (!enableMediaPreview) return;
                  event.stopPropagation();
                  setMediaPreviewOpen(true);
                }}
                aria-label={`Open image: ${imageAlt}`}
                tabIndex={enableMediaPreview ? 0 : -1}
              >
                <img
                  src={mediaUrl}
                  alt={imageAlt}
                  width={320}
                  height={240}
                  className="h-auto max-w-full transition-transform duration-200 group-hover/media:scale-[1.015]"
                  loading="lazy"
                />
                {enableMediaPreview && (
                  <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-[#111b21]/60 text-white opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/media:opacity-100 group-focus-visible/media:opacity-100">
                    <Maximize2 className="size-4" aria-hidden="true" />
                  </span>
                )}
              </button>

              <MediaLightbox
                open={mediaPreviewOpen}
                onOpenChange={setMediaPreviewOpen}
                src={mediaUrl}
                alt={imageAlt}
                caption={mediaCaption}
              />
            </>
          ) : (
            <div className="flex h-40 w-64 items-center justify-center rounded-lg bg-black/10 text-sm text-current/60 dark:bg-white/[0.06]">
              {t("chat.imageUnavailable", "Image unavailable")}
            </div>
          )}
          {mediaCaption && (
            <LinkifiedText
              text={mediaCaption}
              isOwn={isOwn}
              className="mt-1"
              mentionParticipants={mentionParticipants}
            />
          )}
        </div>
      );
    },
    video: () => {
      if (message.metadata?.mediaPending && !message.metadata?.mediaUrl) {
        return (
          <MediaPendingPlaceholder
            type="video"
            caption={mediaCaption}
            downloadStatus={message.metadata?.mediaDownloadStatus}
            messageId={message.id}
            conversationId={message.conversationId}
            isOwn={isOwn}
          />
        );
      }
      const mediaUrl = message.metadata?.mediaUrl;
      const videoLabel = mediaCaption || "Video message";

      return (
        <div className="max-w-xs">
          {mediaUrl ? (
            <>
              <button
                type="button"
                className={`group/media relative block max-w-full overflow-hidden rounded-lg bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 ${
                  isOwn
                    ? "focus-visible:ring-offset-whatsapp-green"
                    : "focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-elevated"
                } ${enableMediaPreview ? "cursor-pointer" : "pointer-events-none"}`}
                onClick={(event) => {
                  if (!enableMediaPreview) return;
                  event.stopPropagation();
                  setMediaPreviewOpen(true);
                }}
                aria-label={`Play video: ${videoLabel}`}
                tabIndex={enableMediaPreview ? 0 : -1}
              >
                <video
                  src={mediaUrl}
                  poster={message.metadata?.thumbnailUrl}
                  preload="metadata"
                  muted
                  playsInline
                  width={320}
                  className="pointer-events-none h-auto max-w-full"
                  aria-hidden="true"
                />
                {enableMediaPreview && (
                  <>
                    <span className="absolute inset-0 bg-black/10 transition-colors group-hover/media:bg-black/20" />
                    <span className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#111b21]/75 text-white shadow-lg backdrop-blur-sm transition-transform group-hover/media:scale-105 group-focus-visible/media:scale-105">
                      <Play
                        className="ml-0.5 size-6 fill-current"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-[#111b21]/60 text-white opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/media:opacity-100 group-focus-visible/media:opacity-100">
                      <Maximize2 className="size-4" aria-hidden="true" />
                    </span>
                  </>
                )}
              </button>

              <MediaLightbox
                open={mediaPreviewOpen}
                onOpenChange={setMediaPreviewOpen}
                src={mediaUrl}
                alt={videoLabel}
                caption={mediaCaption}
                mediaType="video"
              />
            </>
          ) : (
            <div className="flex h-40 w-64 items-center justify-center rounded-lg bg-black/10 text-sm text-current/60 dark:bg-white/[0.06]">
              {t("chat.videoUnavailable", "Video unavailable")}
            </div>
          )}
          {mediaCaption && (
            <LinkifiedText
              text={mediaCaption}
              isOwn={isOwn}
              className="mt-1"
              mentionParticipants={mentionParticipants}
            />
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
            aria-label={t("chat.audioMessage", "Audio message")}
          />
          {message.metadata?.duration && (
            <span
              className="text-xs text-gray-500 tabular-nums"
              aria-hidden="true"
            >
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
      const mediaUrl = message.metadata?.mediaUrl;
      const fileName = message.metadata?.fileName || "Document";
      const mimeType = message.metadata?.mimeType?.toLowerCase();
      const isPdf =
        mimeType === "application/pdf" ||
        fileName.toLowerCase().endsWith(".pdf");
      const fileNameParts = fileName.split(".");
      const mimeTypeParts = mimeType?.split("/");
      const fileExtension =
        fileNameParts.length > 1
          ? fileNameParts[fileNameParts.length - 1]?.toUpperCase()
          : undefined;
      const mimeSubtype = mimeTypeParts?.[mimeTypeParts.length - 1];
      const cardClassName =
        "flex w-full max-w-xs items-center gap-3 rounded-lg bg-gray-100 p-3 text-left transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green dark:bg-dark-tertiary dark:hover:bg-dark-border";
      const withCaption = (card: ReactNode) => (
        <div className="max-w-xs">
          {card}
          {mediaCaption && (
            <LinkifiedText
              text={mediaCaption}
              isOwn={isOwn}
              className="mt-1"
              mentionParticipants={mentionParticipants}
            />
          )}
        </div>
      );
      const documentCard = (
        <>
          <div className="flex-shrink-0">
            <svg
              className="h-10 w-10 text-gray-500 dark:text-dark-text-secondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
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
              {fileName}
            </p>
            <p className="text-xs uppercase text-gray-500 dark:text-dark-text-secondary">
              {isPdf ? "PDF" : fileExtension || mimeSubtype || "Document"}
              {message.metadata?.fileSize
                ? ` · ${formatFileSize(message.metadata.fileSize)}`
                : ""}
            </p>
          </div>
        </>
      );

      if (!mediaUrl) {
        return withCaption(
          <div className={cardClassName}>
            {documentCard}
            <span className="sr-only">
              {t("chat.documentUnavailable", "Document unavailable")}
            </span>
          </div>,
        );
      }

      if (!enableMediaPreview) {
        return withCaption(<div className={cardClassName}>{documentCard}</div>);
      }

      if (isPdf) {
        return withCaption(
          <>
            <button
              type="button"
              className={cardClassName}
              onClick={(event) => {
                event.stopPropagation();
                setMediaPreviewOpen(true);
              }}
              aria-label={`Preview PDF: ${fileName}`}
            >
              {documentCard}
            </button>
            <MediaLightbox
              open={mediaPreviewOpen}
              onOpenChange={setMediaPreviewOpen}
              src={mediaUrl}
              alt={fileName}
              mediaType="document"
            />
          </>,
        );
      }

      return withCaption(
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cardClassName}
          onClick={(event) => event.stopPropagation()}
        >
          {documentCard}
        </a>,
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
      const mediaUrl = message.metadata?.mediaUrl;

      return (
        <div className="max-w-[200px]">
          {mediaUrl ? (
            <>
              <button
                type="button"
                className={`group/media relative block max-w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 ${
                  isOwn
                    ? "focus-visible:ring-offset-whatsapp-green"
                    : "focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-elevated"
                } ${enableMediaPreview ? "cursor-zoom-in" : "pointer-events-none"}`}
                onClick={(event) => {
                  if (!enableMediaPreview) return;
                  event.stopPropagation();
                  setMediaPreviewOpen(true);
                }}
                aria-label={t("chat.openSticker", "Open sticker")}
                tabIndex={enableMediaPreview ? 0 : -1}
              >
                <img
                  src={mediaUrl}
                  alt={t("chat.mediaTypes.sticker", "Sticker")}
                  width={200}
                  height={200}
                  className="h-auto w-full transition-transform duration-200 group-hover/media:scale-[1.025]"
                  loading="lazy"
                />
              </button>
              <MediaLightbox
                open={mediaPreviewOpen}
                onOpenChange={setMediaPreviewOpen}
                src={mediaUrl}
                alt={t("chat.mediaTypes.sticker", "Sticker")}
              />
            </>
          ) : (
            <div className="flex size-40 items-center justify-center rounded-lg bg-black/10 text-sm text-current/60 dark:bg-white/[0.06]">
              {t("chat.stickerUnavailable", "Sticker unavailable")}
            </div>
          )}
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
            aria-hidden="true"
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
        <p className="mt-1 text-sm tabular-nums">
          {message.metadata?.latitude}, {message.metadata?.longitude}
        </p>
      </div>
    ),
    template: () => (
      <div className="p-3 bg-gray-50 dark:bg-dark-tertiary rounded-lg border border-gray-200 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-dark-text-secondary mb-1">
          {t("chat.templateMessage", "Template Message")}
        </p>
        <LinkifiedText text={message.content} isOwn={isOwn} />
      </div>
    ),
    contact: () => (
      <div className="p-3 bg-gray-50 dark:bg-dark-tertiary rounded-lg border border-gray-200 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-dark-text-secondary mb-1">
          {t("chat.contactCard", "Contact Card")}
        </p>
        <LinkifiedText text={message.content} isOwn={isOwn} />
      </div>
    ),
    reaction: () => (
      <div className="flex items-center gap-2">
        <span className="text-2xl">{message.content}</span>
        <span className="text-xs text-gray-500 dark:text-dark-text-secondary">
          Reaction
        </span>
      </div>
    ),
  };

  return (
    contentRenderer[message.messageType]?.() || (
      <LinkifiedText text={message.content} isOwn={isOwn} />
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
