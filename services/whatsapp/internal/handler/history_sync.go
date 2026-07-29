package handler

import (
	"context"
	"log"
	"strings"
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
	// Persist PN↔LID mappings before conversations are processed in parallel.
	// Group participants and reactions frequently use LIDs in the same first-sync
	// chunk, so waiting for whatsmeow's asynchronous persistence leaks opaque IDs.
	h.storeHistoryLIDMappings(evt.Data.GetPhoneNumberToLidMappings())

	pushNames := evt.Data.GetPushnames()
	if len(pushNames) > 0 {
		log.Printf("Push-name history sync received: %d contacts", len(pushNames))
		for _, entry := range pushNames {
			jid, err := types.ParseJID(entry.GetID())
			if err != nil || jid.IsEmpty() {
				continue
			}
			h.publishContactInfo(jid, types.EmptyJID, types.ContactInfo{PushName: entry.GetPushname()})
		}
		// whatsmeow persists this history chunk asynchronously. Re-read the
		// durable store shortly afterwards to merge LID aliases and saved names.
		go func() {
			time.Sleep(2 * time.Second)
			h.syncKnownContactNames()
		}()
	}

	conversations := evt.Data.GetConversations()
	trackedSync := isTrackedHistorySyncType(evt.Data.GetSyncType())
	log.Printf(
		"History sync received: type=%s chunk=%d progress=%d conversations=%d",
		evt.Data.GetSyncType(),
		evt.Data.GetChunkOrder(),
		evt.Data.GetProgress(),
		len(conversations),
	)
	if trackedSync {
		h.beginHistorySyncChunk()
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
		if trackedSync {
			h.addHistorySyncProgress(result.messages, 1)
		}

		// Publish cumulative progress every 10 conversations to avoid flooding.
		if trackedSync && conversationsProcessed%10 == 0 {
			h.publishHistorySyncProgress()
		}
	}

	// Ensure every chunk has a final cumulative progress event, including empty
	// chunks. Completion is published after it, preserving JetStream ordering.
	if trackedSync && (conversationsProcessed%10 != 0 || conversationsProcessed == 0) {
		h.publishHistorySyncProgress()
	}
	if trackedSync {
		h.finishHistorySyncChunk(isFinalHistorySyncChunk(evt.Data))
	}

	elapsed := time.Since(startTime)
	log.Printf("History sync complete: %d messages, %d media downloaded (took %v)",
		totalMessages, totalMediaDownloaded, elapsed.Round(time.Millisecond))
}

func (h *Handler) storeHistoryLIDMappings(mappings []*waHistorySync.PhoneNumberToLIDMapping) {
	if len(mappings) == 0 || h.config.Client == nil {
		return
	}
	client := h.config.Client.GetClient()
	if client == nil || client.Store == nil || client.Store.LIDs == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	stored := 0
	for _, mapping := range mappings {
		if mapping == nil {
			continue
		}
		pnJID, pnErr := types.ParseJID(mapping.GetPnJID())
		lidJID, lidErr := types.ParseJID(mapping.GetLidJID())
		if pnErr != nil || lidErr != nil || pnJID.IsEmpty() || lidJID.IsEmpty() {
			continue
		}
		if err := client.Store.LIDs.PutLIDMapping(
			ctx,
			lidJID.ToNonAD(),
			pnJID.ToNonAD(),
		); err != nil {
			log.Printf("Failed to persist history LID mapping %s -> %s: %v", lidJID.String(), pnJID.String(), err)
			continue
		}
		stored++
	}
	if stored > 0 {
		log.Printf("Persisted %d PN/LID mappings before history processing", stored)
	}
}

