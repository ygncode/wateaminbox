package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
	internaltypes "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

const (
	eventPublishMaxAttempts  = 5
	eventPublishBaseDelay    = 250 * time.Millisecond
	eventOutboxPollInterval  = time.Second
	eventOutboxBatchSize     = 100
	runtimeHeartbeatInterval = 15 * time.Second
)

type jetStreamPublisher interface {
	Publish(subject string, data []byte, opts ...nats.PubOpt) (*nats.PubAck, error)
}

type corePublisher interface {
	Publish(subject string, data []byte) error
	FlushTimeout(timeout time.Duration) error
}

type PendingEvent struct {
	ID      string
	Subject string
	Payload []byte
}

// EventOutbox persists worker events before they cross the NATS boundary.
// Implementations must scope entries to the worker's connection.
type EventOutbox interface {
	SavePendingEvent(ctx context.Context, event PendingEvent) error
	ListPendingEvents(ctx context.Context, limit int) ([]PendingEvent, error)
	MarkEventPublished(ctx context.Context, eventID string) error
	RecordEventPublishFailure(ctx context.Context, eventID, errorMessage string) error
}

// Stream and subject constants - re-exported from shared module
const (
	StreamName = sharednats.StreamEvents

	SubjectQR               = sharednats.SubjectQR
	SubjectStatus           = sharednats.SubjectStatus
	SubjectMessage          = sharednats.SubjectMessage
	SubjectReceipt          = sharednats.SubjectReceipt
	SubjectPresence         = sharednats.SubjectPresence
	SubjectContact          = sharednats.SubjectContact
	SubjectProfilePicture   = sharednats.SubjectProfilePicture
	SubjectMessageRevoke    = sharednats.SubjectMessageRevoke
	SubjectSendConfirmation = sharednats.SubjectSendConfirm
	SubjectTyping           = sharednats.SubjectTyping
	SubjectReaction         = sharednats.SubjectReaction
	SubjectSyncStatus       = sharednats.SubjectSyncStatus
	SubjectHistorySyncPage  = sharednats.SubjectHistorySyncPage
	SubjectLabels           = sharednats.SubjectLabels
	SubjectCatalogs         = sharednats.SubjectCatalogs
	SubjectCatalogProducts  = sharednats.SubjectCatalogProducts
	SubjectCommandResult    = sharednats.SubjectCommandResult
	SubjectDownloadRequest  = sharednats.SubjectDownloadRequest
	SubjectDownloadResponse = sharednats.SubjectDownloadResponse
	SubjectGroup            = sharednats.SubjectGroup
)

// Type aliases for shared types (for backwards compatibility within this package)
type (
	WhatsAppEvent           = sharednats.WhatsAppEvent
	QRPayload               = sharednats.QRPayload
	ConnectionPayload       = sharednats.ConnectionPayload
	MessagePayload          = sharednats.MessagePayload
	MessageRevokePayload    = sharednats.MessageRevokePayload
	ReceiptPayload          = sharednats.ReceiptPayload
	PresencePayload         = sharednats.PresencePayload
	TypingPayload           = sharednats.TypingPayload
	ContactPayload          = sharednats.ContactPayload
	GroupParticipantPayload = sharednats.GroupParticipantPayload
	GroupPayload            = sharednats.GroupPayload
	GroupSnapshotPayload    = sharednats.GroupSnapshotPayload
	GroupJoinRequestPayload = sharednats.GroupJoinRequestPayload
	ProfilePicturePayload   = sharednats.ProfilePicturePayload
	SendConfirmationPayload = sharednats.SendConfirmationPayload
	SendFailedPayload       = sharednats.SendFailedPayload
	ReactionPayload         = sharednats.ReactionPayload
	SyncStatusPayload       = sharednats.SyncStatusPayload
	DownloadRequest         = sharednats.DownloadRequest
	DownloadResponsePayload = sharednats.DownloadResponsePayload
	// Internal event types
	QRCodeEvent           = sharednats.QRCodeEvent
	ConnectionStatusEvent = sharednats.ConnectionStatusEvent
	MessageEvent          = sharednats.MessageEvent
	ReceiptEvent          = sharednats.ReceiptEvent
	PresenceEvent         = sharednats.PresenceEvent
	TypingEvent           = sharednats.TypingEvent
	ReactionEvent         = sharednats.ReactionEvent
)

