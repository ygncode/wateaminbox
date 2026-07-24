package handler

import (
	"log"
	"time"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
)

// isTrackedHistorySyncType identifies the phases that import conversation
// history. Push-name, app-state, and on-demand syncs must not open the global
// initial-sync overlay.
func isTrackedHistorySyncType(syncType waHistorySync.HistorySync_HistorySyncType) bool {
	switch syncType {
	case waHistorySync.HistorySync_INITIAL_BOOTSTRAP,
		waHistorySync.HistorySync_FULL,
		waHistorySync.HistorySync_RECENT:
		return true
	default:
		return false
	}
}

// isFinalHistorySyncChunk reflects the initial history transfer protocol: the
// RECENT phase is last, and progress 100 means all of its chunks arrived.
func isFinalHistorySyncChunk(data *waHistorySync.HistorySync) bool {
	return data != nil &&
		data.GetSyncType() == waHistorySync.HistorySync_RECENT &&
		data.GetProgress() >= 100
}

// beginHistorySyncChunk cancels the idle fallback while a chunk is being
// processed and starts a new lifecycle only when one isn't already active.
func (h *Handler) beginHistorySyncChunk() {
	h.historySyncMu.Lock()
	defer h.historySyncMu.Unlock()

	h.historySyncActivity++
	if h.historySyncTimer != nil {
		h.historySyncTimer.Stop()
		h.historySyncTimer = nil
	}
	if h.historySyncActive {
		return
	}

	h.historySyncActive = true
	h.historySyncMessages = 0
	h.historySyncConversations = 0
	h.publishSyncStatusLocked("starting")
}

func (h *Handler) addHistorySyncProgress(messages, conversations int) (int, int) {
	h.historySyncMu.Lock()
	defer h.historySyncMu.Unlock()

	if !h.historySyncActive {
		return 0, 0
	}
	h.historySyncMessages += messages
	h.historySyncConversations += conversations
	return h.historySyncMessages, h.historySyncConversations
}

func (h *Handler) publishHistorySyncProgress() {
	h.historySyncMu.Lock()
	defer h.historySyncMu.Unlock()
	if h.historySyncActive {
		h.publishSyncStatusLocked("progress")
	}
}

func (h *Handler) finishHistorySyncChunk(final bool) {
	h.historySyncMu.Lock()
	defer h.historySyncMu.Unlock()
	if !h.historySyncActive {
		return
	}

	if final {
		h.completeHistorySyncLocked("final recent chunk")
		return
	}

	// Some WhatsApp protocol variants omit a final RECENT/100 chunk. Complete
	// after an idle period so that such a transfer can never strand the UI.
	h.historySyncActivity++
	activity := h.historySyncActivity
	timeout := h.historySyncIdleTimeout
	if timeout <= 0 {
		timeout = historySyncIdleTimeout
	}
	h.historySyncTimer = time.AfterFunc(timeout, func() {
		h.historySyncMu.Lock()
		defer h.historySyncMu.Unlock()
		if !h.historySyncActive || h.historySyncActivity != activity {
			return
		}
		if h.config.Ctx != nil {
			select {
			case <-h.config.Ctx.Done():
				return
			default:
			}
		}
		h.completeHistorySyncLocked("history sync idle timeout")
	})
}

func (h *Handler) completeHistorySyncLocked(reason string) {
	if h.historySyncTimer != nil {
		h.historySyncTimer.Stop()
		h.historySyncTimer = nil
	}
	h.publishSyncStatusLocked("completed")
	log.Printf(
		"History sync lifecycle completed (%s): %d messages, %d conversations",
		reason,
		h.historySyncMessages,
		h.historySyncConversations,
	)
	h.historySyncActive = false
	h.historySyncActivity++
}

func (h *Handler) publishSyncStatusLocked(status string) {
	if h.syncStatusPublisher == nil {
		return
	}
	if err := h.syncStatusPublisher.PublishSyncStatus(
		status,
		h.historySyncMessages,
		h.historySyncConversations,
	); err != nil {
		log.Printf("Failed to publish history sync %s: %v", status, err)
	}
}