func (h *Handler) getHistoryGroupParticipants(conv *waHistorySync.Conversation) []natsClient.GroupParticipantPayload {
	participants := make([]natsClient.GroupParticipantPayload, 0, len(conv.GetParticipant()))
	for _, participant := range conv.GetParticipant() {
		if participant == nil || participant.GetUserJID() == "" {
			continue
		}
		participantJID, err := types.ParseJID(participant.GetUserJID())
		if err != nil || participantJID.User == "" || participantJID.Server == "" {
			log.Printf("Skipping invalid participant JID %s: %v", participant.GetUserJID(), err)
			continue
		}
		preferredJID := h.resolvePreferredJID(participantJID.ToNonAD(), types.EmptyJID)
		participants = append(participants, natsClient.GroupParticipantPayload{
			JID:     preferredJID.String(),
			IsAdmin: participant.GetRank() != waHistorySync.GroupParticipant_REGULAR,
		})
	}
	return participants
}

// processHistorySyncConversation processes a single conversation during history sync.
// Returns the count of messages processed and media items downloaded.
// Uses concrete proto type *waHistorySync.Conversation for reliable type handling.
func (h *Handler) processHistorySyncConversation(conv *waHistorySync.Conversation) (result struct{ messages, mediaDownloaded int }) {
	if conv == nil {
		return
	}

	// Prefer pnJID (phone number JID) over ID (which can be LID).
	// whatsmeow expects phone number JIDs for sending messages and looks up LID mappings internally.
	// Sending directly to LID JIDs causes encryption failures (error 479).
	rawJID := conv.GetPnJID()
	lidJID := conv.GetLidJID()

	// Fall back to ID if pnJID is not available (e.g., for groups or older sync data)
	if rawJID == "" {
		rawJID = conv.GetID()
	}

	if rawJID == "" {
		return
	}

	// Parse and normalize JID to remove any device suffix
	parsedJID, err := types.ParseJID(rawJID)
	if err != nil {
		log.Printf("Failed to parse JID %s: %v", rawJID, err)
		return
	}

	// Skip LID-only contacts - they can't be used for sending messages.
	// LID JIDs have Server == "lid" (types.HiddenUserServer).
	// This happens when pnJID is empty and ID is a LID.
	if parsedJID.Server == types.HiddenUserServer {
		log.Printf("Skipping LID-only contact %s (no phone number available)", rawJID)
		return
	}

	normalizedJID := parsedJID.ToNonAD()
	jid := normalizedJID.String()

	// Store LID mapping if both pnJID and lidJID are available.
	// This allows whatsmeow to look up the LID for encryption when sending to the phone number JID.
	if lidJID != "" && h.config.Client != nil {
		parsedLID, err := types.ParseJID(lidJID)
		if err == nil {
			client := h.config.Client.GetClient()
			if client != nil && client.Store != nil && client.Store.LIDs != nil {
				ctx := context.Background()
				normalizedLID := parsedLID.ToNonAD()
				if err := client.Store.LIDs.PutLIDMapping(ctx, normalizedLID, normalizedJID); err != nil {
					log.Printf("Failed to store LID mapping %s -> %s: %v", normalizedLID.String(), jid, err)
				}
			}
		}
	}

	// Determine if this is a group chat using multiple indicators:
	// 1. JID suffix (@g.us for groups, @s.whatsapp.net for users) - most reliable
	// 2. IsDefaultSubgroup flag (for community subgroups)
	// 3. Participant list presence (groups have participants)
	isGroup := strings.HasSuffix(jid, "@g.us") ||
		conv.GetIsDefaultSubgroup() ||
		len(conv.GetParticipant()) > 0

	// Get display name from conversation. WhatsApp sometimes returns a privacy
	// placeholder such as "+65∙∙∙∙∙∙06"; it is not a contact name.
	displayName := conv.GetDisplayName()
	name := conv.GetName()
	if !isGroup && isRedactedContactLabel(displayName) {
		displayName = ""
	}
	if !isGroup && isRedactedContactLabel(name) {
		name = ""
	}

	// Get unread count and group membership from WhatsApp's conversation
	// snapshot. The API persists both so Chats and Groups render one coherent
	// name/count state instead of inferring metadata from message history.
	unreadCount := int(conv.GetUnreadCount())
	var participants []natsClient.GroupParticipantPayload
	if isGroup {
		participants = h.getHistoryGroupParticipants(conv)
	}

	// Fetch profile picture during history sync
	var profilePicURL string
	if h.config.Client != nil && h.config.Storage != nil {
		profilePicURL = h.fetchProfilePicture(normalizedJID)
	}

	// Publish contact to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishContact(jid, name, displayName, conv.GetDescription(), isGroup, unreadCount, participants, profilePicURL); err != nil {
			log.Printf("Failed to publish contact %s: %v", jid, err)
		}
	}

	// Saved address-book names and push names live in whatsmeow's contact store,
	// not reliably in the conversation's displayName field.
	if !isGroup && h.config.Client != nil {
		client := h.config.Client.GetClient()
		if client != nil && client.Store != nil && client.Store.Contacts != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			contactInfo, err := client.Store.Contacts.GetContact(ctx, normalizedJID)
			cancel()
			if err == nil {
				h.publishContactInfo(normalizedJID, types.EmptyJID, contactInfo)
			}
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

	// Process messages using concrete type
	for _, historyMsg := range conv.GetMessages() {
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

func (h *Handler) getHistorySenderJID(chatJID, participant string, isGroup bool) string {
	if !isGroup || participant == "" {
		return chatJID
	}
	parsedParticipant, err := types.ParseJID(participant)
	if err != nil {
		return chatJID
	}
	return h.resolvePreferredJID(parsedParticipant, types.EmptyJID).String()
}

func normalizeHistoryMessageStatus(status waWeb.WebMessageInfo_Status) string {
	switch status {
	case waWeb.WebMessageInfo_PENDING:
		return "pending"
	case waWeb.WebMessageInfo_SERVER_ACK:
		return "sent"
	case waWeb.WebMessageInfo_DELIVERY_ACK:
		return "delivered"
	case waWeb.WebMessageInfo_READ, waWeb.WebMessageInfo_PLAYED:
		return "read"
	case waWeb.WebMessageInfo_ERROR:
		return "failed"
	default:
		return ""
	}
}

// processHistorySyncMessage processes a single message from history sync.
// Returns (processed, hasMedia) - whether the message was processed and if it had media.
// Uses concrete proto type *waHistorySync.HistorySyncMsg for reliable type handling.
func (h *Handler) processHistorySyncMessage(historyMsg *waHistorySync.HistorySyncMsg, jid string, isGroup bool) (bool, bool) {
	if historyMsg == nil {
		return false, false
	}

	msg := historyMsg.GetMessage()
	if msg == nil || msg.Message == nil {
		return false, false
	}

	// Extract timestamp with proper handling for zero/missing values
	var timestamp time.Time
	msgTimestamp := msg.GetMessageTimestamp()
	if msgTimestamp > 0 {
		timestamp = time.Unix(int64(msgTimestamp), 0)
	} else {
		// Log missing timestamp for debugging - this should be rare
		log.Printf("Missing timestamp for message %s in chat %s, using current time", msg.GetKey().GetID(), jid)
		timestamp = time.Now()
	}

	// Group history keys carry the actual author in Participant while the
	// conversation JID is the group. Keeping From as the group loses who sent
	// every imported message.
	senderJID := h.getHistorySenderJID(
		jid,
		msg.GetKey().GetParticipant(),
		isGroup,
	)

	// Build message event with history sync flag
	msgEvent := natsClient.MessageEvent{
		MessageID:     msg.GetKey().GetID(),
		From:          senderJID,
		To:            jid,
		FromMe:        msg.GetKey().GetFromMe(),
		IsGroup:       isGroup,
		GroupID:       jid,
		Timestamp:     timestamp,
		IsHistorySync: true, // Mark as history sync message
	}
	if isGroup {
		if participantJID, err := types.ParseJID(msg.GetKey().GetParticipant()); err == nil {
			msgEvent.ProtocolSenderJID = participantJID.ToNonAD().String()
		}
	}
	if msg.GetKey().GetFromMe() && msg.Status != nil {
		msgEvent.Status = normalizeHistoryMessageStatus(msg.GetStatus())
	}

	// Get push name
	msgEvent.SenderName = msg.GetPushName()

	// Extract content based on message type
	waMsg := msg.GetMessage()
	if waMsg == nil {
		return false, false
	}
	msgEvent.QuotedMessageID = getQuotedMessageID(waMsg)

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
	// Source 1: ReactionMessage within the message structure (when the message IS a reaction)
	if waMsg.ReactionMessage != nil && waMsg.ReactionMessage.Key != nil {
		h.processHistorySyncReaction(waMsg.ReactionMessage, msg, jid)
	}

	// Source 2: Reactions array on WebMessageInfo (reactions ON this message from other users)
	// This is the primary source for reactions during history sync
	h.processMessageReactions(msg, jid)

	return true, hasMedia
}

func (h *Handler) resolveHistoryIdentity(rawJID string) string {
	parsedJID, err := types.ParseJID(rawJID)
	if err != nil || parsedJID.IsEmpty() {
		return ""
	}
	return h.resolvePreferredJID(parsedJID, types.EmptyJID).String()
}

func (h *Handler) ownHistoryIdentity() string {
	if h.config.Client == nil {
		return ""
	}
	client := h.config.Client.GetClient()
	if client == nil || client.Store == nil || client.Store.ID == nil {
		return ""
	}
	return client.Store.ID.ToNonAD().String()
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
		// Group message - use participant field and resolve private LIDs.
		senderJID = h.resolveHistoryIdentity(msg.GetKey().GetParticipant())
	} else if msg.GetKey().GetFromMe() {
		senderJID = h.ownHistoryIdentity()
	} else if msg.GetKey().GetRemoteJID() != "" {
		// Direct message - use remote JID.
		senderJID = h.resolveHistoryIdentity(msg.GetKey().GetRemoteJID())
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

// processMessageReactions processes the Reactions array on a WebMessageInfo.
// This array contains all reactions ON the message from other users (received during history sync).
// This is distinct from ReactionMessage which is when the message itself IS a reaction.
func (h *Handler) processMessageReactions(msg *waWeb.WebMessageInfo, chatJID string) {
	if msg == nil || h.publisher == nil {
		return
	}

	reactions := msg.GetReactions()
	if len(reactions) == 0 {
		return
	}

	// Get the target message ID (the message these reactions are on)
	targetMsgID := msg.GetKey().GetID()
	if targetMsgID == "" {
		return
	}

	for _, reaction := range reactions {
		if reaction == nil || reaction.Key == nil {
			continue
		}

		// Get reactor JID from the reaction key
		// The reactor can be in Participant (for groups) or RemoteJID (for direct chats)
		var reactorJID string
		if reaction.Key.GetParticipant() != "" {
			// Group - reactor is in Participant field. Resolve private LIDs before
			// publishing so first-sync reactions use the same identity as members.
			reactorJID = h.resolveHistoryIdentity(reaction.Key.GetParticipant())
		} else if reaction.Key.GetFromMe() {
			reactorJID = h.ownHistoryIdentity()
		} else if reaction.Key.GetRemoteJID() != "" {
			// Direct chat - reactor is in RemoteJID.
			reactorJID = h.resolveHistoryIdentity(reaction.Key.GetRemoteJID())
		}

		if reactorJID == "" {
			continue
		}

		// Get emoji text
		emoji := reaction.GetText()
		if emoji == "" {
			continue // Skip empty reactions (reaction removals)
		}

		// Get timestamp from reaction (milliseconds)
		var timestamp time.Time
		if ts := reaction.GetSenderTimestampMS(); ts > 0 {
			timestamp = time.UnixMilli(ts)
		} else {
			// Fallback to message timestamp
			timestamp = time.Unix(int64(msg.GetMessageTimestamp()), 0)
		}

		log.Printf("Processing reaction on message %s from %s: %s", targetMsgID, reactorJID, emoji)

		// Publish reaction to NATS
		if err := h.publisher.PublishReaction(
			targetMsgID,
			reactorJID,
			chatJID,
			emoji,
			timestamp,
		); err != nil {
			log.Printf("Failed to publish message reaction: %v", err)
		}
	}
}
