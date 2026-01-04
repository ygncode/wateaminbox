package handler

import (
	"context"
	"log"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/client"
	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/storage"
)

// Config holds handler configuration.
type Config struct {
	WorkerID  string
	CompanyID string
	NATSUrl   string
	Client    *client.Client
	Publisher *natsClient.Publisher
	Storage   *storage.Client
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
	default:
		// Ignore other events silently
	}
}

// handleMessage processes incoming messages.
func (h *Handler) handleMessage(msg *events.Message) {
	log.Printf("Received message from %s", msg.Info.Sender.String())

	// Extract message content
	msgEvent := natsClient.MessageEvent{
		MessageID:  msg.Info.ID,
		From:       msg.Info.Sender.String(),
		To:         msg.Info.Chat.String(),
		IsGroup:    msg.Info.IsGroup,
		SenderName: msg.Info.PushName,
		Timestamp:  msg.Info.Timestamp,
	}

	if msg.Info.IsGroup {
		msgEvent.GroupID = msg.Info.Chat.String()
	}

	// Handle different message types
	if msg.Message == nil {
		log.Println("Message content is nil")
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
		log.Printf("Unknown message type from %s", msg.Info.Sender.String())
		return
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishMessage(msgEvent); err != nil {
			log.Printf("Failed to publish message event: %v", err)
		}
	}
}

// handleMediaMessage downloads media and uploads to storage.
func (h *Handler) handleMediaMessage(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) {
	if h.config.Client == nil {
		log.Println("Client not available for media download")
		return
	}

	// Create a context with timeout for media download and upload
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Download the media
	data, err := h.config.Client.DownloadMedia(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download media: %v", err)
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
	log.Printf("Received receipt: %s from %s", receipt.Type, receipt.Sender.String())

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
		From:        receipt.Sender.String(),
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
	log.Printf("Presence update from %s: unavailable=%v", presence.From.String(), presence.Unavailable)

	presenceEvent := natsClient.PresenceEvent{
		From:        presence.From.String(),
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

// handleConnected is called when connection is established.
func (h *Handler) handleConnected(evt *events.Connected) {
	log.Printf("Worker %s connected to WhatsApp", h.config.WorkerID)

	// Publish connection status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("connected", ""); err != nil {
			log.Printf("Failed to publish connected status: %v", err)
		}
	}
}

// handleDisconnected is called when connection is lost.
func (h *Handler) handleDisconnected(evt *events.Disconnected) {
	log.Printf("Worker %s disconnected from WhatsApp", h.config.WorkerID)

	// Publish disconnection status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("disconnected", "connection_lost"); err != nil {
			log.Printf("Failed to publish disconnected status: %v", err)
		}
	}

	// Attempt reconnection
	if h.config.Client != nil {
		go h.config.Client.HandleReconnect()
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
		if err := h.publisher.PublishConnectionStatus("logged_out", reason); err != nil {
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

	// Publish pair success status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("paired", evt.ID.String()); err != nil {
			log.Printf("Failed to publish pair success status: %v", err)
		}
	}
}

