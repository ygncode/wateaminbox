package nats

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	// Stream name for WhatsApp events
	StreamName = "WHATSAPP_EVENTS"

	// Subject prefixes (uppercase to match orchestrator's stream)
	// Format: WHATSAPP.events.{companyId}.{connectionId}.{type}
	SubjectQR       = "WHATSAPP.events.%s.%s.qr"
	SubjectStatus   = "WHATSAPP.events.%s.%s.status"
	SubjectMessage  = "WHATSAPP.events.%s.%s.message"
	SubjectReceipt  = "WHATSAPP.events.%s.%s.receipt"
	SubjectPresence = "WHATSAPP.events.%s.%s.presence"
	SubjectContact  = "WHATSAPP.events.%s.%s.contact"
)

// WhatsAppEvent is the wrapper format expected by the API.
// This matches the TypeScript WhatsAppEvent interface in apps/api/src/lib/nats.ts
type WhatsAppEvent struct {
	Type         string      `json:"type"`
	CompanyID    string      `json:"companyId"`
	ConnectionID string      `json:"connectionId"`
	Payload      interface{} `json:"payload"`
	Timestamp    string      `json:"timestamp"`
}

// QRPayload is the payload for QR code events.
type QRPayload struct {
	QRCode    string `json:"qrCode"`
	ExpiresAt string `json:"expiresAt"`
}

// ConnectionPayload is the payload for connection status events.
type ConnectionPayload struct {
	PhoneNumber string `json:"phoneNumber,omitempty"`
	JID         string `json:"jid,omitempty"`
	Reason      string `json:"reason,omitempty"`
}

// QRCodeEvent represents a QR code event for device pairing (internal use).
type QRCodeEvent struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	QRData       string    `json:"qr_data"`
	Timestamp    time.Time `json:"timestamp"`
}

// ConnectionStatusEvent represents a connection status change (internal use).
type ConnectionStatusEvent struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	Status       string    `json:"status"` // "connected", "disconnected", "logged_out"
	Reason       string    `json:"reason,omitempty"`
	Timestamp    time.Time `json:"timestamp"`
}

// MessagePayload is the payload for message events (matches API MessageEvent.payload).
type MessagePayload struct {
	MessageID       string `json:"messageId"`
	From            string `json:"from"`
	To              string `json:"to"`
	FromMe          bool   `json:"fromMe"`
	Content         string `json:"content"`
	MessageType     string `json:"messageType"`
	Timestamp       string `json:"timestamp"`
	MediaURL        string `json:"mediaUrl,omitempty"`
	QuotedMessageID string `json:"quotedMessageId,omitempty"`
	IsGroup         bool   `json:"isGroup,omitempty"`
	GroupID         string `json:"groupId,omitempty"`
	SenderName      string `json:"senderName,omitempty"`
	Caption         string `json:"caption,omitempty"`
	FileName        string `json:"fileName,omitempty"`
	MediaType       string `json:"mediaType,omitempty"`
}

// MessageEvent represents an incoming WhatsApp message (internal use).
type MessageEvent struct {
	MessageID       string    `json:"message_id"`
	From            string    `json:"from"`
	To              string    `json:"to"`
	FromMe          bool      `json:"from_me"`
	Type            string    `json:"type"` // "text", "image", "video", "audio", "document"
	Content         string    `json:"content,omitempty"`
	MediaURL        string    `json:"media_url,omitempty"`
	MediaType       string    `json:"media_type,omitempty"`
	MediaSize       int64     `json:"media_size,omitempty"`
	FileName        string    `json:"file_name,omitempty"`
	Caption         string    `json:"caption,omitempty"`
	IsGroup         bool      `json:"is_group"`
	GroupID         string    `json:"group_id,omitempty"`
	SenderName      string    `json:"sender_name,omitempty"`
	QuotedMessageID string    `json:"quoted_message_id,omitempty"`
	Timestamp       time.Time `json:"timestamp"`
}

// ContactPayload is the payload for contact/conversation sync events.
type ContactPayload struct {
	JID                string `json:"jid"`
	Name               string `json:"name,omitempty"`
	DisplayName        string `json:"displayName,omitempty"`
	IsGroup            bool   `json:"isGroup"`
	UnreadCount        int    `json:"unreadCount,omitempty"`
	ProfilePictureURL  string `json:"profilePictureUrl,omitempty"`
}

// ReceiptPayload is the payload for receipt events (matches API ReceiptEvent.payload).
type ReceiptPayload struct {
	MessageID string `json:"messageId"`
	Status    string `json:"status"` // "sent", "delivered", "read"
	Timestamp string `json:"timestamp"`
}

// ReceiptEvent represents a message receipt (delivered, read, etc.) (internal use).
type ReceiptEvent struct {
	MessageIDs  []string  `json:"message_ids"`
	ReceiptType string    `json:"receipt_type"` // "delivered", "read", "played"
	From        string    `json:"from"`
	Timestamp   time.Time `json:"timestamp"`
}

