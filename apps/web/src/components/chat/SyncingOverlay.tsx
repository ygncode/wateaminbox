import { useEffect, useState } from "react";
import { useWebSocketContext } from "../../contexts/WebSocketProvider";

const SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function SyncingOverlay() {
  const { syncingConnections, clearSyncingConnections } = useWebSocketContext();
  const [timedOut, setTimedOut] = useState(false);

  // Calculate total conversations across all syncing connections
  const totalConversations = Array.from(syncingConnections.values()).reduce(
    (sum, s) => sum + s.conversations,
    0,
  );

  // Check for timeout
  useEffect(() => {
    if (syncingConnections.size === 0) {
      setTimedOut(false);
      return;
    }

    // Find oldest sync
    let oldestSync: { startedAt: Date } | undefined;
    for (const sync of syncingConnections.values()) {
      if (!oldestSync || sync.startedAt < oldestSync.startedAt) {
        oldestSync = sync;
      }
    }

    if (!oldestSync) return;

    const elapsed = Date.now() - oldestSync.startedAt.getTime();
    if (elapsed >= SYNC_TIMEOUT_MS) {
      setTimedOut(true);
      return;
    }

    const timer = setTimeout(
      () => setTimedOut(true),
      SYNC_TIMEOUT_MS - elapsed,
    );
    return () => clearTimeout(timer);
  }, [syncingConnections]);

  if (syncingConnections.size === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-dark-primary">
      <div className="text-center">
        {/* Loading spinner */}
        <div className="mb-4 flex justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-whatsapp-green dark:border-gray-700 dark:border-t-whatsapp-green" />
        </div>

        <h2 className="text-xl font-medium text-gray-900 dark:text-dark-text-primary mb-2">
          Syncing messages...
        </h2>

        <p className="text-gray-600 dark:text-dark-text-secondary">
          {totalConversations > 0
            ? `${totalConversations} conversation${totalConversations !== 1 ? "s" : ""} synced`
            : "Please wait while we sync your conversations"}
        </p>

        {timedOut && (
          <button
            type="button"
            onClick={() => {
              clearSyncingConnections();
              setTimedOut(false);
            }}
            className="mt-6 px-6 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-whatsapp-green/90 transition-colors"
          >
            Continue anyway
          </button>
        )}
      </div>
    </div>
  );
}
