import type { Message } from "@wateaminbox/shared";
import { Image as ImageIcon, Play, Video } from "lucide-react";
import { useMemo, useState } from "react";
import type { GroupParticipant } from "@/hooks/useGroups";
import { cn } from "@/lib/utils";
import { LinkifiedText } from "./LinkifiedText";
import { MediaLightbox } from "./MediaLightbox";

interface MediaAlbumContentProps {
  messages: Message[];
  expectedCount: number;
  isOwn: boolean;
  mentionParticipants?: Pick<
    GroupParticipant,
    "jid" | "phoneNumber" | "mentionIds" | "displayName"
  >[];
  enableMediaPreview?: boolean;
}

function albumCaption(messages: Message[]): string | undefined {
  return messages.find((message) => message.content.trim())?.content;
}

function tileClassName(count: number, index: number): string {
  if (count === 2) return "aspect-[4/5]";
  if (count === 3 && index === 0) return "row-span-2 min-h-52";
  return "aspect-square";
}

export function MediaAlbumContent({
  messages,
  expectedCount,
  isOwn,
  mentionParticipants = [],
  enableMediaPreview = true,
}: MediaAlbumContentProps) {
  const visibleMessages = messages.slice(0, 4);
  const totalCount = Math.max(expectedCount, messages.length);
  const hiddenCount = Math.max(0, totalCount - visibleMessages.length);
  const caption = albumCaption(messages);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId],
  );
  const selectedUrl = selectedMessage?.metadata?.mediaUrl;

  return (
    <div className="w-[min(31rem,72vw)] max-w-full">
      <div
        className={cn(
          "grid grid-cols-2 gap-1 overflow-hidden rounded-xl bg-black/10 dark:bg-black/25",
          visibleMessages.length === 3 && "grid-rows-2",
        )}
        aria-label={`${totalCount} media items`}
      >
        {visibleMessages.map((albumMessage, index) => {
          const mediaUrl = albumMessage.metadata?.mediaUrl;
          const isVideo = albumMessage.messageType === "video";
          const showRemainder =
            hiddenCount > 0 && index === visibleMessages.length - 1;
          const label = `${isVideo ? "Video" : "Photo"} ${index + 1} of ${totalCount}`;

          return (
            <button
              key={albumMessage.id}
              type="button"
              className={cn(
                "group/album relative min-h-0 min-w-0 overflow-hidden bg-[#dfe5e7] text-white focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white dark:bg-[#111b21]",
                tileClassName(visibleMessages.length, index),
                enableMediaPreview ? "cursor-pointer" : "pointer-events-none",
              )}
              onClick={(event) => {
                if (!enableMediaPreview || !mediaUrl) return;
                event.stopPropagation();
                setSelectedMessageId(albumMessage.id);
              }}
              aria-label={enableMediaPreview ? `Open ${label}` : label}
              tabIndex={enableMediaPreview ? 0 : -1}
            >
              {mediaUrl ? (
                isVideo ? (
                  <video
                    src={mediaUrl}
                    poster={albumMessage.metadata?.thumbnailUrl}
                    preload="metadata"
                    muted
                    playsInline
                    className="pointer-events-none size-full object-cover transition-transform duration-200 group-hover/album:scale-[1.02]"
                    aria-hidden="true"
                  />
                ) : (
                  <img
                    src={mediaUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-200 group-hover/album:scale-[1.02]"
                  />
                )
              ) : (
                <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#dce5e3] to-[#b7c3c0] text-[#54656f] dark:from-[#243138] dark:to-[#111b21] dark:text-[#aebac1]">
                  {isVideo ? (
                    <Video className="size-7" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="size-7" aria-hidden="true" />
                  )}
                </span>
              )}

              {isVideo && !showRemainder && (
                <span className="absolute inset-0 grid place-items-center bg-black/10">
                  <span className="grid size-10 place-items-center rounded-full bg-[#111b21]/70 shadow-md backdrop-blur-sm">
                    <Play
                      className="ml-0.5 size-5 fill-current"
                      aria-hidden="true"
                    />
                  </span>
                </span>
              )}

              {showRemainder && (
                <span className="absolute inset-0 grid place-items-center bg-[#0b141a]/65 text-3xl font-medium tabular-nums backdrop-blur-[2px]">
                  +{hiddenCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {caption && (
        <LinkifiedText
          text={caption}
          isOwn={isOwn}
          className="mt-1.5"
          mentionParticipants={mentionParticipants}
        />
      )}

      {selectedMessage && selectedUrl && (
        <MediaLightbox
          open
          onOpenChange={(open) => {
            if (!open) setSelectedMessageId(null);
          }}
          src={selectedUrl}
          alt={caption || "Album media"}
          caption={caption}
          mediaType={
            selectedMessage.messageType === "video" ? "video" : undefined
          }
        />
      )}
    </div>
  );
}
