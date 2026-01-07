// Package handler implements WhatsApp event processing with robust media download handling.
//
// Media Download Retry Mechanism:
//
// All media downloads (images, videos, audio, documents, stickers) use exponential backoff
// retry logic to handle transient network failures. The retry configuration is controlled
// by package-level constants:
//
//   - mediaDownloadMaxRetries (4): Maximum number of total download attempts (initial + retries)
//   - mediaDownloadBaseDelay (1s): Initial backoff, doubling each retry (1s, 2s, 4s)
//   - mediaDownloadAttemptTimeout (30s): Per-attempt timeout to prevent indefinite blocking
//
// Retry Behavior:
//   1. First attempt starts immediately with a 30s timeout
//   2. On failure, waits 1s before second attempt (30s timeout)
//   3. On failure, waits 2s before third attempt (30s timeout)
//   4. On failure, waits 4s before fourth attempt (30s timeout)
//   5. If all attempts fail, returns the last error
//
// Maximum additional delay: ~7 seconds (1s + 2s + 4s backoff)
//
// Context cancellation is checked before each attempt and during backoff delays,
// allowing graceful shutdown when the service is stopping.
//
// Functions using retry logic:
//   - handleMediaMessage: Real-time message media (timeout: 135s)
//   - downloadHistoryMedia: History sync media (timeout: 75s)
package handler

import (
	"context"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/storage"
)

// Number of parallel workers for history sync processing
const historySyncWorkers = 10

// Media download retry configuration constants.
const (
	// mediaDownloadMaxRetries is the maximum number of total attempts (initial + retries)
	// for media downloads. 4 attempts allow for 3 backoff intervals (1s, 2s, 4s).
	mediaDownloadMaxRetries = 4

	// mediaDownloadBaseDelay is the initial delay between retry attempts.
	// Subsequent delays follow exponential backoff: 1s, 2s, 4s.
	mediaDownloadBaseDelay = 1 * time.Second

	// mediaDownloadAttemptTimeout is the timeout for each individual download attempt.
	mediaDownloadAttemptTimeout = 30 * time.Second
)

// downloadWithRetry downloads media with exponential backoff retry logic.
// It attempts to download media up to mediaDownloadMaxRetries times, with each
// attempt having its own mediaDownloadAttemptTimeout. Backoff delays follow
// exponential progression: 1s, 2s, 4s.
//
// The parent context is checked between retries for cancellation.
// Returns the downloaded data on success, or an error after all retries are exhausted.
func (h *Handler) downloadWithRetry(ctx context.Context, downloadable whatsmeow.DownloadableMessage) ([]byte, error) {
	var lastErr error

	for attempt := 0; attempt < mediaDownloadMaxRetries; attempt++ {
		// Check if parent context is cancelled before attempting
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		// Create a per-attempt context with timeout
		attemptCtx, cancel := context.WithTimeout(context.Background(), mediaDownloadAttemptTimeout)

		// Attempt the download
		data, err := h.config.Client.DownloadMedia(attemptCtx, downloadable)
		cancel()

		// Success - return the data immediately
		if err == nil {
			if attempt > 0 {
				log.Printf("Media download succeeded on attempt %d after retries", attempt+1)
			}
			return data, nil
		}

		// Store this attempt's error
		lastErr = err

		// Log the failure
		if attempt < mediaDownloadMaxRetries-1 {
			log.Printf("Media download attempt %d failed: %v (retrying in %v)", attempt+1, err, mediaDownloadBaseDelay*time.Duration(1<<uint(attempt)))
		} else {
			log.Printf("Media download attempt %d failed: %v (no more retries)", attempt+1, err)
		}

		// Exponential backoff before next retry (but not after the last attempt)
		if attempt < mediaDownloadMaxRetries-1 {
			backoffDelay := mediaDownloadBaseDelay * time.Duration(1<<uint(attempt))

			// Wait for backoff duration or context cancellation
			select {
			case <-time.After(backoffDelay):
				// Continue to next attempt
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
	}

	// All retries exhausted
	return nil, lastErr
}

// WhatsAppClient defines the interface for the WhatsApp client.
// This allows for mocking the client in tests.
type WhatsAppClient interface {
	DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error)
	GetClient() *whatsmeow.Client
	HandleReconnect(ctx context.Context)
}

// Config holds handler configuration.
type Config struct {
	WorkerID     string
	CompanyID    string
	ConnectionID string
	NATSUrl      string
	Client       WhatsAppClient
	Publisher    *natsClient.Publisher
	Storage      *storage.Client
	Ctx          context.Context
}

// Handler processes WhatsApp events.
type Handler struct {
	config    Config
	publisher *natsClient.Publisher
}

// New creates a new message handler.
func New(cfg Config) *Handler {
	return &Handler{
		config:    cfg,
		publisher: cfg.Publisher,
	}
}

// HandleEvent processes incoming WhatsApp events.
func (h *Handler) HandleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		h.handleMessage(v)
	case *events.Receipt:
		h.handleReceipt(v)
	case *events.Presence:
		h.handlePresence(v)
	case *events.ChatPresence:
		h.handleChatPresence(v)
	case *events.Connected:
		h.handleConnected(v)
	case *events.Disconnected:
		h.handleDisconnected(v)
	case *events.LoggedOut:
		h.handleLoggedOut(v)
	case *events.QR:
		h.handleQR(v)
	case *events.PairSuccess:
		h.handlePairSuccess(v)
	case *events.HistorySync:
		h.handleHistorySync(v)
	case *events.StreamReplaced:
		h.handleStreamReplaced(v)
	case *events.Picture:
		h.handlePicture(v)
	default:
		// Ignore other events silently
	}
}

