import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarClock, FileText, Loader2, Send, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { ScheduleMessagePopover } from "./ScheduleMessagePopover";

const MAX_CAPTION_LENGTH = 1024;

interface AttachmentPreviewDialogProps {
  file: File;
  attachmentType: "image" | "document";
  onCancel: () => void;
  onSend: (
    file: File,
    type: "image" | "document",
    caption: string,
  ) => Promise<boolean>;
  /** When provided, the dialog offers scheduling next to immediate send. */
  onSchedule?: (
    file: File,
    type: "image" | "document",
    caption: string,
    scheduledAtIso: string,
  ) => Promise<boolean>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

export function AttachmentPreviewDialog({
  file,
  attachmentType,
  onCancel,
  onSend,
  onSchedule,
}: AttachmentPreviewDialogProps) {
  const [caption, setCaption] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showSchedulePopover, setShowSchedulePopover] = useState(false);
  const isBusy = isSending || isScheduling;
  const isVideo = file.type.startsWith("video/");
  const isVisualMedia =
    attachmentType === "image" && (file.type.startsWith("image/") || isVideo);
  const fileNameParts = file.name.split(".");
  const fileExtension =
    fileNameParts.length > 1
      ? fileNameParts[fileNameParts.length - 1]?.toUpperCase()
      : "FILE";

  useEffect(() => {
    setCaption("");

    if (!isVisualMedia) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isVisualMedia]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) return;

    setIsSending(true);
    try {
      const wasSent = await onSend(file, attachmentType, caption.trim());
      if (wasSent) onCancel();
    } finally {
      setIsSending(false);
    }
  };

  const handleSchedule = async (scheduledAtIso: string) => {
    if (!onSchedule || isBusy) return;

    setIsScheduling(true);
    try {
      const wasScheduled = await onSchedule(
        file,
        attachmentType,
        caption.trim(),
        scheduledAtIso,
      );
      if (wasScheduled) {
        setShowSchedulePopover(false);
        onCancel();
      }
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !isBusy) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-[#0b141a]/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[81] flex max-h-[92vh] w-[calc(100%_-_1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111b21] text-white shadow-2xl shadow-black/50 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby="attachment-preview-description"
        >
          <DialogPrimitive.Title className="sr-only">
            Preview attachment
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="attachment-preview-description"
            className="sr-only"
          >
            Review the selected file and add an optional caption before sending.
          </DialogPrimitive.Description>

          <header className="flex min-h-16 items-center gap-3 border-b border-white/10 bg-[#202c33] px-3 sm:px-5">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                disabled={isBusy}
                className="grid size-10 shrink-0 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                aria-label="Cancel attachment"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white/95">
                {file.name}
              </p>
              <p className="text-xs text-white/55">
                {formatFileSize(file.size)}
              </p>
            </div>
          </header>

          <div className="flex min-h-56 flex-1 items-center justify-center overflow-auto bg-[#0b141a] p-4 sm:min-h-96 sm:p-8">
            {isVisualMedia && previewUrl ? (
              isVideo ? (
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="max-h-[58vh] max-w-full rounded-lg bg-black object-contain shadow-2xl shadow-black/30"
                  aria-label={`Preview ${file.name}`}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={`Preview ${file.name}`}
                  className="max-h-[58vh] max-w-full rounded-lg object-contain shadow-2xl shadow-black/30"
                />
              )
            ) : (
              <div className="flex max-w-sm flex-col items-center text-center">
                <span className="relative grid size-24 place-items-center rounded-2xl bg-[#202c33] text-[#aebac1] shadow-xl shadow-black/20">
                  <FileText className="size-11" aria-hidden="true" />
                  <span className="absolute -bottom-2 rounded-md bg-[#00a884] px-2 py-1 text-[10px] font-bold tracking-wide text-white shadow-md">
                    {fileExtension}
                  </span>
                </span>
                <p className="mt-6 max-w-full truncate text-sm font-medium text-white/90">
                  {file.name}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {formatFileSize(file.size)}
                </p>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-white/10 bg-[#202c33] p-3 sm:p-4"
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 rounded-2xl bg-[#2a3942] px-4 py-2 shadow-inner shadow-black/10 ring-1 ring-white/[0.04] focus-within:ring-[#00a884]/60">
                <textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  onKeyDown={handleCaptionKeyDown}
                  disabled={isBusy}
                  maxLength={MAX_CAPTION_LENGTH}
                  rows={1}
                  autoFocus
                  placeholder="Add a caption…"
                  aria-label="Attachment caption"
                  className="block max-h-28 min-h-7 w-full resize-none bg-transparent py-1 text-[15px] leading-5 text-white outline-none placeholder:text-[#8696a0] disabled:cursor-not-allowed"
                />
                {caption.length > MAX_CAPTION_LENGTH - 100 && (
                  <p className="text-right text-[10px] tabular-nums text-white/45">
                    {caption.length}/{MAX_CAPTION_LENGTH}
                  </p>
                )}
              </div>
              {onSchedule && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSchedulePopover(!showSchedulePopover)}
                    disabled={isBusy}
                    className={`grid size-12 shrink-0 place-items-center rounded-full text-white shadow-lg shadow-black/20 transition-all active:scale-95 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] focus-visible:ring-offset-2 focus-visible:ring-offset-[#202c33] ${
                      showSchedulePopover
                        ? "bg-[#2a3942] text-[#06cf9c]"
                        : "bg-[#2a3942] hover:bg-[#34434d]"
                    }`}
                    aria-label="Schedule attachment"
                    aria-expanded={showSchedulePopover}
                  >
                    {isScheduling ? (
                      <Loader2
                        className="size-5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <CalendarClock className="size-5" aria-hidden="true" />
                    )}
                  </button>
                  {showSchedulePopover && (
                    <ScheduleMessagePopover
                      onSchedule={handleSchedule}
                      isSubmitting={isScheduling}
                    />
                  )}
                </div>
              )}
              <button
                type="submit"
                disabled={isBusy}
                className="grid size-12 shrink-0 place-items-center rounded-full bg-[#00a884] text-white shadow-lg shadow-black/20 transition-all hover:bg-[#06cf9c] active:scale-95 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] focus-visible:ring-offset-2 focus-visible:ring-offset-[#202c33]"
                aria-label={
                  isSending ? "Sending attachment" : "Send attachment"
                }
              >
                {isSending ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-5" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="mt-2 hidden text-center text-[11px] text-white/40 sm:block">
              Press Ctrl/⌘ + Enter to send
            </p>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
