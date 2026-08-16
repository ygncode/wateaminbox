// Package nats provides shared NATS types and utilities for WhatsApp services.
package nats

import (
	"encoding/json"
	"time"
)

const ContractVersion = 1

// Event types used across WhatsApp services.
const (
	EventTypeQR               = "qr"
	EventTypeConnected        = "connected"
	EventTypeDisconnected     = "disconnected"
	EventTypeMessage          = "message"
	EventTypeReceipt          = "receipt"
	EventTypePresence         = "presence"
	EventTypeContact          = "contact"
	EventTypeProfilePicture   = "profile_picture"
	EventTypeMessageRevoke    = "message_revoke"
	EventTypeSendConfirm      = "send_confirmation"
	EventTypeSendFailed       = "send_failed" // Message send failed after max retries
	EventTypeTyping           = "typing"
	EventTypeReaction         = "reaction"
	EventTypeSyncStatus       = "sync_status"
	EventTypeHistorySyncPage  = "history_sync_page"
	EventTypeDownloadResp     = "download_response"
	EventTypeConnectionStatus = "connection_status" // Worker connection status change (from orchestrator)
	EventTypeLabels           = "labels"
	EventTypeCatalogs         = "catalogs"
	EventTypeCatalogProducts  = "catalog_products"
	EventTypeCommandResult    = "command_result"
	EventTypeGroup            = "group"
)

// Command outcomes carried on CommandResultPayload.Outcome.
const (
	// CommandOutcomeSucceeded: the command ran and its result was delivered.
	CommandOutcomeSucceeded = "succeeded"
	// CommandOutcomeFailed: the command did not take effect.
	CommandOutcomeFailed = "failed"
	// CommandOutcomeAppliedNotSynced: WhatsApp applied the change, but this
	// workspace could not be refreshed with the result. The action must NOT be
	// presented as failed, and must not be retried by the user.
	CommandOutcomeAppliedNotSynced = "applied_not_synced"
)

// Group event actions. Every group mutation the API can request produces one
// of these, so the API never has to infer group state from a bare command ack.
const (
	// GroupActionSnapshot carries WhatsApp's current view of a group.
	GroupActionSnapshot = "snapshot"
	// GroupActionCreated is a snapshot for a group this account just created.
	GroupActionCreated = "created"
	// GroupActionLeft reports that this account is no longer a member. It is
	// NOT a deletion: the group continues to exist for its other members.
	GroupActionLeft = "left"
	// GroupActionInviteLink carries the invite link WhatsApp returned.
	GroupActionInviteLink = "invite_link"
	// GroupActionJoinRequests carries the pending membership approval requests.
	GroupActionJoinRequests = "join_requests"
)

// Command types used across WhatsApp services.
const (
	CommandSpawn          = "spawn"
	CommandKill           = "kill"
	CommandStatus         = "status"
	CommandBlockContact   = "block_contact"
	CommandUnblockContact = "unblock_contact"
	CommandRequestHistory = "request_history"
)

// Worker status constants.
const (
	StatusStarting     = "starting"
	StatusConnecting   = "connecting"
	StatusConnected    = "connected"
	StatusDisconnected = "disconnected"
	StatusStopping     = "stopping"
	StatusStopped      = "stopped"
	StatusError        = "error"
)

// WhatsAppEvent is the wrapper format for all WhatsApp events published to NATS.
// This matches the TypeScript WhatsAppEvent interface in apps/api/src/lib/nats.ts
type WhatsAppEvent struct {
	ContractVersion int         `json:"contractVersion"`
	Type            string      `json:"type"`
	CompanyID       string      `json:"companyId"`
	ConnectionID    string      `json:"connectionId"`
	Payload         interface{} `json:"payload"`
	Timestamp       string      `json:"timestamp"`
	CorrelationID   string      `json:"correlationId,omitempty"` // For end-to-end message tracing
}

