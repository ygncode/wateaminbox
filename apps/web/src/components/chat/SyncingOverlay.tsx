import React, { useEffect, useState, useCallback } from "react";
import { nowMs } from "@whatsapp-web/shared";
import { toast } from "sonner";
import { useWebSocketContext } from "../../contexts/WebSocketProvider";
import { api } from "../../lib/api";

const SYNC_TIMEOUT_MS = 30 * 1000; // 30 seconds

export const SyncingOverlay = React.memo(function SyncingOverlay() {
  const { syncingConnections, clearSyncingConnections } = useWebSocketContext();
  const [timedOut, setTimedOut] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Calculate total conversations across all syncing connections
  const totalConversations = Array.from(syncingConnections.values()).reduce(
    (sum, s) => sum + s.conversations,
    0,
  );

  // Find oldest sync for timeout calculation
  const oldestStartedAt = React.useMemo(() => {
    let oldest: Date | undefined;
    for (const sync of syncingConnections.values()) {
      if (!oldest || sync.startedAt < oldest) {
        oldest = sync.startedAt;
      }
    }
    return oldest;
  }, [syncingConnections]);

  // Handle fade-in transition
  useEffect(() => {
    if (syncingConnections.size > 0) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [syncingConnections.size]);

  // Update elapsed time and check for timeout
  useEffect(() => {
    if (syncingConnections.size === 0 || !oldestStartedAt) {
      setTimedOut(false);
      setElapsedMs(0);
      return;
    }

    const updateElapsed = () => {
      const elapsed = nowMs() - oldestStartedAt.getTime();
      setElapsedMs(elapsed);
      if (elapsed >= SYNC_TIMEOUT_MS) {
        setTimedOut(true);
      }
    };

    // Initial check
    updateElapsed();

    // Update every second for progress display
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [syncingConnections, oldestStartedAt]);

  const handleContinue = useCallback(async () => {
    setIsResetting(true);
    try {
      await api.post("/whatsapp/sync-reset");
      clearSyncingConnections();
      setTimedOut(false);
      toast.success("Sync status cleared");
    } catch (error) {
      console.error("Failed to reset sync status:", error);
      toast.error("Failed to update sync status, continuing anyway");
      clearSyncingConnections();
      setTimedOut(false);
    } finally {
      setIsResetting(false);
    }
  }, [clearSyncingConnections]);

  if (syncingConnections.size === 0) return null;

  const progressPercent = Math.min(100, (elapsedMs / SYNC_TIMEOUT_MS) * 100);
  const remainingSeconds = Math.max(
    0,
    Math.ceil((SYNC_TIMEOUT_MS - elapsedMs) / 1000),
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-dark-primary transition-opacity duration-200 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="text-center">
        {/* Loading spinner with progress ring */}
        <div className="mb-4 flex justify-center">
          <div className="relative h-16 w-16">
            {/* Progress ring background */}
            <svg
              className="absolute inset-0 h-16 w-16 -rotate-90"
              viewBox="0 0 64 64"
            >
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                className="text-gray-200 dark:text-gray-700"
              />
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                strokeDasharray={`${progressPercent * 1.76} 176`}
                strokeLinecap="round"
                className="text-whatsapp-green transition-[stroke-dasharray] duration-1000"
              />
            </svg>
            {/* Spinner */}
            <div className="absolute inset-2 h-12 w-12 animate-spin rounded-full border-4 border-transparent border-t-whatsapp-green" />
          </div>
        </div>

        <h2 className="text-xl font-medium text-gray-900 dark:text-dark-text-primary mb-2">
          Syncing messages...
        </h2>

        <p className="text-gray-600 dark:text-dark-text-secondary">
          {totalConversations > 0
            ? `${totalConversations} conversation${totalConversations !== 1 ? "s" : ""} synced`
            : "Please wait while we sync your conversations"}
        </p>

        {/* Remaining time indicator */}
        {!timedOut && remainingSeconds > 0 && (
          <p className="text-sm text-gray-500 dark:text-dark-text-tertiary mt-2">
            {remainingSeconds}s remaining
          </p>
        )}

        {timedOut && (
          <button
            type="button"
            disabled={isResetting}
            onClick={handleContinue}
            className="mt-6 px-6 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-whatsapp-green/90 transition-colors disabled:opacity-50"
          >
            {isResetting ? "Updating..." : "Continue to chats"}
          </button>
        )}
      </div>
    </div>
  );
});