// Publisher handles publishing events to NATS.
type Publisher struct {
	nc               *nats.Conn
	js               jetStreamPublisher
	companyID        string
	connectionID     string
	launchID         string
	artifactVersion  string
	readinessToken   string
	core             corePublisher
	runtimeConnected atomic.Bool
	runtimeMu        sync.Mutex // orders heartbeat/connected/disconnected signals
	runtimeTimestamp time.Time  // strictly monotonic within this launch/token
	outbox           EventOutbox
	ctx              context.Context
	cancel           context.CancelFunc
	wg               sync.WaitGroup
}

// PublisherConfig holds configuration for the publisher.
type PublisherConfig struct {
	NATSURL         string
	CompanyID       string
	ConnectionID    string
	LaunchID        string
	ArtifactVersion string
	ReadinessToken  string
	EventOutbox     EventOutbox
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

	// Stream and durable API-consumer provisioning belongs to the privileged
	// orchestrator startup. Restricted workers only publish and consume.

	ctx, cancel := context.WithCancel(context.Background())
	publisher := &Publisher{
		nc:              nc,
		js:              js,
		core:            nc,
		companyID:       cfg.CompanyID,
		connectionID:    cfg.ConnectionID,
		launchID:        cfg.LaunchID,
		artifactVersion: cfg.ArtifactVersion,
		readinessToken:  cfg.ReadinessToken,
		outbox:          cfg.EventOutbox,
		ctx:             ctx,
		cancel:          cancel,
	}
	if publisher.outbox != nil {
		publisher.wg.Add(1)
		go publisher.runEventOutbox()
	}
	// Re-announcement lets a replacement orchestrator recover verification of
	// this healthy generation after losing its transient subscription state.
	publisher.wg.Add(1)
	go publisher.runRuntimeHeartbeat(runtimeHeartbeatInterval)
	return publisher, nil
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

// PublishConnectionStatus preserves the durable API event and additionally
// emits transient runtime state for this exact worker generation.
func (p *Publisher) PublishConnectionStatus(status, reason, phoneNumber, jid string) error {
	var runtimeErr error
	if status == "disconnected" || status == "logged_out" {
		// Serialize with the whole heartbeat batch and publish the negative edge
		// first. A heartbeat that began earlier finishes before this signal; none
		// can begin after runtimeConnected becomes false.
		p.runtimeMu.Lock()
		p.runtimeConnected.Store(false)
		runtimeErr = p.publishWorkerRuntimeStatus(sharednats.WorkerRuntimeStatusDisconnected, reason)
		p.runtimeMu.Unlock()
	}

	event := WhatsAppEvent{
		Type:         status, // "connected" or "disconnected"
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ConnectionPayload{
			PhoneNumber: phoneNumber,
			JID:         jid,
			Reason:      reason,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectStatus, p.companyID, p.connectionID)
	if err := p.publish(subject, event); err != nil {
		return err
	}
	if runtimeErr != nil {
		return runtimeErr
	}

	switch status {
	case "connected":
		p.runtimeMu.Lock()
		defer p.runtimeMu.Unlock()
		p.runtimeConnected.Store(true)
		if err := p.publishWorkerRuntimeStatus(sharednats.WorkerRuntimeStatusConnected, reason); err != nil {
			return err
		}
		// A whatsmeow Connected event is emitted only after authentication.
		return p.publishWorkerRuntimeStatus(sharednats.WorkerRuntimeStatusAuthenticated, reason)
	case "paired":
		p.runtimeMu.Lock()
		defer p.runtimeMu.Unlock()
		return p.publishWorkerRuntimeStatus(sharednats.WorkerRuntimeStatusAuthenticated, reason)
	default:
		return nil
	}
}

func (p *Publisher) runRuntimeHeartbeat(interval time.Duration) {
	defer p.wg.Done()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.runtimeMu.Lock()
			if !p.runtimeConnected.Load() {
				p.runtimeMu.Unlock()
				continue
			}
			// Re-announce every verifier prerequisite as one ordered batch. A
			// disconnect cannot interleave and then be overwritten by stale facts.
			for _, status := range []string{
				sharednats.WorkerRuntimeStatusProcessReady,
				sharednats.WorkerRuntimeStatusConnected,
				sharednats.WorkerRuntimeStatusAuthenticated,
			} {
				if err := p.publishWorkerRuntimeStatus(status, "heartbeat"); err != nil && p.ctx.Err() == nil {
					log.Printf("Failed to publish worker runtime %s heartbeat: %v", status, err)
				}
			}
			p.runtimeMu.Unlock()
		}
	}
}