// handleMessage processes incoming messages.
func (h *Handler) handleMessage(msg *events.Message) {
	// Normalize JIDs to remove device suffix (e.g., ":3" from "44578136657990:3@s.whatsapp.net")
	senderJID := msg.Info.Sender.ToNonAD()
	chatJID := msg.Info.Chat.ToNonAD()

	log.Printf("Received message from %s", senderJID.String())

	// Extract message content
	msgEvent := natsClient.MessageEvent{
		MessageID:  msg.Info.ID,
		From:       senderJID.String(),
		To:         chatJID.String(),
		IsGroup:    msg.Info.IsGroup,
		SenderName: msg.Info.PushName,
		Timestamp:  msg.Info.Timestamp,
	}

	if msg.Info.IsGroup {
		msgEvent.GroupID = chatJID.String()
	}

	// Handle different message types
	if msg.Message == nil {
		log.Println("Message content is nil")
		return
	}

	// Reaction message - handle separately and return early
	if msg.Message.ReactionMessage != nil {
		h.handleReactionMessage(msg)
		return
	}

	// Protocol message (Revoke, etc.)
	if msg.Message.ProtocolMessage != nil {
		h.handleProtocolMessage(msg)
		return
	}

	// Text message
	if msg.Message.Conversation != nil {
		msgEvent.Type = "text"
		msgEvent.Content = *msg.Message.Conversation
	} else if msg.Message.ExtendedTextMessage != nil {
		msgEvent.Type = "text"
		if msg.Message.ExtendedTextMessage.Text != nil {
			msgEvent.Content = *msg.Message.ExtendedTextMessage.Text
		}
	}

	// Image message
	if msg.Message.ImageMessage != nil {
		msgEvent.Type = "image"
		if msg.Message.ImageMessage.Caption != nil {
			msgEvent.Caption = *msg.Message.ImageMessage.Caption
		}
		if msg.Message.ImageMessage.Mimetype != nil {
			msgEvent.MediaType = *msg.Message.ImageMessage.Mimetype
		}
		// Download and get URL
		h.handleMediaMessage(msg.Message.ImageMessage, &msgEvent)
	}

	// Video message
	if msg.Message.VideoMessage != nil {
		msgEvent.Type = "video"
		if msg.Message.VideoMessage.Caption != nil {
			msgEvent.Caption = *msg.Message.VideoMessage.Caption
		}
		if msg.Message.VideoMessage.Mimetype != nil {
			msgEvent.MediaType = *msg.Message.VideoMessage.Mimetype
		}
		h.handleMediaMessage(msg.Message.VideoMessage, &msgEvent)
	}

	// Audio message
	if msg.Message.AudioMessage != nil {
		msgEvent.Type = "audio"
		if msg.Message.AudioMessage.Mimetype != nil {
			msgEvent.MediaType = *msg.Message.AudioMessage.Mimetype
		}
		h.handleMediaMessage(msg.Message.AudioMessage, &msgEvent)
	}

	// Document message
	if msg.Message.DocumentMessage != nil {
		msgEvent.Type = "document"
		if msg.Message.DocumentMessage.Caption != nil {
			msgEvent.Caption = *msg.Message.DocumentMessage.Caption
		}
		if msg.Message.DocumentMessage.FileName != nil {
			msgEvent.FileName = *msg.Message.DocumentMessage.FileName
		}
		if msg.Message.DocumentMessage.Mimetype != nil {
			msgEvent.MediaType = *msg.Message.DocumentMessage.Mimetype
		}
		h.handleMediaMessage(msg.Message.DocumentMessage, &msgEvent)
	}

	// Sticker message
	if msg.Message.StickerMessage != nil {
		msgEvent.Type = "sticker"
		if msg.Message.StickerMessage.Mimetype != nil {
			msgEvent.MediaType = *msg.Message.StickerMessage.Mimetype
		}
		h.handleMediaMessage(msg.Message.StickerMessage, &msgEvent)
	}

	// Location message
	if msg.Message.LocationMessage != nil {
		msgEvent.Type = "location"
		// Could add lat/long to content
	}

	// Contact message
	if msg.Message.ContactMessage != nil {
		msgEvent.Type = "contact"
		if msg.Message.ContactMessage.DisplayName != nil {
			msgEvent.Content = *msg.Message.ContactMessage.DisplayName
		}
	}

	// If we couldn't determine the message type, skip
	if msgEvent.Type == "" {
		log.Printf("Unknown message type from %s", senderJID.String())
		return
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishMessage(msgEvent); err != nil {
			log.Printf("Failed to publish message event: %v", err)
		}
	}
}

