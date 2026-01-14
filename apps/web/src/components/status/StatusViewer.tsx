import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { useAsyncData } from "@/hooks";
import { useContactStatus } from "@/hooks/useStatus";

export interface StatusViewerProps {
  jid: string | null;
  onClose: () => void;
}

/**
 * Full-screen status viewer component
 * Shows status updates with progress bar and navigation
 */
export function StatusViewer({ jid, onClose }: StatusViewerProps) {
  const { data: contactStatus, renderState } = useAsyncData(
    useContactStatus(jid),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  const statuses = contactStatus?.statuses || [];
  const currentStatus = statuses[currentIndex];
  const totalStatuses = statuses.length;

  // Auto-advance timer
  useEffect(() => {
    if (!currentStatus || isPaused) return;

    const duration = currentStatus.mediaType === "video" ? 30000 : 5000; // 30s for video, 5s for others
    const interval = 50; // Update every 50ms for smooth progress
    const increment = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          // Move to next status
          if (currentIndex < totalStatuses - 1) {
            setCurrentIndex((i) => i + 1);
            return 0;
          } else {
            // Close viewer when all statuses are viewed
            onClose();
            return 100;
          }
        }
        return prev + increment;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [currentStatus, isPaused, currentIndex, totalStatuses, onClose]);

  // Reset progress when changing status
  useEffect(() => {
    setProgress(0);
  }, []);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    if (currentIndex < totalStatuses - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      onClose();
    }
  }, [currentIndex, totalStatuses, onClose]);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => !m);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          goToPrevious();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case " ":
          e.preventDefault();
          togglePause();
          break;
        case "Escape":
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToPrevious, goToNext, togglePause, onClose]);

  if (!jid) return null;

  const phoneNumber = jid.split("@")[0];
  const displayName = phoneNumber || "Unknown";

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 z-10 p-2">
        <div className="flex gap-1">
          {statuses.map((_, index) => (
            <div
              key={index}
              className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-white transition-all duration-50"
                style={{
                  width:
                    index < currentIndex
                      ? "100%"
                      : index === currentIndex
                        ? `${progress}%`
                        : "0%",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="absolute top-4 left-0 right-0 z-10 px-4 pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Close button */}
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {/* Contact info */}
          <div>
            <p className="text-white font-medium">{displayName}</p>
            {currentStatus && (
              <p className="text-white/70 text-sm">
                {new Date(currentStatus.timestamp).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 text-white" />
            ) : (
              <Volume2 className="w-5 h-5 text-white" />
            )}
          </button>
          <button
            onClick={togglePause}
            className="p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
          >
            {isPaused ? (
              <Play className="w-5 h-5 text-white" />
            ) : (
              <Pause className="w-5 h-5 text-white" />
            )}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center relative">
        {renderState({
          loading: () => (
            <div className="flex flex-col items-center">
              <Skeleton className="w-96 h-96 rounded-lg" />
              <Skeleton className="w-48 h-6 mt-4" />
            </div>
          ),
          error: () => (
            <div className="text-center text-white">
              <p className="text-xl font-medium">Failed to load status</p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30"
              >
                Close
              </button>
            </div>
          ),
          empty: () => (
            <div className="text-center text-white">
              <p className="text-xl font-medium">No status available</p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30"
              >
                Close
              </button>
            </div>
          ),
          success: (contactStatus) => {
            const currentStatus = contactStatus.statuses[currentIndex];
            if (!currentStatus) return null;

            return (
              <div className="max-w-lg mx-auto text-center">
                {currentStatus.mediaUrl ? (
                  currentStatus.mediaType === "video" ? (
                    <video
                      src={currentStatus.mediaUrl}
                      className="max-h-[70vh] rounded-lg"
                      autoPlay
                      muted={isMuted}
                      loop={false}
                    />
                  ) : (
                    <img
                      src={currentStatus.mediaUrl}
                      alt="Status"
                      className="max-h-[70vh] rounded-lg object-contain"
                    />
                  )
                ) : (
                  // Text-only status
                  <div className="p-8 bg-gradient-to-br from-whatsapp-teal-green to-whatsapp-dark-green rounded-lg">
                    <p className="text-white text-2xl font-medium">
                      {currentStatus.caption || "No content"}
                    </p>
                  </div>
                )}

                {/* Caption */}
                {currentStatus.mediaUrl && currentStatus.caption && (
                  <p className="mt-4 text-white text-lg">
                    {currentStatus.caption}
                  </p>
                )}
              </div>
            );
          },
        })}

        {/* Navigation areas */}
        <button
          onClick={goToPrevious}
          className="absolute left-0 top-0 bottom-0 w-1/4 flex items-center justify-start pl-4 opacity-0 hover:opacity-100 transition-opacity"
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="w-10 h-10 text-white" />
        </button>
        <button
          onClick={goToNext}
          className="absolute right-0 top-0 bottom-0 w-1/4 flex items-center justify-end pr-4 opacity-0 hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-10 h-10 text-white" />
        </button>
      </div>

      {/* Footer with reply */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/50 to-transparent">
        <div className="max-w-lg mx-auto">
          <input
            type="text"
            placeholder="Reply..."
            className="w-full px-4 py-3 bg-white/20 dark:bg-white/10 border border-white/30 dark:border-white/20 rounded-full text-white placeholder-white/60 dark:placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50"
          />
        </div>
      </div>
    </div>
  );
}

export default StatusViewer;
