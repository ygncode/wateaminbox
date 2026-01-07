import React, { useEffect, useState } from "react";
import { useWebSocketContext } from "../../contexts/WebSocketProvider";

export const SyncingOverlay = React.memo(function SyncingOverlay() {
  const { syncingConnections } = useWebSocketContext();
  const [isVisible, setIsVisible] = useState(false);

  // Calculate total conversations across all syncing connections
  const totalConversations = Array.from(syncingConnections.values()).reduce(
    (sum, s) => sum + s.conversations,
    0,
  );

  // Handle fade-in transition
  useEffect(() => {
    if (syncingConnections.size > 0) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [syncingConnections.size]);

  if (syncingConnections.size === 0) return null;

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
                strokeDasharray="100 176"
                strokeLinecap="round"
                className="text-whatsapp-green animate-[spin_1.5s_linear_infinite]"
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

        <p className="text-sm text-gray-500 dark:text-dark-text-tertiary mt-2">
          Do not close this window
        </p>
      </div>
    </div>
  );
});
