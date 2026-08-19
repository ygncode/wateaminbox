import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Download,
  ExternalLink,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.5;

interface MediaLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  caption?: string;
  mediaType?: "document" | "image" | "video";
}

export function MediaLightbox({
  open,
  onOpenChange,
  src,
  alt,
  caption,
  mediaType = "image",
}: MediaLightboxProps) {
  const { t } = useTranslation();

  const [zoom, setZoom] = useState(MIN_ZOOM);
  const descriptionId = useId();
  const isImage = mediaType === "image";
  const isDocument = mediaType === "document";

  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) setZoom(MIN_ZOOM);
    onOpenChange(nextOpen);
  };

  const zoomOut = () =>
    setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP));
  const zoomIn = () =>
    setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={updateOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[#0b141a]/95 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[71] flex flex-col text-white outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          aria-describedby={caption ? descriptionId : undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {alt}
          </DialogPrimitive.Title>

          <header className="flex min-h-16 items-center gap-3 border-b border-white/10 bg-[#111b21]/88 px-3 backdrop-blur-md sm:px-5">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="grid size-10 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                aria-label={`Close ${mediaType}`}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>

            <p className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
              {caption || alt}
            </p>

            <div className="flex items-center gap-0.5">
              {isImage && (
                <>
                  <button
                    type="button"
                    onClick={zoomOut}
                    disabled={zoom <= MIN_ZOOM}
                    className="hidden size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 sm:grid"
                    aria-label={t("chat.zoomOut", "Zoom out")}
                  >
                    <Minus className="size-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(MIN_ZOOM)}
                    disabled={zoom === MIN_ZOOM}
                    className="hidden size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 sm:grid"
                    aria-label={t("chat.resetZoom", "Reset zoom")}
                  >
                    <RotateCcw className="size-4.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={zoomIn}
                    disabled={zoom >= MAX_ZOOM}
                    className="hidden size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 sm:grid"
                    aria-label={t("chat.zoomIn", "Zoom in")}
                  >
                    <Plus className="size-5" aria-hidden="true" />
                  </button>
                </>
              )}
              <a
                href={src}
                download
                className="grid size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                aria-label={`Download ${mediaType}`}
              >
                <Download className="size-5" aria-hidden="true" />
              </a>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="grid size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
                aria-label={`Open original ${mediaType}`}
              >
                <ExternalLink className="size-5" aria-hidden="true" />
              </a>
            </div>
          </header>

          <div
            className={`flex min-h-0 flex-1 items-center justify-center overflow-auto ${
              isDocument ? "bg-[#202c33] p-2 sm:p-4" : "p-4 sm:p-8"
            }`}
            onClick={(event) => {
              if (event.target === event.currentTarget) updateOpen(false);
            }}
          >
            {isImage ? (
              <img
                src={src}
                alt={alt}
                draggable={false}
                className="max-h-full max-w-full select-none object-contain shadow-2xl shadow-black/30 transition-transform duration-200 ease-out"
                style={{ transform: `scale(${zoom})` }}
                onDoubleClick={() =>
                  setZoom((current) =>
                    current === MIN_ZOOM ? MIN_ZOOM + ZOOM_STEP : MIN_ZOOM,
                  )
                }
              />
            ) : isDocument ? (
              <iframe
                src={src}
                title={alt}
                className="h-full w-full max-w-6xl rounded-md border-0 bg-white shadow-2xl shadow-black/40"
              />
            ) : (
              <video
                src={src}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-md bg-black object-contain shadow-2xl shadow-black/40"
                aria-label={alt}
              />
            )}
          </div>

          {caption && (
            <p
              id={descriptionId}
              className="border-t border-white/10 bg-[#111b21]/88 px-5 py-3 text-center text-sm leading-5 text-white/80 backdrop-blur-md"
            >
              {caption}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