// handleProtocolMessage processes protocol messages (revokes, etc.)
func (h *Handler) handleProtocolMessage(msg *events.Message) {
	protoMsg := msg.Message.ProtocolMessage
	if protoMsg == nil {
		return
	}

	// Check for Revoke type
	if protoMsg.Type != nil && *protoMsg.Type == waE2E.ProtocolMessage_REVOKE {
		revokedID := protoMsg.GetKey().GetID()
		if revokedID == "" {
			return
		}

		// Normalize JIDs to remove device suffix
		senderJID := msg.Info.Sender.ToNonAD()
		chatJID := msg.Info.Chat.ToNonAD()

		log.Printf("Message revoke received from %s for message %s", senderJID.String(), revokedID)

		if h.publisher != nil {
			// Publish the revoke event
			if err := h.publisher.PublishMessageRevoke(revokedID, senderJID.String(), chatJID.String(), msg.Info.Timestamp); err != nil {
				log.Printf("Failed to publish message revoke: %v", err)
			}
		}
	}
}

// handleMediaMessage downloads media and uploads to storage.
// Uses retry logic with exponential backoff for robustness.
// Timeout is extended to 135s to accommodate retry delays (1s + 2s + 4s backoff).
func (h *Handler) handleMediaMessage(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) {
	if h.config.Client == nil {
		log.Println("Client not available for media download")
		return
	}

	// Create a context with timeout for media download and upload.
	// Extended from 120s to 135s to accommodate retry delays (up to ~7s total backoff).
	ctx, cancel := context.WithTimeout(context.Background(), 135*time.Second)
	defer cancel()

	// Download the media with retry logic (exponential backoff)
	data, err := h.downloadWithRetry(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download media after retry exhaustion: %v", err)
		return
	}

	log.Printf("Downloaded media: %d bytes, type: %s", len(data), event.MediaType)

	// Upload to storage if configured
	if h.config.Storage != nil {
		// Use filename if available (for documents)
		var mediaURL string
		if event.FileName != "" {
			mediaURL, err = h.config.Storage.UploadMediaWithFilename(ctx, data, event.MediaType, h.config.CompanyID, event.FileName)
		} else {
			mediaURL, err = h.config.Storage.UploadMedia(ctx, data, event.MediaType, h.config.CompanyID)
		}

		if err != nil {
			log.Printf("Failed to upload media to storage: %v", err)
			return
		}

		event.MediaURL = mediaURL
		event.MediaSize = int64(len(data))
		log.Printf("Media uploaded successfully: %s", mediaURL)
	} else {
		log.Println("Storage not configured, media not persisted")
	}
}