// PublishWorkerRuntimeStatus publishes a core-NATS operational signal. It is
// intentionally neither persisted in the worker outbox nor sent to JetStream.
func (p *Publisher) PublishWorkerRuntimeStatus(status, reason string) error {
	p.runtimeMu.Lock()
	defer p.runtimeMu.Unlock()
	return p.publishWorkerRuntimeStatus(status, reason)
}

func (p *Publisher) publishWorkerRuntimeStatus(status, reason string) error {
	if p.core == nil {
		return fmt.Errorf("worker runtime publisher is unavailable")
	}
	if !validRuntimeSubjectToken(p.companyID) ||
		!validRuntimeSubjectToken(p.connectionID) ||
		!validRuntimeSubjectToken(p.launchID) {
		return fmt.Errorf("worker runtime identity must contain non-empty NATS subject tokens")
	}
	if p.artifactVersion == "" {
		return fmt.Errorf("worker artifact version is required")
	}
	if p.readinessToken == "" {
		return fmt.Errorf("worker readiness token is required")
	}
	switch status {
	case sharednats.WorkerRuntimeStatusProcessReady,
		sharednats.WorkerRuntimeStatusConnected,
		sharednats.WorkerRuntimeStatusAuthenticated,
		sharednats.WorkerRuntimeStatusDisconnected:
	default:
		return fmt.Errorf("unsupported worker runtime status %q", status)
	}

	timestamp := time.Now().UTC()
	if !timestamp.After(p.runtimeTimestamp) {
		timestamp = p.runtimeTimestamp.Add(time.Nanosecond)
	}
	p.runtimeTimestamp = timestamp
	signal := sharednats.WorkerRuntimeStatus{
		Status:          status,
		CompanyID:       p.companyID,
		ConnectionID:    p.connectionID,
		LaunchID:        p.launchID,
		ArtifactVersion: p.artifactVersion,
		Reason:          reason,
		Timestamp:       timestamp.Format(time.RFC3339Nano),
	}
	signature, err := sharednats.SignWorkerRuntimeStatus(signal, p.readinessToken)
	if err != nil {
		return fmt.Errorf("sign worker runtime status: %w", err)
	}
	signal.Signature = signature
	data, err := json.Marshal(signal)
	if err != nil {
		return fmt.Errorf("marshal worker runtime status: %w", err)
	}
	subject := fmt.Sprintf(
		sharednats.SubjectWorkerRuntimeStatus,
		p.companyID,
		p.connectionID,
		p.launchID,
	)
	if err = p.core.Publish(subject, data); err != nil {
		return fmt.Errorf("publish worker runtime status: %w", err)
	}
	if err = p.core.FlushTimeout(2 * time.Second); err != nil {
		return fmt.Errorf("flush worker runtime status: %w", err)
	}
	return nil
}

