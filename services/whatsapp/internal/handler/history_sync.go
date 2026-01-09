package handler

import (
	"context"
	"log"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// handleHistorySync is called when history sync is received.
// Features:
// - Parallel conversation processing using worker pool
// - Immediate media downloads with retry logic
// - Profile picture fetching for each contact
func (h *Handler) handleHistorySync(evt *events.HistorySync) {
	conversations := evt.Data.GetConversations()
	log.Printf("History sync received: %d conversations", len(conversations))

	// Publish initial progress to trigger sync overlay (in case OfflineSyncPreview didn't fire)
	if h.publisher != nil && len(conversations) > 0 {
		if err := h.publisher.PublishSyncStatus("progress", 0, 0); err != nil {
			log.Printf("Failed to publish initial sync progress: %v", err)
		}
	}

	startTime := time.Now()

	// Use channels for worker pool pattern
	type conversationResult struct {
		messages        int
		mediaDownloaded int
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

	// Collect results and publish progress
	var totalMessages, totalMediaDownloaded, conversationsProcessed int
	for result := range results {
		totalMessages += result.messages
		totalMediaDownloaded += result.mediaDownloaded
		conversationsProcessed++

		// Publish progress every 10 conversations to avoid flooding
		if conversationsProcessed%10 == 0 {
			if h.publisher != nil {
				if err := h.publisher.PublishSyncStatus("progress", totalMessages, conversationsProcessed); err != nil {
					log.Printf("Failed to publish sync progress: %v", err)
				}
			}
		}
	}

	// Publish final progress if not on 10-conversation boundary
	if conversationsProcessed%10 != 0 && h.publisher != nil {
		if err := h.publisher.PublishSyncStatus("progress", totalMessages, conversationsProcessed); err != nil {
			log.Printf("Failed to publish final sync progress: %v", err)
		}
	}

	elapsed := time.Since(startTime)
	log.Printf("History sync complete: %d messages, %d media downloaded (took %v)",
		totalMessages, totalMediaDownloaded, elapsed.Round(time.Millisecond))
}

// processHistorySyncConversation processes a single conversation during history sync.
// Returns the count of messages processed and media items downloaded.
func (h *Handler) processHistorySyncConversation(conv interface{}) (result struct{ messages, mediaDownloaded int }) {
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

	// Fetch profile picture during history sync
	var profilePicURL string
	if h.config.Client != nil && h.config.Storage != nil {
		profilePicURL = h.fetchProfilePicture(normalizedJID)
	}

	// Publish contact to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishContact(jid, name, displayName, isGroup, unreadCount, profilePicURL); err != nil {
			log.Printf("Failed to publish contact %s: %v", jid, err)
		}
	}

	// Subscribe to presence updates for this contact (skip groups)
	// This allows us to receive online/offline status updates
	if !isGroup && h.config.Client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := h.config.Client.SubscribePresence(ctx, normalizedJID); err != nil {
			// Log but don't fail - presence subscription is not critical
			log.Printf("Failed to subscribe to presence for %s: %v", jid, err)
		}
	}

	// Process messages
	messages := c.GetMessages()
	for _, historyMsg := range messages {
		processed, hasMedia := h.processHistorySyncMessage(historyMsg, jid, isGroup)
		if processed {
			result.messages++
			if hasMedia {
				result.mediaDownloaded++
			}
		}
	}

	return
}