// handleReceipt processes message receipts.
func (h *Handler) handleReceipt(receipt *events.Receipt) {
	// Normalize JID to remove device suffix
	senderJID := receipt.Sender.ToNonAD()

	log.Printf("Received receipt: %s from %s", receipt.Type, senderJID.String())

	// Convert message IDs
	messageIDs := make([]string, len(receipt.MessageIDs))
	for i, id := range receipt.MessageIDs {
		messageIDs[i] = id
	}

	// Map receipt type
	receiptType := string(receipt.Type)

	receiptEvent := natsClient.ReceiptEvent{
		MessageIDs:  messageIDs,
		ReceiptType: receiptType,
		From:        senderJID.String(),
		Timestamp:   receipt.Timestamp,
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishReceipt(receiptEvent); err != nil {
			log.Printf("Failed to publish receipt event: %v", err)
		}
	}
}

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
func (h *Handler) handleQR(evt *events.QR) {
	log.Printf("QR code event for worker %s: %d codes available", h.config.WorkerID, len(evt.Codes))

	// Publish each QR code to NATS
	if h.publisher != nil {
		for _, qrCode := range evt.Codes {
			if err := h.publisher.PublishQRCode(qrCode); err != nil {
				log.Printf("Failed to publish QR code: %v", err)
			}
		}
	}
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

// historySyncConversation represents a conversation to process during history sync.
type historySyncConversation struct {
	conv      interface{} // *waHistorySync.Conversation
	jid       string
	isGroup   bool
	name      string
	displayName string
	unreadCount int
}

// handleHistorySync is called when history sync is received.
// Optimized for performance with:
// - Parallel conversation processing using worker pool
// - Deferred media downloads (stores references instead of downloading)
// - Skipped profile picture fetching (fetched on-demand later)
func (h *Handler) handleHistorySync(evt *events.HistorySync) {
	conversations := evt.Data.GetConversations()
	log.Printf("History sync received: %d conversations (optimized mode - media deferred)", len(conversations))

	startTime := time.Now()

	// Use channels for worker pool pattern
	type conversationResult struct {
		messages     int
		mediaDeferred int
	}

	jobs := make(chan int, len(conversations))
	results := make(chan conversationResult, len(conversations))

	// Start worker pool
	var wg sync.WaitGroup
	for w := 0; w < historySyncWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				conv := conversations[idx]
				result := h.processHistorySyncConversation(conv)
				results <- result
			}
		}()
	}

	// Send jobs to workers
	for i := range conversations {
		jobs <- i
	}
	close(jobs)

	// Wait for workers to finish in background goroutine
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	var totalMessages, totalMediaDeferred int
	for result := range results {
		totalMessages += result.messages
		totalMediaDeferred += result.mediaDeferred
	}

	elapsed := time.Since(startTime)
	log.Printf("History sync complete: %d messages, %d media deferred for on-demand download (took %v)",
		totalMessages, totalMediaDeferred, elapsed.Round(time.Millisecond))
}