func (event WhatsAppEvent) MarshalJSON() ([]byte, error) {
	type eventAlias WhatsAppEvent
	if event.ContractVersion == 0 {
		event.ContractVersion = ContractVersion
	}
	return json.Marshal(eventAlias(event))
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

// MessagePayload is the payload for message events (matches API MessageEvent.payload).
type MessagePayload struct {
	MessageID       string `json:"messageId"`
	From            string `json:"from"`
	To              string `json:"to"`
	FromMe          bool   `json:"fromMe"`
	Content         string `json:"content"`
	MessageType     string `json:"messageType"`
	Status          string `json:"status,omitempty"`
	Timestamp       string `json:"timestamp"`
	MediaURL        string `json:"mediaUrl,omitempty"`
	QuotedMessageID string `json:"quotedMessageId,omitempty"`
	IsGroup         bool   `json:"isGroup,omitempty"`
	GroupID         string `json:"groupId,omitempty"`
	SenderName      string `json:"senderName,omitempty"`
	// ProtocolSenderJID preserves the participant identity used in WhatsApp's
	// message key (often a LID in modern groups), while From remains the
	// user-facing phone-number identity when one is available.
	ProtocolSenderJID string `json:"protocolSenderJid,omitempty"`
	Caption           string `json:"caption,omitempty"`
	FileName          string `json:"fileName,omitempty"`
	MediaType         string `json:"mediaType,omitempty"`
	MediaSize         int64  `json:"mediaSize,omitempty"`
	// Deferred media download fields - for on-demand download
	MediaDirectPath    string `json:"mediaDirectPath,omitempty"`
	MediaKey           []byte `json:"mediaKey,omitempty"`
	MediaFileSHA256    []byte `json:"mediaFileSha256,omitempty"`
	MediaFileEncSHA256 []byte `json:"mediaFileEncSha256,omitempty"`
	IsHistorySync      bool   `json:"isHistorySync,omitempty"`
}

// MessageRevokePayload is the payload for message revocation events.
type MessageRevokePayload struct {
	MessageID string `json:"messageId"`
	From      string `json:"from"`
	To        string `json:"to"`
	Timestamp string `json:"timestamp"`
}

// ReceiptPayload is the payload for receipt events.
type ReceiptPayload struct {
	MessageID string `json:"messageId"`
	Status    string `json:"status"` // "sent", "delivered", "read"
	Timestamp string `json:"timestamp"`
}

// PresencePayload is the payload for presence events.
type PresencePayload struct {
	From        string `json:"from"`
	Unavailable bool   `json:"unavailable"`
	LastSeen    string `json:"lastSeen,omitempty"`
}

// TypingPayload is the payload for typing indicator events.
type TypingPayload struct {
	From      string `json:"from"`
	ChatJID   string `json:"chatJid"`
	IsTyping  bool   `json:"isTyping"`
	MediaType string `json:"mediaType,omitempty"` // "text" or "audio"
}

// GroupParticipantPayload is a group member included in a conversation sync.
type GroupParticipantPayload struct {
	JID     string `json:"jid"`
	IsAdmin bool   `json:"isAdmin"`
}

// ContactPayload is the payload for contact/conversation sync events.
type ContactPayload struct {
	JID               string                    `json:"jid"`
	Name              string                    `json:"name,omitempty"`
	DisplayName       string                    `json:"displayName,omitempty"`
	Description       string                    `json:"description,omitempty"`
	FirstName         string                    `json:"firstName,omitempty"`
	FullName          string                    `json:"fullName,omitempty"`
	PushName          string                    `json:"pushName,omitempty"`
	BusinessName      string                    `json:"businessName,omitempty"`
	IsGroup           bool                      `json:"isGroup,omitempty"`
	NameOnly          bool                      `json:"nameOnly,omitempty"`
	UnreadCount       *int                      `json:"unreadCount,omitempty"`
	Participants      []GroupParticipantPayload `json:"participants,omitempty"`
	ParticipantCount  *int                      `json:"participantCount,omitempty"`
	ProfilePictureURL string                    `json:"profilePictureUrl,omitempty"`
}

// GroupSnapshotPayload is WhatsApp's authoritative view of a single group.
//
// Pointer fields distinguish "WhatsApp did not report this" from "WhatsApp
// reported false/zero". A partial change notification (events.GroupInfo) only
// fills the fields it changed, so the API must not reset the rest.
type GroupSnapshotPayload struct {
	JID                    string                    `json:"jid"`
	Name                   *string                   `json:"name,omitempty"`
	Description            *string                   `json:"description,omitempty"`
	OwnerJID               string                    `json:"ownerJid,omitempty"`
	Participants           []GroupParticipantPayload `json:"participants,omitempty"`
	ParticipantCount       *int                      `json:"participantCount,omitempty"`
	IsAnnounce             *bool                     `json:"isAnnounce,omitempty"`
	IsLocked               *bool                     `json:"isLocked,omitempty"`
	IsEphemeral            *bool                     `json:"isEphemeral,omitempty"`
	DisappearingTimer      *uint32                   `json:"disappearingTimer,omitempty"`
	IsJoinApprovalRequired *bool                     `json:"isJoinApprovalRequired,omitempty"`
	MemberAddMode          string                    `json:"memberAddMode,omitempty"`
	IsMember               *bool                     `json:"isMember,omitempty"`
}

// GroupJoinRequestPayload is one pending request to join a group.
type GroupJoinRequestPayload struct {
	JID         string `json:"jid"`
	RequestedAt string `json:"requestedAt,omitempty"`
}

// GroupPayload is the payload for group administration events.
//
// CommandID correlates the event with the outbox row that requested it, so the
// API can attribute an invite link or join-request listing to the request that
// asked for it rather than to whichever group happened to change last.
type GroupPayload struct {
	Action       string                    `json:"action"`
	JID          string                    `json:"jid"`
	CommandID    string                    `json:"commandId,omitempty"`
	Snapshot     *GroupSnapshotPayload     `json:"snapshot,omitempty"`
	InviteLink   string                    `json:"inviteLink,omitempty"`
	JoinRequests []GroupJoinRequestPayload `json:"joinRequests,omitempty"`
}

// ProfilePicturePayload is the payload for profile picture update events.
type ProfilePicturePayload struct {
	JID               string `json:"jid"`
	ProfilePictureURL string `json:"profilePictureUrl"`
	Timestamp         string `json:"timestamp"`
	Remove            bool   `json:"remove,omitempty"`
}

// SendConfirmationPayload is the payload for send confirmation events.
// This maps a pending message ID to the real WhatsApp message ID.
type SendConfirmationPayload struct {
	PendingMessageID string `json:"pendingMessageId"` // The temporary ID assigned by the API
	MessageID        string `json:"messageId"`        // The real WhatsApp message ID
	Timestamp        string `json:"timestamp"`
	CorrelationID    string `json:"correlationId,omitempty"` // For tracing the original command
}

// ReactionPayload is the payload for reaction events.
type ReactionPayload struct {
	MessageID string `json:"messageId"` // ID of the message being reacted to
	From      string `json:"from"`      // JID of the user who reacted
	ChatJID   string `json:"chatJid"`   // JID of the chat
	Emoji     string `json:"emoji"`     // Reaction emoji (empty string means removed)
	Timestamp string `json:"timestamp"`
}

// SyncStatusPayload is the payload for sync status events.
type SyncStatusPayload struct {
	Status        string `json:"status"`        // "starting", "progress", "completed"
	MessageCount  int    `json:"messageCount"`  // Total messages synced
	Conversations int    `json:"conversations"` // Number of conversations processed
}

// SendFailedPayload is the payload for message send failure events.
// Sent when a message fails to send after all retry attempts.
type SendFailedPayload struct {
	PendingMessageID string `json:"pendingMessageId"`        // The temporary message ID
	Reason           string `json:"reason"`                  // Failure reason
	CorrelationID    string `json:"correlationId,omitempty"` // For tracing the original command
}

// ConnectionStatusPayload is the payload for worker connection status events.
// Sent by the orchestrator when a worker's status changes (e.g., crash, restart, recovery).
type ConnectionStatusPayload struct {
	Status string `json:"status"` // "error", "failed", "connecting", "connected"
	Reason string `json:"reason"` // Human-readable reason for the status change
}

// HistorySyncPagePayload reports the result of an on-demand history request
// after every message in the returned conversation page has been durably
// queued ahead of this event.
type HistorySyncPagePayload struct {
	ChatJID      string `json:"chatJid"`
	MessageCount int    `json:"messageCount"`
	Status       string `json:"status"`
}

type LabelsPayload struct {
	Labels []struct {
		LabelID      string `json:"labelId"`
		Name         string `json:"name"`
		Color        int32  `json:"color"`
		PredefinedID int32  `json:"predefinedId"`
	} `json:"labels"`
}

type CatalogsPayload struct {
	Catalogs []map[string]interface{} `json:"catalogs"`
}

type CatalogProductsPayload struct {
	CatalogID string                   `json:"catalogId"`
	Products  []map[string]interface{} `json:"products"`
}

type CommandResultPayload struct {
	CommandID   string `json:"commandId"`
	CommandType string `json:"commandType"`
	Success     bool   `json:"success"`
	// Outcome says WHAT happened, where Success only says whether everything
	// went right. The two differ for a change that WhatsApp applied but whose
	// result could not be brought back - reporting that as a plain failure
	// invites someone to redo an action that already took effect.
	Outcome string `json:"outcome,omitempty"`
	Error   string `json:"error,omitempty"`
}

// DownloadRequest is the payload for on-demand media download requests.
type DownloadRequest struct {
	MessageID     string `json:"messageId"`
	DirectPath    string `json:"directPath"`
	MediaKey      []byte `json:"mediaKey"`      // Base64 encoded
	FileSHA256    []byte `json:"fileSha256"`    // Base64 encoded
	FileEncSHA256 []byte `json:"fileEncSha256"` // Base64 encoded
	MediaType     string `json:"mediaType"`
	FileName      string `json:"fileName,omitempty"`
}

// DownloadResponsePayload is the payload for media download response events.
type DownloadResponsePayload struct {
	MessageID string `json:"messageId"`
	MediaURL  string `json:"mediaUrl,omitempty"`
	MediaSize int64  `json:"mediaSize,omitempty"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

// SpawnWorkerCommand requests spawning a new WhatsApp worker process.
type SpawnWorkerCommand struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
	TenantSchema string `json:"tenant_schema"`
	DatabaseURL  string `json:"database_url"`
}

// KillWorkerCommand requests termination of a WhatsApp worker process.
type KillWorkerCommand struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
	TenantSchema string `json:"tenant_schema,omitempty"`
	Reason       string `json:"reason,omitempty"`
	Unlink       bool   `json:"unlink,omitempty"`
}

// WorkerStatusCommand requests the status of a WhatsApp worker.
type WorkerStatusCommand struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
}

// WorkerStatusResponse contains the status information of a worker.
type WorkerStatusResponse struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	Status       string    `json:"status"`
	ConnectedAt  time.Time `json:"connected_at,omitempty"`
	LastActivity time.Time `json:"last_activity,omitempty"`
	PID          int       `json:"pid,omitempty"`
	Error        string    `json:"error,omitempty"`
}

// BlockContactCommand requests blocking/unblocking a contact.
type BlockContactCommand struct {
	Type         string `json:"type"` // "block_contact" or "unblock_contact"
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
	ContactJID   string `json:"contact_jid"`
}

// CommandEnvelope wraps any command with its type for routing.
type CommandEnvelope struct {
	Type    string `json:"type"`
	Payload []byte `json:"payload"`
}

// Internal event types for message processing (snake_case for internal use).

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

// MessageEvent represents an incoming WhatsApp message (internal use).
type MessageEvent struct {
	MessageID         string    `json:"message_id"`
	From              string    `json:"from"`
	To                string    `json:"to"`
	FromMe            bool      `json:"from_me"`
	Type              string    `json:"type"` // "text", "image", "video", "audio", "document"
	Status            string    `json:"status,omitempty"`
	Content           string    `json:"content,omitempty"`
	MediaURL          string    `json:"media_url,omitempty"`
	MediaType         string    `json:"media_type,omitempty"`
	MediaSize         int64     `json:"media_size,omitempty"`
	FileName          string    `json:"file_name,omitempty"`
	Caption           string    `json:"caption,omitempty"`
	IsGroup           bool      `json:"is_group"`
	GroupID           string    `json:"group_id,omitempty"`
	SenderName        string    `json:"sender_name,omitempty"`
	ProtocolSenderJID string    `json:"protocol_sender_jid,omitempty"`
	QuotedMessageID   string    `json:"quoted_message_id,omitempty"`
	Timestamp         time.Time `json:"timestamp"`
	// Deferred media download fields
	MediaDirectPath    string `json:"media_direct_path,omitempty"`
	MediaKey           []byte `json:"media_key,omitempty"`
	MediaFileSHA256    []byte `json:"media_file_sha256,omitempty"`
	MediaFileEncSHA256 []byte `json:"media_file_enc_sha256,omitempty"`
	IsHistorySync      bool   `json:"is_history_sync,omitempty"`
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

// TypingEvent represents a typing indicator event (internal use).
type TypingEvent struct {
	From      string    `json:"from"`
	ChatJID   string    `json:"chat_jid"`
	IsTyping  bool      `json:"is_typing"`
	MediaType string    `json:"media_type,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// ReactionEvent represents a reaction event (internal use).
type ReactionEvent struct {
	MessageID string    `json:"message_id"`
	From      string    `json:"from"`
	ChatJID   string    `json:"chat_jid"`
	Emoji     string    `json:"emoji"`
	Timestamp time.Time `json:"timestamp"`
}
