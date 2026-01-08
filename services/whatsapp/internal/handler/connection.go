package handler

import (
	"context"
	"log"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// handlePresence processes presence updates.
func (h *Handler) handlePresence(presence *events.Presence) {
	// Normalize JID to remove device suffix
	fromJID := presence.From.ToNonAD()

	log.Printf("Presence update from %s: unavailable=%v", fromJID.String(), presence.Unavailable)

	presenceEvent := natsClient.PresenceEvent{
		From:        fromJID.String(),
		Unavailable: presence.Unavailable,
		LastSeen:    presence.LastSeen,
		Timestamp:   time.Now(),
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishPresence(presenceEvent); err != nil {
			log.Printf("Failed to publish presence event: %v", err)
		}
	}
}

// handleChatPresence processes typing indicator events.
func (h *Handler) handleChatPresence(presence *events.ChatPresence) {
	// Normalize JIDs to remove device suffix
	senderJID := presence.Sender.ToNonAD()
	chatJID := presence.Chat.ToNonAD()

	// ChatPresence.State is "composing" when typing, "paused" when stopped
	isTyping := presence.State == types.ChatPresenceComposing

	// Determine media type from ChatPresenceMedia
	mediaType := "text"
	if presence.Media == types.ChatPresenceMediaAudio {
		mediaType = "audio"
	}

	log.Printf("Typing indicator from %s in %s: typing=%v, media=%s",
		senderJID.String(), chatJID.String(), isTyping, mediaType)

	typingEvent := natsClient.TypingEvent{
		From:      senderJID.String(),
		ChatJID:   chatJID.String(),
		IsTyping:  isTyping,
		MediaType: mediaType,
		Timestamp: time.Now(),
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishTyping(typingEvent); err != nil {
			log.Printf("Failed to publish typing event: %v", err)
		}
	}
}

// handleConnected is called when connection is established.
func (h *Handler) handleConnected(evt *events.Connected) {
	log.Printf("Worker %s connected to WhatsApp", h.config.WorkerID)

	// Extract phone number and JID from the client
	var phoneNumber, jid string
	if h.config.Client != nil {
		client := h.config.Client.GetClient()
		if client != nil && client.Store != nil && client.Store.ID != nil {
			jid = client.Store.ID.String()
			// ID.User contains just the phone number (e.g., "6594603306")
			phoneNumber = client.Store.ID.User
			log.Printf("Connected with JID: %s, Phone: %s", jid, phoneNumber)
		}
	}

	// Mark ourselves as available so WhatsApp servers send us presence updates
	// This is required for receiving presence information from contacts
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if h.config.Client != nil {
		if err := h.config.Client.SendPresence(ctx, types.PresenceAvailable); err != nil {
			log.Printf("Failed to send presence: %v", err)
		} else {
			log.Printf("Marked presence as available")
		}
	}

	// Publish connection status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("connected", "", phoneNumber, jid); err != nil {
			log.Printf("Failed to publish connected status: %v", err)
		}
	}
}

// handleDisconnected is called when connection is lost.
func (h *Handler) handleDisconnected(evt *events.Disconnected) {
	log.Printf("Worker %s disconnected from WhatsApp", h.config.WorkerID)

	// Publish disconnection status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("disconnected", "connection_lost", "", ""); err != nil {
			log.Printf("Failed to publish disconnected status: %v", err)
		}
	}

	// Attempt reconnection with the handler's context (if available)
	if h.config.Client != nil {
		go h.config.Client.HandleReconnect(h.config.Ctx)
	}
}

// handleLoggedOut is called when session is terminated.
func (h *Handler) handleLoggedOut(evt *events.LoggedOut) {
	reason := "unknown"
	if evt.Reason != 0 {
		reason = evt.Reason.String()
	}
	log.Printf("Worker %s logged out: %s", h.config.WorkerID, reason)

	// Publish logged out status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("logged_out", reason, "", ""); err != nil {
			log.Printf("Failed to publish logged out status: %v", err)
		}
	}
}

// handleQR is called when QR code is available.
// Note: QR codes are published via the callback set in main.go (SetQRCallback).
// This handler only logs the event to avoid duplicate publishing.
func (h *Handler) handleQR(evt *events.QR) {
	log.Printf("QR code event for worker %s: %d codes available", h.config.WorkerID, len(evt.Codes))
}

// handlePairSuccess is called when device pairing succeeds.
func (h *Handler) handlePairSuccess(evt *events.PairSuccess) {
	log.Printf("Worker %s paired successfully with %s", h.config.WorkerID, evt.ID.String())

	// Extract phone number from the paired JID
	jid := evt.ID.String()
	phoneNumber := evt.ID.User

	// Publish pair success status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("paired", "", phoneNumber, jid); err != nil {
			log.Printf("Failed to publish pair success status: %v", err)
		}
	}
}

// handleStreamReplaced is called when the stream is replaced (logged in elsewhere).
func (h *Handler) handleStreamReplaced(evt *events.StreamReplaced) {
	log.Printf("Worker %s: stream replaced (logged in elsewhere)", h.config.WorkerID)

	// Publish stream replaced status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("disconnected", "stream_replaced", "", ""); err != nil {
			log.Printf("Failed to publish stream replaced status: %v", err)
		}
	}
}

// handlePicture processes profile picture updates.
func (h *Handler) handlePicture(evt *events.Picture) {
	// Normalize JID to remove device suffix for consistent contact matching
	normalizedJID := evt.JID.ToNonAD()
	log.Printf("Profile picture update for %s (remove: %v)", normalizedJID.String(), evt.Remove)

	var profilePictureURL string
	if !evt.Remove {
		// Fetch the new profile picture (use original JID for API call)
		profilePictureURL = h.fetchProfilePicture(evt.JID)
		if profilePictureURL == "" {
			log.Printf("Failed to fetch new profile picture for %s", normalizedJID.String())
			return
		}
	}

	// Publish to NATS with normalized JID
	if h.publisher != nil {
		if err := h.publisher.PublishProfilePicture(normalizedJID.String(), profilePictureURL, evt.Remove, evt.Timestamp); err != nil {
			log.Printf("Failed to publish profile picture update: %v", err)
		}
	}
}

// handleOfflineSyncPreview handles the sync starting event.
func (h *Handler) handleOfflineSyncPreview(evt *events.OfflineSyncPreview) {
	log.Printf("Offline sync starting: %d messages, %d notifications expected",
		evt.Messages, evt.Notifications)

	// Publish sync:starting event
	if h.publisher != nil {
		if err := h.publisher.PublishSyncStatus("starting", evt.Messages, 0); err != nil {
			log.Printf("Failed to publish sync start: %v", err)
		}
	}
}

// handleOfflineSyncCompleted handles the sync completion event.
func (h *Handler) handleOfflineSyncCompleted(evt *events.OfflineSyncCompleted) {
	log.Printf("Offline sync completed")

	// Publish sync:completed event
	if h.publisher != nil {
		if err := h.publisher.PublishSyncStatus("completed", 0, 0); err != nil {
			log.Printf("Failed to publish sync complete: %v", err)
		}
	}
}