// processHistorySyncConversation processes a single conversation during history sync.
// Returns the count of messages processed and media items deferred.
func (h *Handler) processHistorySyncConversation(conv interface{}) (result struct{ messages, mediaDeferred int }) {
	// Type assert to get conversation methods
	type conversationGetter interface {
		GetID() string
		GetIsDefaultSubgroup() bool
		GetParticipant() []interface{}
		GetDisplayName() string
		GetName() string
		GetUnreadCount() uint32
		GetMessages() []interface{}
	}

	c, ok := conv.(conversationGetter)
	if !ok {
		// Fallback: use reflection or direct type assertion
		return h.processHistorySyncConversationDirect(conv)
	}

	rawJID := c.GetID()
	if rawJID == "" {
		return
	}

	// Parse and normalize JID to remove any device suffix
	parsedJID, err := types.ParseJID(rawJID)
	if err != nil {
		log.Printf("Failed to parse JID %s: %v", rawJID, err)
		return
	}
	normalizedJID := parsedJID.ToNonAD()
	jid := normalizedJID.String()

	// Determine if this is a group chat
	isGroup := c.GetIsDefaultSubgroup() || len(c.GetParticipant()) > 0

	// Get display name from conversation
	displayName := c.GetDisplayName()
	name := c.GetName()

	// Get unread count
	unreadCount := int(c.GetUnreadCount())

	// OPTIMIZATION: Skip profile picture fetching during history sync
	// Profile pictures will be fetched on-demand when viewing contacts
	var profilePicURL string // Empty - will be fetched later

	// Publish contact to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishContact(jid, name, displayName, isGroup, unreadCount, profilePicURL); err != nil {
			log.Printf("Failed to publish contact %s: %v", jid, err)
		}
	}

	// Process messages
	messages := c.GetMessages()
	for _, historyMsg := range messages {
		processed, hasMedia := h.processHistorySyncMessage(historyMsg, jid, isGroup)
		if processed {
			result.messages++
			if hasMedia {
				result.mediaDeferred++
			}
		}
	}

	return
}

// processHistorySyncConversationDirect processes a conversation using direct type assertion.
func (h *Handler) processHistorySyncConversationDirect(conv interface{}) (result struct{ messages, mediaDeferred int }) {
	// Use waHistorySync types directly
	type waConversation interface {
		GetID() string
		GetDisplayName() string
		GetName() string
		GetUnreadCount() uint32
		GetMessages() []*waHistorySync.HistorySyncMsg
	}

	// Try to use the actual proto type methods
	if c, ok := conv.(interface{ GetID() string }); ok {
		rawJID := c.GetID()
		if rawJID == "" {
			return
		}

		parsedJID, err := types.ParseJID(rawJID)
		if err != nil {
			return
		}
		normalizedJID := parsedJID.ToNonAD()
		jid := normalizedJID.String()

		// Check for group (simplified)
		isGroup := false
		if g, ok := conv.(interface{ GetIsDefaultSubgroup() bool }); ok {
			isGroup = g.GetIsDefaultSubgroup()
		}

		// Get names
		var displayName, name string
		if d, ok := conv.(interface{ GetDisplayName() string }); ok {
			displayName = d.GetDisplayName()
		}
		if n, ok := conv.(interface{ GetName() string }); ok {
			name = n.GetName()
		}

		// Get unread count
		var unreadCount int
		if u, ok := conv.(interface{ GetUnreadCount() uint32 }); ok {
			unreadCount = int(u.GetUnreadCount())
		}

		// Publish contact (no profile picture - deferred)
		if h.publisher != nil {
			h.publisher.PublishContact(jid, name, displayName, isGroup, unreadCount, "")
		}

		// Process messages
		if m, ok := conv.(interface{ GetMessages() []*waHistorySync.HistorySyncMsg }); ok {
			for _, historyMsg := range m.GetMessages() {
				processed, hasMedia := h.processHistorySyncMessage(historyMsg, jid, isGroup)
				if processed {
					result.messages++
					if hasMedia {
						result.mediaDeferred++
					}
				}
			}
		}
	}

	return
}

