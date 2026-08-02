// Package interfaces provides testable interfaces for the WhatsApp service.
// This package follows the dependency injection pattern used in the orchestrator service,
// allowing concrete implementations to be replaced with mocks in tests.
package interfaces

import (
	"context"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"

	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
	intTypes "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

// Storage provides an interface for media storage operations.
// This allows mocking S3/MinIO storage in tests.
type Storage interface {
	// UploadMedia uploads media data and returns a private object reference.
	UploadMedia(ctx context.Context, data []byte, mimeType string, companyID string) (string, error)
	// UploadMediaWithFilename uploads media with a sanitized filename.
	UploadMediaWithFilename(ctx context.Context, data []byte, mimeType string, companyID string, filename string) (string, error)
	// DeleteMedia deletes a media file by its key.
	DeleteMedia(ctx context.Context, key string) error
	// GetPresignedURL generates a presigned URL for temporary access.
	GetPresignedURL(ctx context.Context, key string, expiry time.Duration) (string, error)
	// EnsureBucketExists creates the bucket if it doesn't exist.
	EnsureBucketExists(ctx context.Context) error
}

// Publisher provides an interface for NATS event publishing.
// This allows mocking NATS interactions in tests.
type Publisher interface {
	// PublishQRCode publishes a QR code event.
	PublishQRCode(qrData string) error
	// PublishConnectionStatus publishes a connection status event.
	PublishConnectionStatus(status, reason, phoneNumber, jid string) error
	// PublishMessage publishes an incoming message event.
	PublishMessage(msg MessageEvent) error
	// PublishReceipt publishes a message receipt event.
	PublishReceipt(receipt ReceiptEvent) error
	// PublishPresence publishes a presence update event.
	PublishPresence(presence PresenceEvent) error
	// PublishTyping publishes a typing indicator event.
	PublishTyping(typing TypingEvent) error
	// PublishContact publishes a contact sync event.
	PublishContact(jid, name, displayName, description string, isGroup bool, unreadCount int, participants []sharednats.GroupParticipantPayload, profilePictureURL string) error
	// PublishGroupMetadata refreshes joined-group names and participants without changing unread state.
	PublishGroupMetadata(jid, name, description string, participantCount int, participants []sharednats.GroupParticipantPayload) error
	// PublishProfilePicture publishes a profile picture update event.
	PublishProfilePicture(jid, profilePictureURL string, remove bool, timestamp time.Time) error
	// PublishMessageRevoke publishes a message revocation event.
	PublishMessageRevoke(messageID, from, to string, timestamp time.Time) error
	// PublishSendConfirmation publishes a send confirmation event.
	PublishSendConfirmation(pendingMessageID, messageID string, timestamp time.Time) error
	// PublishReaction publishes a message reaction event.
	PublishReaction(messageID, from, chatJID, emoji string, timestamp time.Time) error
	// PublishDownloadResponse publishes a media download response event.
	PublishDownloadResponse(messageID, mediaURL string, mediaSize int64, success bool, errMsg string) error
	// PublishSyncStatus publishes a sync status event.
	PublishSyncStatus(status string, messageCount int, conversations int) error
	// PublishHistorySyncPage reports a completed on-demand history page.
	PublishHistorySyncPage(chatJID string, messageCount int, status string) error
	// Close closes the NATS connection.
	Close()
}

// MessageEvent represents an incoming WhatsApp message.
// Mirrors the internal nats.MessageEvent type for interface compatibility.
type MessageEvent struct {
	MessageID          string
	From               string
	To                 string
	FromMe             bool
	Type               string
	Status             string
	Content            string
	MediaURL           string
	MediaType          string
	MediaSize          int64
	FileName           string
	Caption            string
	IsGroup            bool
	GroupID            string
	SenderName         string
	QuotedMessageID    string
	Timestamp          time.Time
	MediaDirectPath    string
	MediaKey           []byte
	MediaFileSHA256    []byte
	MediaFileEncSHA256 []byte
	IsHistorySync      bool
}

// ReceiptEvent represents a message receipt (delivered, read, etc.).
type ReceiptEvent struct {
	MessageIDs  []string
	ReceiptType string
	From        string
	Timestamp   time.Time
}

// PresenceEvent represents a presence update.
type PresenceEvent struct {
	From        string
	Unavailable bool
	LastSeen    time.Time
	Timestamp   time.Time
}

// TypingEvent represents a typing indicator event.
type TypingEvent struct {
	From      string
	ChatJID   string
	IsTyping  bool
	MediaType string
	Timestamp time.Time
}

// WhatsAppClient defines the interface for the WhatsApp client.
// This allows for mocking the client in tests.
type WhatsAppClient interface {
	// DownloadMedia downloads media from a message.
	DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error)
	// GetClient returns the underlying whatsmeow client.
	GetClient() *whatsmeow.Client
	// HandleReconnect handles reconnection on disconnect.
	HandleReconnect(ctx context.Context)
	// SendPresence updates the user's presence status on WhatsApp.
	SendPresence(ctx context.Context, state types.Presence) error
	// SubscribePresence subscribes to presence updates for a specific contact.
	SubscribePresence(ctx context.Context, jid types.JID) error
	// Connect establishes connection to WhatsApp.
	Connect(ctx context.Context) error
	// Disconnect closes the WhatsApp connection.
	Disconnect()
	// IsConnected checks if the client is connected.
	IsConnected() bool
	// IsLoggedIn checks if the client is authenticated.
	IsLoggedIn() bool
	// GetJID returns the JID of the logged-in device.
	GetJID() string
	// SendMessage sends a text message.
	SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (intTypes.SendResponse, error)
	// SendMediaMessage sends a media message.
	SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (intTypes.SendResponse, error)
	// SendReaction sends a reaction to a message.
	SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, targetSenderJID string, fromMe bool) (intTypes.SendResponse, error)
	// RegisterEventHandler adds an event handler.
	RegisterEventHandler(handler func(interface{}))
	// SetQRCallback sets the callback for QR code events.
	SetQRCallback(cb func(qrCode string))
	// SetStatusCallback sets the callback for status change events.
	SetStatusCallback(cb func(status string, reason string))
	// DownloadMediaWithPath downloads media using its direct path and keys.
	DownloadMediaWithPath(ctx context.Context, directPath string, encFileHash, fileHash, mediaKey []byte, fileLength int, mediaType whatsmeow.MediaType, mmsType string) ([]byte, error)
	// BlockContact blocks a contact on WhatsApp.
	BlockContact(ctx context.Context, jid string) error
	// UnblockContact unblocks a contact on WhatsApp.
	UnblockContact(ctx context.Context, jid string) error
}

// Clock provides an interface for time operations.
// This allows controlling time in tests.
type Clock interface {
	// Now returns the current time.
	Now() time.Time
	// Since returns the duration since the given time.
	Since(t time.Time) time.Duration
	// After waits for the duration and returns the current time.
	After(d time.Duration) <-chan time.Time
}

// DefaultClock provides the real implementation of Clock.
type DefaultClock struct{}

// Now returns the current time.
func (d *DefaultClock) Now() time.Time {
	return time.Now()
}

// Since returns the duration since the given time.
func (d *DefaultClock) Since(t time.Time) time.Duration {
	return time.Since(t)
}

// After waits for the duration and returns the current time.
func (d *DefaultClock) After(dur time.Duration) <-chan time.Time {
	return time.After(dur)
}

// Compile-time interface compliance checks.
// These ensure DefaultClock implements Clock interface at compile time.
var _ Clock = (*DefaultClock)(nil)
