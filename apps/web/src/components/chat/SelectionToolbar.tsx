import { useCallback, useState } from "react";
import { LoadingSpinner } from "@/components/ui";
import {
  selectSelectedMessageCount,
  selectSelectedMessageIds,
  useChatStore,
} from "../../stores/chat-store";

interface SelectionToolbarProps {
  conversationId: string;
  onForwardSelected?: (messageIds: string[]) => void;
  onDeleteSelected?: (messageIds: string[]) => void;
  onStarSelected?: (messageIds: string[]) => void;
  onDownloadSelected?: (messageIds: string[]) => void;
}

export function SelectionToolbar({
  conversationId,
  onForwardSelected,
  onDeleteSelected,
  onStarSelected,
  onDownloadSelected,
}: SelectionToolbarProps) {
  const selectedMessageIds = useChatStore(selectSelectedMessageIds);
  const selectedCount = useChatStore(selectSelectedMessageCount);
  const exitSelectionMode = useChatStore((state) => state.exitSelectionMode);
  const clearSelection = useChatStore((state) => state.clearSelection);
  const messages = useChatStore(
    (state) => state.messagesCache.get(conversationId) || [],
  );

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check if any selected message has media
  const hasMediaSelected = messages.some(
    (msg) =>
      selectedMessageIds.has(msg.id) &&
      ["image", "video", "audio", "document"].includes(msg.messageType),
  );

  const selectedIds = Array.from(selectedMessageIds);

  const handleStar = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setIsProcessing(true);
    try {
      await onStarSelected?.(selectedIds);
      exitSelectionMode();
    } finally {
      setIsProcessing(false);
    }
  }, [selectedIds, onStarSelected, exitSelectionMode]);

  const handleDelete = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setIsProcessing(true);
    try {
      await onDeleteSelected?.(selectedIds);
      exitSelectionMode();
    } finally {
      setIsProcessing(false);
      setShowDeleteConfirm(false);
    }
  }, [selectedIds, onDeleteSelected, exitSelectionMode]);

  const handleForward = useCallback(() => {
    if (selectedIds.length === 0) return;
    onForwardSelected?.(selectedIds);
    exitSelectionMode();
  }, [selectedIds, onForwardSelected, exitSelectionMode]);

  const handleDownload = useCallback(() => {
    if (selectedIds.length === 0) return;
    onDownloadSelected?.(selectedIds);
    exitSelectionMode();
  }, [selectedIds, onDownloadSelected, exitSelectionMode]);

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="sticky bottom-0 z-30 bg-white dark:bg-dark-elevated border-t border-gray-200 dark:border-dark-border px-4 py-3">
        <div className="flex items-center justify-center gap-6">
          {/* Star button */}
          <button
            type="button"
            onClick={handleStar}
            disabled={isProcessing}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-teal-green dark:hover:text-whatsapp-teal-green transition-colors disabled:opacity-50"
            title="Star selected messages"
          >
            <StarIcon className="h-6 w-6" />
            <span className="text-xs">Star</span>
          </button>

          {/* Delete button */}
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isProcessing}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-red-500 transition-colors disabled:opacity-50"
            title="Delete selected messages"
          >
            <DeleteIcon className="h-6 w-6" />
            <span className="text-xs">Delete</span>
          </button>

          {/* Forward button */}
          <button
            type="button"
            onClick={handleForward}
            disabled={isProcessing}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-teal-green dark:hover:text-whatsapp-teal-green transition-colors disabled:opacity-50"
            title="Forward selected messages"
          >
            <ForwardIcon className="h-6 w-6" />
            <span className="text-xs">Forward</span>
          </button>

          {/* Download button - only shown when media is selected */}
          {hasMediaSelected && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={isProcessing}
              className="flex flex-col items-center gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-teal-green dark:hover:text-whatsapp-teal-green transition-colors disabled:opacity-50"
              title="Download selected media"
            >
              <DownloadIcon className="h-6 w-6" />
              <span className="text-xs">Download</span>
            </button>
          )}

          {/* Clear selection */}
          <button
            type="button"
            onClick={clearSelection}
            disabled={isProcessing}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary transition-colors disabled:opacity-50"
            title="Clear selection"
          >
            <ClearIcon className="h-6 w-6" />
            <span className="text-xs">Clear</span>
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary mb-2">
              Delete {selectedCount} message{selectedCount > 1 ? "s" : ""}?
            </h3>
            <p className="text-sm text-gray-600 dark:text-dark-text-secondary mb-6">
              This action cannot be undone. The messages will be deleted for you
              only.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <LoadingSpinner size="xs" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Icon components
function StarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  );
}

function DeleteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function ForwardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
      />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  );
}

function ClearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

export default SelectionToolbar;