// handleHistorySync is called when history sync is received.
func (h *Handler) handleHistorySync(evt *events.HistorySync) {
	conversations := evt.Data.GetConversations()
	log.Printf("History sync received: %d conversations", len(conversations))

	// Track stats for logging
	var totalMessages, mediaDownloaded, mediaFailed int

	for _, conv := range conversations {
		jid := conv.GetID()
		if jid == "" {
			continue
		}

		// Determine if this is a group chat
		isGroup := conv.GetIsDefaultSubgroup() || len(conv.GetParticipant()) > 0

		// Get display name from conversation
		displayName := conv.GetDisplayName()
		name := conv.GetName()

		// Get unread count
		unreadCount := int(conv.GetUnreadCount())

		// Publish contact to NATS
		if h.publisher != nil {
			if err := h.publisher.PublishContact(jid, name, displayName, isGroup, unreadCount); err != nil {
				log.Printf("Failed to publish contact %s: %v", jid, err)
			}
		}

		// Process messages in this conversation
		messages := conv.GetMessages()
		log.Printf("Processing %d messages for conversation %s", len(messages), jid)

		for _, historyMsg := range messages {
			msg := historyMsg.GetMessage()
			if msg == nil || msg.Message == nil {
				continue
			}

			totalMessages++

			// Build message event
			msgEvent := natsClient.MessageEvent{
				MessageID: msg.GetKey().GetID(),
				From:      jid,
				To:        jid,
				FromMe:    msg.GetKey().GetFromMe(),
				IsGroup:   isGroup,
				Timestamp: time.Unix(int64(msg.GetMessageTimestamp()), 0),
			}

			// Get push name
			msgEvent.SenderName = msg.GetPushName()

			// Extract content based on message type
			waMsg := msg.GetMessage()
			if waMsg == nil {
				continue
			}

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

			// Image message
			if waMsg.ImageMessage != nil {
				msgEvent.Type = "image"
				if waMsg.ImageMessage.Caption != nil {
					msgEvent.Caption = *waMsg.ImageMessage.Caption
				}
				if waMsg.ImageMessage.Mimetype != nil {
					msgEvent.MediaType = *waMsg.ImageMessage.Mimetype
				}
				// Download media with rate limiting
				if h.downloadHistoryMedia(waMsg.ImageMessage, &msgEvent) {
					mediaDownloaded++
				} else {
					mediaFailed++
				}
			}

			// Video message
			if waMsg.VideoMessage != nil {
				msgEvent.Type = "video"
				if waMsg.VideoMessage.Caption != nil {
					msgEvent.Caption = *waMsg.VideoMessage.Caption
				}
				if waMsg.VideoMessage.Mimetype != nil {
					msgEvent.MediaType = *waMsg.VideoMessage.Mimetype
				}
				// Download media with rate limiting
				if h.downloadHistoryMedia(waMsg.VideoMessage, &msgEvent) {
					mediaDownloaded++
				} else {
					mediaFailed++
				}
			}

			// Audio message
			if waMsg.AudioMessage != nil {
				msgEvent.Type = "audio"
				if waMsg.AudioMessage.Mimetype != nil {
					msgEvent.MediaType = *waMsg.AudioMessage.Mimetype
				}
				// Download media with rate limiting
				if h.downloadHistoryMedia(waMsg.AudioMessage, &msgEvent) {
					mediaDownloaded++
				} else {
					mediaFailed++
				}
			}

			// Document message
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
				// Download media with rate limiting
				if h.downloadHistoryMedia(waMsg.DocumentMessage, &msgEvent) {
					mediaDownloaded++
				} else {
					mediaFailed++
				}
			}

			// Sticker message
			if waMsg.StickerMessage != nil {
				msgEvent.Type = "sticker"
				if waMsg.StickerMessage.Mimetype != nil {
					msgEvent.MediaType = *waMsg.StickerMessage.Mimetype
				}
				// Download media with rate limiting
				if h.downloadHistoryMedia(waMsg.StickerMessage, &msgEvent) {
					mediaDownloaded++
				} else {
					mediaFailed++
				}
			}

			// Skip if we couldn't determine message type
			if msgEvent.Type == "" {
				continue
			}

			// Publish message to NATS
			if h.publisher != nil {
				if err := h.publisher.PublishMessage(msgEvent); err != nil {
					log.Printf("Failed to publish history message: %v", err)
				}
			}
		}
	}

	log.Printf("History sync complete: %d messages, %d media downloaded, %d media failed",
		totalMessages, mediaDownloaded, mediaFailed)
}

// downloadHistoryMedia downloads media from history sync with rate limiting.
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

	// Create a context with timeout for media download and upload
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Download the media
	data, err := h.config.Client.DownloadMedia(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download history media: %v", err)
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
		if err := h.publisher.PublishConnectionStatus("disconnected", "stream_replaced"); err != nil {
			log.Printf("Failed to publish stream replaced status: %v", err)
		}
	}
}
