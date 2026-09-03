package handler

import (
	"context"
	"log"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// resolvePreferredJID converts WhatsApp's private LID identity to its stable
// phone-number JID. Some message stanzas omit SenderAlt/RecipientAlt even though
// whatsmeow has already persisted the mapping, so checking only the event's Alt
// field creates a second conversation for the same person.
func (h *Handler) resolvePreferredJID(primary, alternative types.JID) types.JID {
	if primary.Server != types.HiddenUserServer && primary.Server != types.HostedLIDServer {
		return primary.ToNonAD()
	}
	if !alternative.IsEmpty() && alternative.Server == types.DefaultUserServer {
		return alternative.ToNonAD()
	}

	if h.config.Client != nil {
		client := h.config.Client.GetClient()
		if client != nil && client.Store != nil && client.Store.LIDs != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			// Live-message mappings retain the device suffix, so resolve the full
			// JID first. History-sync mappings may use the non-device form.
			pn, err := client.Store.LIDs.GetPNForLID(ctx, primary)
			if err == nil && !pn.IsEmpty() {
				return pn.ToNonAD()
			}
			if primary.Device != 0 {
				pn, err = client.Store.LIDs.GetPNForLID(ctx, primary.ToNonAD())
				if err == nil && !pn.IsEmpty() {
					return pn.ToNonAD()
				}
			}
		}
	}

	return primary.ToNonAD()
}

func (h *Handler) getPreferredSenderJID(info types.MessageInfo) types.JID {
	return h.resolvePreferredJID(info.Sender, info.SenderAlt)
}

func (h *Handler) getPreferredChatJID(info types.MessageInfo) types.JID {
	return h.resolvePreferredJID(info.Chat, info.RecipientAlt)
}

func (h *Handler) getPreferredSenderFromSource(source types.MessageSource) types.JID {
	return h.resolvePreferredJID(source.Sender, source.SenderAlt)
}

func newMessageEvent(msg *events.Message, senderJID, chatJID types.JID) natsClient.MessageEvent {
	event := natsClient.MessageEvent{
		MessageID:  msg.Info.ID,
		From:       senderJID.String(),
		To:         chatJID.String(),
		FromMe:     msg.Info.IsFromMe,
		IsGroup:    msg.Info.IsGroup,
		SenderName: msg.Info.PushName,
		Timestamp:  msg.Info.Timestamp,
	}
	if msg.Info.IsGroup && !msg.Info.Sender.IsEmpty() {
		event.ProtocolSenderJID = msg.Info.Sender.ToNonAD().String()
	}
	return event
}

type contextInfoCarrier interface {
	GetContextInfo() *waE2E.ContextInfo
}

// getQuotedMessageID extracts the referenced WhatsApp stanza from every
// message type handled by the worker. Replies are represented by context info,
// not only ExtendedTextMessage, so media replies must be checked as well.
func getQuotedMessageID(message *waE2E.Message) string {
	if message == nil {
		return ""
	}
	carriers := []contextInfoCarrier{
		message.ExtendedTextMessage,
		message.ImageMessage,
		message.VideoMessage,
		message.AudioMessage,
		message.DocumentMessage,
		message.StickerMessage,
		message.LocationMessage,
		message.ContactMessage,
	}
	for _, carrier := range carriers {
		if contextInfo := carrier.GetContextInfo(); contextInfo != nil {
			if stanzaID := contextInfo.GetStanzaID(); stanzaID != "" {
				return stanzaID
			}
		}
	}
	return ""
}

// handleMessage processes incoming messages.
func (h *Handler) handleMessage(msg *events.Message) {
	// Get preferred JIDs (PN over LID) to ensure consistency with stored contacts
	senderJID := h.getPreferredSenderJID(msg.Info)
	chatJID := h.getPreferredChatJID(msg.Info)

	log.Printf("Received message from %s", senderJID.String())

	// Subscribe to presence updates for the sender (if not a group message)
	// This ensures we get online/offline status for contacts we're chatting with
	if !msg.Info.IsGroup && h.config.Client != nil {
		// Use a background goroutine to avoid blocking message processing
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			if err := h.config.Client.SubscribePresence(ctx, senderJID); err != nil {
				// Ignore errors - presence subscription is not critical
				// Most common error is "already subscribed" which is fine
			}
		}()
	}

	// Extract message content
	msgEvent := newMessageEvent(msg, senderJID, chatJID)

	if msg.Info.IsGroup {
		msgEvent.GroupID = chatJID.String()
	}

	// Handle different message types
	if msg.Message == nil {
		log.Println("Message content is nil")
		return
	}
	msg.Message = unwrapMediaAlbumMessage(msg.Message)

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

	// The album parent is a manifest, not a visible chat row. Its ordinary
	// image/video children carry a MEDIA_ALBUM association to this message ID.
	if album := msg.Message.GetAlbumMessage(); album != nil {
		h.rememberMediaAlbum(chatJID.String(), msg.Info.ID, album)
		return
	}

	msgEvent.QuotedMessageID = getQuotedMessageID(msg.Message)
	h.applyMediaAlbumMetadata(chatJID.String(), msg.Message, &msgEvent)

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

		// Get preferred JIDs (PN over LID)
		senderJID := h.getPreferredSenderJID(msg.Info)
		chatJID := h.getPreferredChatJID(msg.Info)

		log.Printf("Message revoke received from %s for message %s", senderJID.String(), revokedID)

		if h.publisher != nil {
			// Publish the revoke event
			if err := h.publisher.PublishMessageRevoke(revokedID, senderJID.String(), chatJID.String(), msg.Info.Timestamp); err != nil {
				log.Printf("Failed to publish message revoke: %v", err)
			}
		}
	}
}

// handleReactionMessage processes incoming reaction messages.
// Reactions come as Message events with a ReactionMessage field.
func (h *Handler) handleReactionMessage(msg *events.Message) {
	reactionMsg := msg.Message.ReactionMessage
	if reactionMsg == nil || reactionMsg.Key == nil {
		log.Println("Invalid reaction message: missing key")
		return
	}

	// Get preferred JIDs (PN over LID)
	senderJID := h.getPreferredSenderJID(msg.Info)
	chatJID := h.getPreferredChatJID(msg.Info)

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

func normalizeReceiptStatus(receiptType types.ReceiptType) string {
	switch receiptType {
	case types.ReceiptTypeDelivered:
		return "delivered"
	case types.ReceiptTypeSender:
		return "sent"
	case types.ReceiptTypeRead, types.ReceiptTypePlayed:
		return "read"
	default:
		return string(receiptType)
	}
}

// handleReceipt processes message receipts.
func (h *Handler) handleReceipt(receipt *events.Receipt) {
	// Get preferred JID (PN over LID)
	senderJID := h.getPreferredSenderFromSource(receipt.MessageSource)

	log.Printf("Received receipt: %s from %s", receipt.Type, senderJID.String())

	// Convert message IDs
	messageIDs := make([]string, len(receipt.MessageIDs))
	for i, id := range receipt.MessageIDs {
		messageIDs[i] = id
	}

	// Publish canonical status names. WhatsApp uses an empty receipt type for
	// normal delivery, which would otherwise be mistaken for an unknown status.
	receiptType := normalizeReceiptStatus(receipt.Type)

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