func validRuntimeSubjectToken(value string) bool {
	return value != "" && !strings.ContainsAny(value, ".*> \t\r\n")
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
			MessageID:          msg.MessageID,
			From:               msg.From,
			To:                 msg.To,
			FromMe:             msg.FromMe,
			Content:            content,
			MessageType:        msg.Type,
			Status:             msg.Status,
			Timestamp:          msg.Timestamp.Format(time.RFC3339),
			MediaURL:           msg.MediaURL,
			QuotedMessageID:    msg.QuotedMessageID,
			IsGroup:            msg.IsGroup,
			GroupID:            msg.GroupID,
			SenderName:         msg.SenderName,
			ProtocolSenderJID:  msg.ProtocolSenderJID,
			Caption:            msg.Caption,
			FileName:           msg.FileName,
			MediaType:          msg.MediaType,
			MediaSize:          msg.MediaSize,
			MediaDirectPath:    msg.MediaDirectPath,
			MediaKey:           msg.MediaKey,
			MediaFileSHA256:    msg.MediaFileSHA256,
			MediaFileEncSHA256: msg.MediaFileEncSHA256,
			IsHistorySync:      msg.IsHistorySync,
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

// PublishTyping publishes a typing indicator event.
func (p *Publisher) PublishTyping(typing TypingEvent) error {
	if typing.Timestamp.IsZero() {
		typing.Timestamp = time.Now()
	}

	event := WhatsAppEvent{
		Type:         "typing",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: TypingPayload{
			From:      typing.From,
			ChatJID:   typing.ChatJID,
			IsTyping:  typing.IsTyping,
			MediaType: typing.MediaType,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectTyping, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishContact publishes a contact sync event.
func (p *Publisher) PublishContact(jid, name, displayName, description string, isGroup bool, unreadCount int, participants []GroupParticipantPayload, profilePictureURL string) error {
	var participantCount *int
	if len(participants) > 0 {
		count := len(participants)
		participantCount = &count
	}
	event := WhatsAppEvent{
		Type:         "contact",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ContactPayload{
			JID:               jid,
			Name:              name,
			DisplayName:       displayName,
			Description:       description,
			IsGroup:           isGroup,
			UnreadCount:       &unreadCount,
			Participants:      participants,
			ParticipantCount:  participantCount,
			ProfilePictureURL: profilePictureURL,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectContact, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// publishGroup emits a group administration event. Group state reaches the API
// exclusively through this subject, so the API never has to infer a group
// change from a command acknowledgement.
func (p *Publisher) publishGroup(payload GroupPayload) error {
	event := WhatsAppEvent{
		Type:         sharednats.EventTypeGroup,
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload:      payload,
		Timestamp:    time.Now().Format(time.RFC3339),
	}
	subject := fmt.Sprintf(SubjectGroup, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishGroupSnapshot publishes WhatsApp's current view of a group. `action`
// is either a plain snapshot or the snapshot of a group this account created.
func (p *Publisher) PublishGroupSnapshot(commandID, action string, snapshot internaltypes.GroupSnapshot) error {
	return p.publishGroup(GroupPayload{
		Action:    action,
		JID:       snapshot.JID,
		CommandID: commandID,
		Snapshot:  groupSnapshotPayload(snapshot),
	})
}

// PublishGroupLeft reports that this account has left a group. It records the
// end of a membership, never the deletion of a group - WhatsApp keeps the group
// running for its remaining members.
func (p *Publisher) PublishGroupLeft(commandID, groupJID string) error {
	return p.publishGroup(GroupPayload{
		Action:    sharednats.GroupActionLeft,
		JID:       groupJID,
		CommandID: commandID,
	})
}

// PublishGroupInviteLink publishes the invite link WhatsApp returned.
func (p *Publisher) PublishGroupInviteLink(commandID, groupJID, inviteLink string) error {
	return p.publishGroup(GroupPayload{
		Action:     sharednats.GroupActionInviteLink,
		JID:        groupJID,
		CommandID:  commandID,
		InviteLink: inviteLink,
	})
}

// PublishGroupJoinRequests publishes the pending membership approval requests.
//
// An empty list is meaningful - it says nobody is waiting - and is published as
// such. The field itself is omitted from the JSON when empty, which the API
// reads back as "no requests" rather than "unchanged"; the fetch timestamp it
// records separately is what distinguishes an empty answer from never asking.
func (p *Publisher) PublishGroupJoinRequests(commandID, groupJID string, requests []internaltypes.GroupJoinRequest) error {
	payload := make([]GroupJoinRequestPayload, 0, len(requests))
	for _, request := range requests {
		entry := GroupJoinRequestPayload{JID: request.JID}
		if !request.RequestedAt.IsZero() {
			entry.RequestedAt = request.RequestedAt.UTC().Format(time.RFC3339)
		}
		payload = append(payload, entry)
	}
	return p.publishGroup(GroupPayload{
		Action:       sharednats.GroupActionJoinRequests,
		JID:          groupJID,
		CommandID:    commandID,
		JoinRequests: payload,
	})
}

func groupSnapshotPayload(snapshot internaltypes.GroupSnapshot) *GroupSnapshotPayload {
	participants := make([]GroupParticipantPayload, 0, len(snapshot.Participants))
	for _, participant := range snapshot.Participants {
		participants = append(participants, GroupParticipantPayload{
			JID:     participant.JID,
			IsAdmin: participant.IsAdmin,
		})
	}
	return &GroupSnapshotPayload{
		JID:                    snapshot.JID,
		Name:                   snapshot.Name,
		Description:            snapshot.Description,
		OwnerJID:               snapshot.OwnerJID,
		Participants:           participants,
		ParticipantCount:       snapshot.ParticipantCount,
		IsAnnounce:             snapshot.IsAnnounce,
		IsLocked:               snapshot.IsLocked,
		IsEphemeral:            snapshot.IsEphemeral,
		DisappearingTimer:      snapshot.DisappearingTimer,
		IsJoinApprovalRequired: snapshot.IsJoinApprovalRequired,
		MemberAddMode:          snapshot.MemberAddMode,
		IsMember:               snapshot.IsMember,
	}
}

// PublishContactName publishes names learned from WhatsApp's contact and push-name stores.
// NameOnly prevents the API from creating chats for address-book entries that have no conversation.
func (p *Publisher) PublishContactName(jid, firstName, fullName, pushName, businessName string) error {
	event := WhatsAppEvent{
		Type:         "contact",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ContactPayload{
			JID:          jid,
			FirstName:    firstName,
			FullName:     fullName,
			PushName:     pushName,
			BusinessName: businessName,
			NameOnly:     true,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectContact, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishProfilePicture publishes a profile picture update event.
func (p *Publisher) PublishProfilePicture(jid, profilePictureURL string, remove bool, timestamp time.Time) error {
	event := WhatsAppEvent{
		Type:         "profile_picture",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ProfilePicturePayload{
			JID:               jid,
			ProfilePictureURL: profilePictureURL,
			Timestamp:         timestamp.Format(time.RFC3339),
			Remove:            remove,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectProfilePicture, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishMessageRevoke publishes a message revocation event.
func (p *Publisher) PublishMessageRevoke(messageID, from, to string, timestamp time.Time) error {
	event := WhatsAppEvent{
		Type:         "message_revoke",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: MessageRevokePayload{
			MessageID: messageID,
			From:      from,
			To:        to,
			Timestamp: timestamp.Format(time.RFC3339),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectMessageRevoke, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishSendConfirmation publishes a send confirmation event.
// This maps a pending message ID to the real WhatsApp message ID.
func (p *Publisher) PublishSendConfirmation(pendingMessageID, messageID string, timestamp time.Time, correlationID string) error {
	event := WhatsAppEvent{
		Type:          "send_confirmation",
		CompanyID:     p.companyID,
		ConnectionID:  p.connectionID,
		CorrelationID: correlationID,
		Payload: SendConfirmationPayload{
			PendingMessageID: pendingMessageID,
			MessageID:        messageID,
			Timestamp:        timestamp.Format(time.RFC3339),
			CorrelationID:    correlationID,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectSendConfirmation, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishSendFailed publishes a send failure event.
// This is called when a message fails to send after all retry attempts.
func (p *Publisher) PublishSendFailed(pendingMessageID, reason string, correlationID string) error {
	event := WhatsAppEvent{
		Type:          sharednats.EventTypeSendFailed,
		CompanyID:     p.companyID,
		ConnectionID:  p.connectionID,
		CorrelationID: correlationID,
		Payload: SendFailedPayload{
			PendingMessageID: pendingMessageID,
			Reason:           reason,
			CorrelationID:    correlationID,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	// Use the same subject pattern as send_confirmation
	subject := fmt.Sprintf(SubjectSendConfirmation, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishReaction publishes a message reaction event.
func (p *Publisher) PublishReaction(messageID, from, chatJID, emoji string, timestamp time.Time) error {
	event := WhatsAppEvent{
		Type:         "reaction",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: ReactionPayload{
			MessageID: messageID,
			From:      from,
			ChatJID:   chatJID,
			Emoji:     emoji,
			Timestamp: timestamp.Format(time.RFC3339),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectReaction, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishDownloadResponse publishes a media download response event.
func (p *Publisher) PublishDownloadResponse(messageID, mediaURL string, mediaSize int64, success bool, errMsg string) error {
	event := WhatsAppEvent{
		Type:         "download_response",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: DownloadResponsePayload{
			MessageID: messageID,
			MediaURL:  mediaURL,
			MediaSize: mediaSize,
			Success:   success,
			Error:     errMsg,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectDownloadResponse, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

func publishEventWithRetry(
	js jetStreamPublisher,
	subject string,
	data []byte,
	eventID string,
) error {
	var lastErr error
	var opts []nats.PubOpt
	if eventID != "" {
		opts = append(opts, nats.MsgId(eventID))
	}
	for attempt := 1; attempt <= eventPublishMaxAttempts; attempt++ {
		if _, err := js.Publish(subject, data, opts...); err == nil {
			return nil
		} else {
			lastErr = err
		}

		if attempt == eventPublishMaxAttempts {
			break
		}
		delay := eventPublishBaseDelay * time.Duration(1<<uint(attempt-1))
		log.Printf(
			"Failed to publish event to %s (attempt %d/%d): %v; retrying in %v",
			subject,
			attempt,
			eventPublishMaxAttempts,
			lastErr,
			delay,
		)
		time.Sleep(delay)
	}
	return fmt.Errorf(
		"failed to publish to %s after %d attempts: %w",
		subject,
		eventPublishMaxAttempts,
		lastErr,
	)
}

func (p *Publisher) publishPendingEvent(event PendingEvent) error {
	if err := publishEventWithRetry(
		p.js,
		event.Subject,
		event.Payload,
		event.ID,
	); err != nil {
		_ = p.outbox.RecordEventPublishFailure(
			p.ctx,
			event.ID,
			err.Error(),
		)
		return err
	}
	if err := p.outbox.MarkEventPublished(p.ctx, event.ID); err != nil {
		return fmt.Errorf("mark worker event %s published: %w", event.ID, err)
	}
	return nil
}

func (p *Publisher) flushPendingEvents() {
	events, err := p.outbox.ListPendingEvents(p.ctx, eventOutboxBatchSize)
	if err != nil {
		if p.ctx.Err() == nil {
			log.Printf("Failed to list pending worker events: %v", err)
		}
		return
	}
	for _, event := range events {
		if p.ctx.Err() != nil {
			return
		}
		if err = p.publishPendingEvent(event); err != nil {
			log.Printf("Failed to replay worker event %s: %v", event.ID, err)
		}
	}
}

func (p *Publisher) runEventOutbox() {
	defer p.wg.Done()
	p.flushPendingEvents()
	ticker := time.NewTicker(eventOutboxPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.flushPendingEvents()
		}
	}
}

func shouldPersistEventSubject(subject string) bool {
	return !strings.HasSuffix(subject, ".qr") &&
		!strings.HasSuffix(subject, ".presence") &&
		!strings.HasSuffix(subject, ".typing")
}

// publish marshals the event and publishes it to the specified subject. The
// event is written to PostgreSQL first so an extended NATS outage or worker
// restart cannot lose it. JetStream message IDs deduplicate replay after a
// publish succeeds but the outbox deletion fails.
func (p *Publisher) publish(subject string, event interface{}) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	if p.outbox == nil || !shouldPersistEventSubject(subject) {
		return publishEventWithRetry(p.js, subject, data, "")
	}

	pending := PendingEvent{
		ID:      uuid.NewString(),
		Subject: subject,
		Payload: data,
	}
	if err = p.outbox.SavePendingEvent(p.ctx, pending); err != nil {
		return fmt.Errorf("persist worker event before publish: %w", err)
	}
	if err = p.publishPendingEvent(pending); err != nil {
		// Persistence is the success boundary. The background flusher owns
		// delivery after this point, including across worker restarts.
		log.Printf("Worker event %s queued for replay after publish failure: %v", pending.ID, err)
		return nil
	}

	log.Printf("Published event to %s", subject)
	return nil
}

// PublishSyncStatus publishes a sync status event.
func (p *Publisher) PublishSyncStatus(status string, messageCount int, conversations int) error {
	event := WhatsAppEvent{
		Type:         "sync_status",
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: SyncStatusPayload{
			Status:        status,
			MessageCount:  messageCount,
			Conversations: conversations,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	subject := fmt.Sprintf(SubjectSyncStatus, p.companyID, p.connectionID)
	return p.publish(subject, event)
}

// PublishHistorySyncPage marks one on-demand conversation page as imported.
// It is persisted in the worker outbox, so browsers can safely fetch the new
// database page after the API handles this event.
func (p *Publisher) PublishHistorySyncPage(chatJID string, messageCount int, status string) error {
	event := WhatsAppEvent{
		Type:         sharednats.EventTypeHistorySyncPage,
		CompanyID:    p.companyID,
		ConnectionID: p.connectionID,
		Payload: sharednats.HistorySyncPagePayload{
			ChatJID:      chatJID,
			MessageCount: messageCount,
			Status:       status,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}
	return p.publish(
		fmt.Sprintf(SubjectHistorySyncPage, p.companyID, p.connectionID),
		event,
	)
}

func labelColorHex(color int32) string {
	colors := []string{"#00a884", "#ffa500", "#fed859", "#a855f7", "#3b82f6", "#ec4899", "#14b8a6", "#ef4444", "#6b7280", "#38bdf8", "#22c55e", "#a16207", "#06b6d4", "#d946ef", "#84cc16", "#1e40af", "#f43f5e", "#f59e0b", "#6366f1", "#475569"}
	if color >= 0 && int(color) < len(colors) {
		return colors[color]
	}
	return ""
}

func (p *Publisher) PublishLabels(labels []internaltypes.WhatsAppLabel) error {
	items := make([]map[string]interface{}, 0, len(labels))
	for _, label := range labels {
		items = append(items, map[string]interface{}{
			"labelId": label.ID, "name": label.Name, "color": labelColorHex(label.Color), "predefinedId": label.PredefinedID,
		})
	}
	event := WhatsAppEvent{
		Type: sharednats.EventTypeLabels, CompanyID: p.companyID, ConnectionID: p.connectionID,
		Payload: map[string]interface{}{"labels": items}, Timestamp: time.Now().Format(time.RFC3339),
	}
	return p.publish(fmt.Sprintf(SubjectLabels, p.companyID, p.connectionID), event)
}

func catalogMap(catalog internaltypes.Catalog) map[string]interface{} {
	return map[string]interface{}{
		"catalogId": catalog.ID, "name": catalog.Name, "description": catalog.Description,
		"currency": catalog.Currency, "businessJid": "", "productCount": len(catalog.Products),
	}
}

func productMaps(products []internaltypes.Product) []map[string]interface{} {
	items := make([]map[string]interface{}, 0, len(products))
	for _, product := range products {
		items = append(items, map[string]interface{}{
			"productId": product.ID, "name": product.Name, "description": product.Description,
			"price": product.Price, "currency": product.Currency, "imageUrls": product.ImageURLs,
			"sku": product.SKU, "availability": product.Availability, "url": product.URL,
			"retailerId": product.RetailerID,
		})
	}
	return items
}

func (p *Publisher) PublishCatalog(catalog internaltypes.Catalog) error {
	event := WhatsAppEvent{
		Type: sharednats.EventTypeCatalogs, CompanyID: p.companyID, ConnectionID: p.connectionID,
		Payload:   map[string]interface{}{"catalogs": []map[string]interface{}{catalogMap(catalog)}},
		Timestamp: time.Now().Format(time.RFC3339),
	}
	if err := p.publish(fmt.Sprintf(SubjectCatalogs, p.companyID, p.connectionID), event); err != nil {
		return err
	}
	productsEvent := WhatsAppEvent{
		Type: sharednats.EventTypeCatalogProducts, CompanyID: p.companyID, ConnectionID: p.connectionID,
		Payload:   map[string]interface{}{"catalogId": catalog.ID, "products": productMaps(catalog.Products)},
		Timestamp: time.Now().Format(time.RFC3339),
	}
	return p.publish(fmt.Sprintf(SubjectCatalogProducts, p.companyID, p.connectionID), productsEvent)
}

func (p *Publisher) PublishCommandResult(commandID, commandType string, success bool, outcome, errorMessage string) error {
	if outcome == "" {
		if success {
			outcome = sharednats.CommandOutcomeSucceeded
		} else {
			outcome = sharednats.CommandOutcomeFailed
		}
	}
	event := WhatsAppEvent{
		Type: sharednats.EventTypeCommandResult, CompanyID: p.companyID, ConnectionID: p.connectionID,
		Payload: sharednats.CommandResultPayload{
			CommandID:   commandID,
			CommandType: commandType,
			Success:     success,
			Outcome:     outcome,
			Error:       errorMessage,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}
	return p.publish(fmt.Sprintf(SubjectCommandResult, p.companyID, p.connectionID), event)
}

// Close closes the NATS connection.
func (p *Publisher) Close() {
	if p.cancel != nil {
		p.cancel()
		p.wg.Wait()
	}
	if p.nc != nil {
		_ = p.nc.Drain()
	}
}