// processHistorySyncMessage processes a single message from history sync.
// Returns (processed, hasMedia) - whether the message was processed and if it had media.
func (h *Handler) processHistorySyncMessage(historyMsg interface{}, jid string, isGroup bool) (bool, bool) {
	// Type assert to get message
	type messageGetter interface {
		GetMessage() *waWeb.WebMessageInfo
	}

	hm, ok := historyMsg.(messageGetter)
	if !ok {
		return false, false
	}

	msg := hm.GetMessage()
	if msg == nil || msg.Message == nil {
		return false, false
	}

	// Build message event with history sync flag
	msgEvent := natsClient.MessageEvent{
		MessageID:     msg.GetKey().GetID(),
		From:          jid,
		To:            jid,
		FromMe:        msg.GetKey().GetFromMe(),
		IsGroup:       isGroup,
		Timestamp:     time.Unix(int64(msg.GetMessageTimestamp()), 0),
		IsHistorySync: true, // Mark as history sync for deferred media
	}

	// Get push name
	msgEvent.SenderName = msg.GetPushName()

	// Extract content based on message type
	waMsg := msg.GetMessage()
	if waMsg == nil {
		return false, false
	}

	hasMedia := false

	// Text message
	if waMsg.Conversation != nil {
		msgEvent.Type = "text"
		msgEvent.Content = *waMsg.Conversation
	} else if waMsg.ExtendedTextMessage != nil {
		msgEvent.Type = "text"
		if waMsg.ExtendedTextMessage.Text != nil {
			msgEvent.Content = *waMsg.ExtendedTextMessage.Text
		}
	}

	// Image message - extract reference, don't download
	if waMsg.ImageMessage != nil {
		msgEvent.Type = "image"
		if waMsg.ImageMessage.Caption != nil {
			msgEvent.Caption = *waMsg.ImageMessage.Caption
		}
		if waMsg.ImageMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.ImageMessage.Mimetype
		}
		extractMediaReference(waMsg.ImageMessage, &msgEvent)
		hasMedia = true
	}

	// Video message - extract reference, don't download
	if waMsg.VideoMessage != nil {
		msgEvent.Type = "video"
		if waMsg.VideoMessage.Caption != nil {
			msgEvent.Caption = *waMsg.VideoMessage.Caption
		}
		if waMsg.VideoMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.VideoMessage.Mimetype
		}
		extractMediaReference(waMsg.VideoMessage, &msgEvent)
		hasMedia = true
	}

	// Audio message - extract reference, don't download
	if waMsg.AudioMessage != nil {
		msgEvent.Type = "audio"
		if waMsg.AudioMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.AudioMessage.Mimetype
		}
		extractMediaReference(waMsg.AudioMessage, &msgEvent)
		hasMedia = true
	}

	// Document message - extract reference, don't download
	if waMsg.DocumentMessage != nil {
		msgEvent.Type = "document"
		if waMsg.DocumentMessage.Caption != nil {
			msgEvent.Caption = *waMsg.DocumentMessage.Caption
		}
		if waMsg.DocumentMessage.FileName != nil {
			msgEvent.FileName = *waMsg.DocumentMessage.FileName
		}
		if waMsg.DocumentMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.DocumentMessage.Mimetype
		}
		extractMediaReference(waMsg.DocumentMessage, &msgEvent)
		hasMedia = true
	}

	// Sticker message - extract reference, don't download
	if waMsg.StickerMessage != nil {
		msgEvent.Type = "sticker"
		if waMsg.StickerMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.StickerMessage.Mimetype
		}
		extractMediaReference(waMsg.StickerMessage, &msgEvent)
		hasMedia = true
	}

	// Skip if we couldn't determine message type
	if msgEvent.Type == "" {
		return false, false
	}

	// Publish message to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishMessage(msgEvent); err != nil {
			log.Printf("Failed to publish history message: %v", err)
			return false, false
		}
	}

	return true, hasMedia
}

// extractMediaReference extracts media download reference info for deferred processing.
// Does NOT download the media - stores reference for on-demand download later.
// This is used for history sync messages to speed up initial sync.
func extractMediaReference(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) {
	event.MediaDirectPath = downloadable.GetDirectPath()
	event.MediaKey = downloadable.GetMediaKey()
	event.MediaFileSHA256 = downloadable.GetFileSHA256()
	event.MediaFileEncSHA256 = downloadable.GetFileEncSHA256()
}