// processHistorySyncConversationDirect processes a conversation using direct type assertion.
func (h *Handler) processHistorySyncConversationDirect(conv interface{}) (result struct{ messages, mediaDownloaded int }) {
	// Try to use the actual proto type methods
	c, ok := conv.(interface{ GetID() string })
	if !ok {
		return
	}

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

	// Fetch profile picture during history sync
	var profilePicURL string
	if h.config.Client != nil && h.config.Storage != nil {
		profilePicURL = h.fetchProfilePicture(normalizedJID)
	}

	// Publish contact to NATS
	if h.publisher != nil {
		h.publisher.PublishContact(jid, name, displayName, isGroup, unreadCount, profilePicURL)
	}

	// Subscribe to presence updates for this contact (skip groups)
	// This allows us to receive online/offline status updates
	if !isGroup && h.config.Client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := h.config.Client.SubscribePresence(ctx, normalizedJID); err != nil {
			// Log but don't fail - presence subscription is not critical
			log.Printf("Failed to subscribe to presence for %s: %v", jid, err)
		}
	}

	// Process messages
	if m, ok := conv.(interface{ GetMessages() []*waHistorySync.HistorySyncMsg }); ok {
		for _, historyMsg := range m.GetMessages() {
			processed, hasMedia := h.processHistorySyncMessage(historyMsg, jid, isGroup)
			if processed {
				result.messages++
				if hasMedia {
					result.mediaDownloaded++
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
		IsHistorySync: true, // Mark as history sync message
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

	// Image message - download immediately
	if waMsg.ImageMessage != nil {
		msgEvent.Type = "image"
		if waMsg.ImageMessage.Caption != nil {
			msgEvent.Caption = *waMsg.ImageMessage.Caption
		}
		if waMsg.ImageMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.ImageMessage.Mimetype
		}
		if h.downloadHistoryMedia(waMsg.ImageMessage, &msgEvent) {
			hasMedia = true
		}
	}

	// Video message - download immediately
	if waMsg.VideoMessage != nil {
		msgEvent.Type = "video"
		if waMsg.VideoMessage.Caption != nil {
			msgEvent.Caption = *waMsg.VideoMessage.Caption
		}
		if waMsg.VideoMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.VideoMessage.Mimetype
		}
		if h.downloadHistoryMedia(waMsg.VideoMessage, &msgEvent) {
			hasMedia = true
		}
	}

	// Audio message - download immediately
	if waMsg.AudioMessage != nil {
		msgEvent.Type = "audio"
		if waMsg.AudioMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.AudioMessage.Mimetype
		}
		if h.downloadHistoryMedia(waMsg.AudioMessage, &msgEvent) {
			hasMedia = true
		}
	}

	// Document message - download immediately
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
		if h.downloadHistoryMedia(waMsg.DocumentMessage, &msgEvent) {
			hasMedia = true
		}
	}

	// Sticker message - download immediately
	if waMsg.StickerMessage != nil {
		msgEvent.Type = "sticker"
		if waMsg.StickerMessage.Mimetype != nil {
			msgEvent.MediaType = *waMsg.StickerMessage.Mimetype
		}
		if h.downloadHistoryMedia(waMsg.StickerMessage, &msgEvent) {
			hasMedia = true
		}
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

	// Extract and publish reactions from history sync
	// Reactions in history come as ReactionMessage within the message structure
	if waMsg.ReactionMessage != nil && waMsg.ReactionMessage.Key != nil {
		h.processHistorySyncReaction(waMsg.ReactionMessage, msg, jid)
	}

	return true, hasMedia
}

// processHistorySyncReaction processes a reaction found during history sync
func (h *Handler) processHistorySyncReaction(reactionMsg *waE2E.ReactionMessage, msg *waWeb.WebMessageInfo, chatJID string) {
	if reactionMsg == nil || reactionMsg.Key == nil {
		return
	}

	targetMsgID := reactionMsg.Key.GetID()
	if targetMsgID == "" {
		return
	}

	emoji := reactionMsg.GetText()

	// Parse and normalize sender JID from the message key
	var senderJID string
	if msg.GetKey().GetParticipant() != "" {
		// Group message - use participant field
		if parsedJID, err := types.ParseJID(msg.GetKey().GetParticipant()); err == nil {
			senderJID = parsedJID.ToNonAD().String()
		}
	} else if msg.GetKey().GetFromMe() {
		// Message from current user - use own JID
		// For fromMe messages, the sender is the account owner
		// We'll use the chat JID format but this will be handled by the API
		senderJID = chatJID
	} else if msg.GetKey().GetRemoteJID() != "" {
		// Direct message - use remote JID
		if parsedJID, err := types.ParseJID(msg.GetKey().GetRemoteJID()); err == nil {
			senderJID = parsedJID.ToNonAD().String()
		}
	}

	if senderJID == "" {
		log.Printf("Could not determine sender JID for reaction on message %s", targetMsgID)
		return
	}

	// Get timestamp from the message
	timestamp := time.Unix(int64(msg.GetMessageTimestamp()), 0)

	log.Printf("Processing history sync reaction from %s: %s on message %s",
		senderJID, emoji, targetMsgID)

	// Publish reaction to NATS using existing publisher
	if h.publisher != nil {
		if err := h.publisher.PublishReaction(
			targetMsgID,
			senderJID,
			chatJID,
			emoji,
			timestamp,
		); err != nil {
			log.Printf("Failed to publish history reaction: %v", err)
		}
	}
}