// PresenceEvent represents a presence update (internal use).
type PresenceEvent struct {
	From        string    `json:"from"`
	Unavailable bool      `json:"unavailable"`
	LastSeen    time.Time `json:"last_seen,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// Publisher handles publishing events to NATS.
type Publisher struct {
	nc           *nats.Conn
	js           nats.JetStreamContext
	companyID    string
	connectionID string
}

// PublisherConfig holds configuration for the publisher.
type PublisherConfig struct {
	NATSURL      string
	CompanyID    string
	ConnectionID string
}

// NewPublisher creates a new NATS publisher.
func NewPublisher(cfg PublisherConfig) (*Publisher, error) {
	// Connect to NATS
	nc, err := nats.Connect(cfg.NATSURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(time.Second),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			if err != nil {
				log.Printf("NATS disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("NATS reconnected to %s", nc.ConnectedUrl())
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	// Get JetStream context
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to get JetStream context: %w", err)
	}

	// Ensure the stream exists
	if err := ensureStream(js); err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to ensure stream: %w", err)
	}

	return &Publisher{
		nc:           nc,
		js:           js,
		companyID:    cfg.CompanyID,
		connectionID: cfg.ConnectionID,
	}, nil
}

// ensureStream creates the WHATSAPP_EVENTS stream if it doesn't exist.
func ensureStream(js nats.JetStreamContext) error {
	_, err := js.StreamInfo(StreamName)
	if err != nil {
		if err == nats.ErrStreamNotFound {
			// Create the stream (matching orchestrator's pattern)
			_, err = js.AddStream(&nats.StreamConfig{
				Name:      StreamName,
				Subjects:  []string{"WHATSAPP.events", "WHATSAPP.events.>"},
				Retention: nats.LimitsPolicy,
				MaxAge:    24 * time.Hour * 7, // Keep messages for 7 days
				Storage:   nats.FileStorage,
				Replicas:  1,
			})
			if err != nil {
				return fmt.Errorf("failed to create stream: %w", err)
			}
			log.Printf("Created JetStream stream: %s", StreamName)
		} else {
			return fmt.Errorf("failed to get stream info: %w", err)
		}
	}
	return nil
}

// PublishQRCode publishes a QR code event.
func (p *Publisher) PublishQRCode(qrData string) error {
	// QR codes typically expire in 60 seconds
	expiresAt := time.Now().Add(60 * time.Second)

	event := WhatsAppEvent{
		Type:         "qr",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: QRPayload{
			QRCode:    qrData,
			ExpiresAt: expiresAt.Format(time.RFC3339),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectQR, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishConnectionStatus publishes a connection status event.
func (p *Publisher) PublishConnectionStatus(status, reason string) error {
	event := WhatsAppEvent{
		Type:         status, // "connected" or "disconnected"
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ConnectionPayload{
			Reason: reason,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectStatus, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishMessage publishes an incoming message event.
func (p *Publisher) PublishMessage(msg MessageEvent) error {
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	// For media messages, use caption as content if content is empty
	content := msg.Content
	if content == "" && msg.Caption != "" {
		content = msg.Caption
	}

	event := WhatsAppEvent{
		Type:         "message",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: MessagePayload{
			MessageID:       msg.MessageID,
			From:            msg.From,
			To:              msg.To,
			FromMe:          msg.FromMe,
			Content:         content,
			MessageType:     msg.Type,
			Timestamp:       msg.Timestamp.Format(time.RFC3339),
			MediaURL:        msg.MediaURL,
			QuotedMessageID: msg.QuotedMessageID,
			IsGroup:         msg.IsGroup,
			GroupID:         msg.GroupID,
			SenderName:      msg.SenderName,
			Caption:         msg.Caption,
			FileName:        msg.FileName,
			MediaType:       msg.MediaType,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectMessage, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishReceipt publishes a message receipt event.
func (p *Publisher) PublishReceipt(receipt ReceiptEvent) error {
	if receipt.Timestamp.IsZero() {
		receipt.Timestamp = time.Now()
	}

	// Publish one event per message ID
	for _, msgID := range receipt.MessageIDs {
		event := WhatsAppEvent{
			Type:         "receipt",
			CompanyID:    p.companyID,
			ConnectionID: p.connectionID,
			Payload: ReceiptPayload{
				MessageID: msgID,
				Status:    receipt.ReceiptType,
				Timestamp: receipt.Timestamp.Format(time.RFC3339),
			},
			Timestamp: time.Now().Format(time.RFC3339),
		}

		subject := fmt.Sprintf(SubjectReceipt, p.companyID, p.connectionID)
		if err := p.publish(subject, event); err != nil {
			return err
		}
	}

	return nil
}

// PresencePayload is the payload for presence events.
type PresencePayload struct {
	From        string `json:"from"`
	Unavailable bool   `json:"unavailable"`
	LastSeen    string `json:"lastSeen,omitempty"`
}

// PublishPresence publishes a presence update event.
func (p *Publisher) PublishPresence(presence PresenceEvent) error {
	if presence.Timestamp.IsZero() {
		presence.Timestamp = time.Now()
	}

	var lastSeen string
	if !presence.LastSeen.IsZero() {
		lastSeen = presence.LastSeen.Format(time.RFC3339)
	}

	event := WhatsAppEvent{
		Type:         "presence",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: PresencePayload{
			From:        presence.From,
			Unavailable: presence.Unavailable,
			LastSeen:    lastSeen,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectPresence, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishContact publishes a contact sync event.
func (p *Publisher) PublishContact(jid, name, displayName string, isGroup bool, unreadCount int, profilePictureURL string) error {
	event := WhatsAppEvent{
		Type:         "contact",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ContactPayload{
			JID:               jid,
			Name:              name,
			DisplayName:       displayName,
			IsGroup:           isGroup,
			UnreadCount:       unreadCount,
			ProfilePictureURL: profilePictureURL,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectContact, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// publish marshals the event and publishes it to the specified subject.
func (p *Publisher) publish(subject string, event interface{}) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	_, err = p.js.Publish(subject, data)
	if err != nil {
		return fmt.Errorf("failed to publish to %s: %w", subject, err)
	}

	log.Printf("Published event to %s", subject)
	return nil
}

// Close closes the NATS connection.
func (p *Publisher) Close() {
	if p.nc != nil {
		p.nc.Close()
	}
}