// downloadHistoryMedia downloads media from history sync with rate limiting.
// Uses retry logic with exponential backoff for robustness.
// Timeout is extended to 75s to accommodate retry delays (1s + 2s + 4s backoff).
// Returns true if download was successful, false otherwise.
func (h *Handler) downloadHistoryMedia(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) bool {
	if h.config.Client == nil {
		log.Println("Client not available for history media download")
		return false
	}

	if h.config.Storage == nil {
		log.Println("Storage not configured, skipping history media download")
		return false
	}

	// Create a context with timeout for media download and upload.
	// Extended from 60s to 75s to accommodate retry delays (up to ~7s total backoff).
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()

	// Download the media with retry logic (exponential backoff)
	data, err := h.downloadWithRetry(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download history media after retry exhaustion: %v", err)
		return false
	}

	log.Printf("Downloaded history media: %d bytes, type: %s", len(data), event.MediaType)

	// Upload to storage
	var mediaURL string
	if event.FileName != "" {
		mediaURL, err = h.config.Storage.UploadMediaWithFilename(ctx, data, event.MediaType, h.config.CompanyID, event.FileName)
	} else {
		mediaURL, err = h.config.Storage.UploadMedia(ctx, data, event.MediaType, h.config.CompanyID)
	}

	if err != nil {
		log.Printf("Failed to upload history media to storage: %v", err)
		return false
	}

	event.MediaURL = mediaURL
	event.MediaSize = int64(len(data))
	log.Printf("History media uploaded: %s", mediaURL)

	// Rate limiting: small delay between media downloads to avoid overwhelming
	time.Sleep(100 * time.Millisecond)

	return true
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

// fetchProfilePicture downloads and uploads a contact's profile picture.
// Returns the public URL if successful, empty string otherwise.
func (h *Handler) fetchProfilePicture(jid types.JID) string {
	if h.config.Client == nil {
		log.Println("Client not available for profile picture fetch")
		return ""
	}

	if h.config.Storage == nil {
		log.Println("Storage not configured, skipping profile picture fetch")
		return ""
	}

	// Get profile picture info from WhatsApp
	client := h.config.Client.GetClient()
	if client == nil {
		log.Println("WhatsApp client not available for profile picture fetch")
		return ""
	}

	// Get the profile picture (preview size is sufficient for contacts)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	picInfo, err := client.GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{
		Preview: true,
	})
	if err != nil {
		log.Printf("Failed to get profile picture info for %s: %v", jid.String(), err)
		return ""
	}

	if picInfo == nil || picInfo.URL == "" {
		// No profile picture set
		return ""
	}

	// Download the profile picture from the URL
	req, err := http.NewRequestWithContext(ctx, "GET", picInfo.URL, nil)
	if err != nil {
		log.Printf("Failed to create request for profile picture: %v", err)
		return ""
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Failed to download profile picture for %s: %v", jid.String(), err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Failed to download profile picture for %s: status %d", jid.String(), resp.StatusCode)
		return ""
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Failed to read profile picture data for %s: %v", jid.String(), err)
		return ""
	}

	log.Printf("Downloaded profile picture for %s: %d bytes", jid.String(), len(data))

	// Upload to storage
	mediaURL, err := h.config.Storage.UploadMedia(ctx, data, "image/jpeg", h.config.CompanyID)
	if err != nil {
		log.Printf("Failed to upload profile picture to storage: %v", err)
		return ""
	}

	log.Printf("Profile picture uploaded for %s: %s", jid.String(), mediaURL)
	return mediaURL
}

// handleReactionMessage processes incoming reaction messages.
// Reactions come as Message events with a ReactionMessage field.
func (h *Handler) handleReactionMessage(msg *events.Message) {
	reactionMsg := msg.Message.ReactionMessage
	if reactionMsg == nil || reactionMsg.Key == nil {
		log.Println("Invalid reaction message: missing key")
		return
	}

	// Normalize JIDs to remove device suffix
	senderJID := msg.Info.Sender.ToNonAD()
	chatJID := msg.Info.Chat.ToNonAD()

	// Get the target message ID
	targetMsgID := reactionMsg.Key.GetID()
	emoji := reactionMsg.GetText()

	log.Printf("Received reaction from %s: %s on message %s",
		senderJID.String(), emoji, targetMsgID)

	// Publish reaction to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishReaction(
			targetMsgID,
			senderJID.String(),
			chatJID.String(),
			emoji,
			msg.Info.Timestamp,
		); err != nil {
			log.Printf("Failed to publish reaction event: %v", err)
		}
	}
}
