package nats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/ygncode-lab/whatsapp-web/services/shared/config"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

const (
	// Subject for sending messages (matches orchestrator's WHATSAPP_COMMANDS stream)
	// Format: WHATSAPP.commands.{companyId}.{connectionId}
	SubjectSend = "WHATSAPP.commands.%s.%s"

	// Stream name for commands
	CommandsStreamName = "WHATSAPP_COMMANDS"

	// Consumer name for message sending (includes connectionId for uniqueness)
	ConsumerSend = "whatsapp-send-%s-%s"

	commandSideEffectMaxAttempts = 3
	commandMaxDeliver            = 10

	// Retention for a command record whose outcome HAS been delivered. Its only
	// remaining job is to answer a redelivery of the same command, which the
	// commands stream caps at its own 24h MaxAge, so a day is already generous.
	processedCommandDeliveredRetention = 24 * time.Hour

	// Retention for a record whose outcome has NOT been delivered. This row is
	// the only thing standing between a redelivery and a repeated mutation -
	// deleting one too early re-creates a group, re-rotates an invite link, or
	// re-decides a join request. So it is deliberately far more conservative
	// than the delivered class: seven days is an order of magnitude past the
	// commands stream's 24h MaxAge, beyond which no redelivery can exist.
	processedCommandUndeliveredRetention = 7 * 24 * time.Hour

	// Pruning is bookkeeping, not a hot path.
	processedCommandPruneInterval = time.Hour
)

// commandType is used to extract the command type from a message for routing.
type commandType struct {
	Type string `json:"type"`
}

// BlockContactCommand represents a command to block or unblock a contact.
type BlockContactCommand struct {
	Type       string `json:"type"` // "block_contact" or "unblock_contact"
	ContactJID string `json:"contact_jid"`
}

// FetchProfilePictureCommand requests a cached public avatar for a participant.
type FetchProfilePictureCommand struct {
	Type string `json:"type"`
	JID  string `json:"jid"`
}

// SendMessageCommand represents a command to send a message.
type SendMessageCommand struct {
	MessageID            string   `json:"message_id"`
	To                   string   `json:"to"`               // JID of the recipient
	Type                 string   `json:"type"`             // "text", "image", "document", "video", "audio", "reaction"
	Content              string   `json:"content"`          // Text content or media URL
	Caption              string   `json:"caption"`          // Caption for media messages
	FileName             string   `json:"file_name"`        // File name for documents
	MimeType             string   `json:"mime_type"`        // MIME type for media
	MediaObjectKey       string   `json:"media_object_key"` // Tenant-scoped storage key
	MediaSize            int64    `json:"media_size"`
	MediaChecksum        string   `json:"media_checksum"`
	ReplyTo              string   `json:"reply_to"`        // Message ID to reply to
	ReplyToSender        string   `json:"reply_to_sender"` // JID of the sender of the quoted message
	MentionedJIDs        []string `json:"mentioned_jids,omitempty"`
	MediaAlbumID         string   `json:"media_album_id,omitempty"`
	MediaAlbumIndex      int      `json:"media_album_index,omitempty"`
	MediaAlbumCount      int      `json:"media_album_count,omitempty"`
	MediaAlbumImageCount int      `json:"media_album_image_count,omitempty"`
	MediaAlbumVideoCount int      `json:"media_album_video_count,omitempty"`
	// Reaction-specific fields
	TargetMessageID string `json:"target_message_id"` // Message ID to react to (for reaction type)
	Emoji           string `json:"emoji"`             // Emoji for reaction (for reaction type)
	FromMe          bool   `json:"from_me"`           // Whether the target message is from us (for reaction type)
	TargetSenderJID string `json:"target_sender_jid"` // Sender of the target message (required for incoming group messages)
	// Debugging/tracing
	CorrelationID string `json:"correlation_id,omitempty"` // For end-to-end message flow tracing
	CommandID     string `json:"command_id,omitempty"`
}

// MessageSender is the interface for sending WhatsApp messages.
const maxSendMediaBytes int64 = 50 * 1024 * 1024

type MediaObjectStore interface {
	DownloadMediaObject(ctx context.Context, key string, maxBytes int64, expectedChecksum string) ([]byte, error)
}

type CommandLedger interface {
	GetProcessedCommand(ctx context.Context, commandID string) ([]byte, bool, error)
	SaveProcessedCommand(ctx context.Context, commandID, commandType string, result []byte) error
	MarkCommandEventPublished(ctx context.Context, commandID string) error
}

// GroupCommandLedger is the extra ledger surface group commands need. It is a
// separate interface so the send path's CommandLedger stays untouched, and it
// is consulted through a type assertion - a ledger that does not implement it
// still works, just without published-state replay or retention.
type GroupCommandLedger interface {
	// GetProcessedCommandState additionally reports whether the outcome has
	// already been delivered, so a redelivery does not republish it.
	GetProcessedCommandState(ctx context.Context, commandID string) (result []byte, published bool, found bool, err error)
	// ScrubProcessedCommandResult drops the stored payload once it has been
	// delivered, keeping the row as a replay marker without its contents.
	ScrubProcessedCommandResult(ctx context.Context, commandID string) error
	// PruneProcessedCommands removes rows past their retention window.
	//
	// The two classes are bounded separately and must stay that way: a
	// delivered row is disposable once redelivery is impossible, while an
	// undelivered one is the guard that stops a mutation being repeated, so it
	// is kept far longer.
	PruneProcessedCommands(ctx context.Context, deliveredOlderThan, undeliveredOlderThan time.Duration) (int64, error)
}

type storedCommandResult struct {
	PendingMessageID string             `json:"pending_message_id"`
	CommandType      string             `json:"command_type"`
	Response         types.SendResponse `json:"response"`
	CorrelationID    string             `json:"correlation_id"`
	Failed           bool               `json:"failed,omitempty"`
	ErrorMessage     string             `json:"error_message,omitempty"`
}

type MessageSender interface {
	SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string, mentionedJIDs []string) (types.SendResponse, error)
	SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error)
	SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, targetSenderJID string, fromMe bool) (types.SendResponse, error)
}

type mediaAlbumSender interface {
	SendMediaAlbumMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string, album types.MediaAlbumContext) (types.SendResponse, error)
}

// ContactBlocker is the interface for blocking/unblocking contacts.
type ContactBlocker interface {
	BlockContact(ctx context.Context, jid string) error
	UnblockContact(ctx context.Context, jid string) error
}

// TypingSender is the interface for sending typing indicators.
type TypingSender interface {
	SendChatPresence(ctx context.Context, jid string, isTyping bool) error
}

type CommandExecutor interface {
	PostStatus(ctx context.Context, statusType, content, mediaURL string) (types.SendResponse, error)
	SyncLabels(ctx context.Context) ([]types.WhatsAppLabel, error)
	ApplyLabel(ctx context.Context, contactJID, labelID string, labeled bool) error
	SyncCatalog(ctx context.Context, catalogID string) (types.Catalog, error)
	RequestHistory(ctx context.Context, chatJID, oldestMessageID string, oldestFromMe bool, oldestTimestamp time.Time, count int) error
	GroupCommandExecutor
}

// GroupCommandExecutor covers the group administration surface WhatsApp
// supports. There is deliberately no delete/disband entry: WhatsApp has no such
// operation, and LeaveGroup only ends this account's own membership.
type GroupCommandExecutor interface {
	CreateGroup(ctx context.Context, name string, participantJIDs []string) (types.GroupSnapshot, error)
	UpdateGroupParticipants(ctx context.Context, groupJID string, participantJIDs []string, action string) ([]types.GroupParticipantResult, error)
	UpdateGroupSettings(ctx context.Context, groupJID string, update types.GroupSettingsUpdate) error
	LeaveGroup(ctx context.Context, groupJID string) error
	GetGroupInviteLink(ctx context.Context, groupJID string, reset bool) (string, error)
	GetGroupJoinRequests(ctx context.Context, groupJID string) ([]types.GroupJoinRequest, error)
	UpdateGroupJoinRequests(ctx context.Context, groupJID string, participantJIDs []string, action string) ([]types.GroupParticipantResult, error)
	GetGroupSnapshot(ctx context.Context, groupJID string) (types.GroupSnapshot, error)
}

// ProfilePictureFetcher fetches and stores a WhatsApp profile picture.
type ProfilePictureFetcher interface {
	FetchProfilePicture(jid string) (string, error)
}

// TypingCommand represents a command to send typing indicator.
type TypingCommand struct {
	Type string `json:"type"` // "typing_start" or "typing_stop"
	JID  string `json:"jid"`
}

type PostStatusCommand struct {
	Type       string `json:"type"`
	StatusType string `json:"status_type"`
	Content    string `json:"content"`
	MediaURL   string `json:"media_url"`
}

// GroupCommand is the wire shape for every group administration command.
//
// ParticipantJIDs is the current field; ParticipantJID is retained so a command
// enqueued by an older API build (still sitting in the outbox during a rolling
// deploy) keeps working instead of silently acting on nobody.
type GroupCommand struct {
	Type            string   `json:"type"`
	GroupJID        string   `json:"group_jid"`
	ParticipantJID  string   `json:"participant_jid,omitempty"`
	ParticipantJIDs []string `json:"participant_jids,omitempty"`
	Name            *string  `json:"name"`
	Description     *string  `json:"description"`
	// Group permissions. Nil means "leave this setting alone".
	IsAnnounce             *bool   `json:"is_announce,omitempty"`
	IsLocked               *bool   `json:"is_locked,omitempty"`
	IsJoinApprovalRequired *bool   `json:"is_join_approval_required,omitempty"`
	MemberAddMode          *string `json:"member_add_mode,omitempty"`
	// Reset revokes the existing invite link before returning a new one.
	Reset bool `json:"reset,omitempty"`
	// Decision on pending join requests: "approve" or "reject".
	Decision  string `json:"decision,omitempty"`
	CommandID string `json:"command_id,omitempty"`
}

// participants returns the participant list, accepting the single-participant
// shape older API builds produced.
func (c GroupCommand) participants() []string {
	if len(c.ParticipantJIDs) > 0 {
		return c.ParticipantJIDs
	}
	if c.ParticipantJID != "" {
		return []string{c.ParticipantJID}
	}
	return nil
}

func (c GroupCommand) settingsUpdate() types.GroupSettingsUpdate {
	return types.GroupSettingsUpdate{
		Name:                   c.Name,
		Description:            c.Description,
		IsAnnounce:             c.IsAnnounce,
		IsLocked:               c.IsLocked,
		IsJoinApprovalRequired: c.IsJoinApprovalRequired,
		MemberAddMode:          c.MemberAddMode,
	}
}

type LabelCommand struct {
	Type       string `json:"type"`
	LabelID    string `json:"label_id"`
	ContactJID string `json:"contact_jid"`
}

type CatalogCommand struct {
	Type      string `json:"type"`
	CatalogID string `json:"catalog_id"`
}

type RequestHistoryCommand struct {
	Type            string `json:"type"`
	ChatJID         string `json:"chat_jid"`
	OldestMessageID string `json:"oldest_message_id"`
	OldestFromMe    bool   `json:"oldest_from_me"`
	OldestTimestamp string `json:"oldest_timestamp"`
	Count           int    `json:"count"`
	CommandID       string `json:"command_id"`
}

// CommandEventPublisher publishes durable outcomes produced by commands.
// The interface keeps command execution independently testable from NATS.
type CommandEventPublisher interface {
	PublishSendConfirmation(pendingMessageID, messageID string, timestamp time.Time, correlationID string) error
	PublishSendFailed(pendingMessageID, errorMessage, correlationID string) error
	// PublishCommandResult reports a command's outcome. `outcome` is one of the
	// sharednats.CommandOutcome* constants and is what distinguishes "did not
	// happen" from "happened, but we could not read it back".
	PublishCommandResult(commandID, commandType string, success bool, outcome, errorMessage string) error
	PublishProfilePicture(contactJID, profilePictureURL string, remove bool, timestamp time.Time) error
	PublishLabels(labels []types.WhatsAppLabel) error
	PublishCatalog(catalog types.Catalog) error
	GroupEventPublisher
}

// GroupEventPublisher delivers WhatsApp-confirmed group state to the API. The
// API applies group changes only from these events, never from a command ack,
// so a command that WhatsApp rejected leaves the workspace unchanged.
type GroupEventPublisher interface {
	PublishGroupSnapshot(commandID, action string, snapshot types.GroupSnapshot) error
	PublishGroupLeft(commandID, groupJID string) error
	PublishGroupInviteLink(commandID, groupJID, inviteLink string) error
	PublishGroupJoinRequests(commandID, groupJID string, requests []types.GroupJoinRequest) error
}

// Subscriber handles subscribing to NATS command subjects.
type Subscriber struct {
	nc             *nats.Conn
	js             nats.JetStreamContext
	companyID      string
	connectionID   string
	sender         MessageSender
	blocker        ContactBlocker
	typingSender   TypingSender
	executor       CommandExecutor
	profileFetcher ProfilePictureFetcher
	publisher      CommandEventPublisher
	storage        MediaObjectStore
	ledger         CommandLedger
	sub            *nats.Subscription
	ctx            context.Context
	cancel         context.CancelFunc
}

// SubscriberConfig holds configuration for the subscriber.
type SubscriberConfig struct {
	NATSURL        string
	CompanyID      string
	ConnectionID   string
	Sender         MessageSender
	Blocker        ContactBlocker
	TypingSender   TypingSender
	Executor       CommandExecutor
	ProfileFetcher ProfilePictureFetcher
	Publisher      CommandEventPublisher
	Storage        MediaObjectStore
	Ledger         CommandLedger
}

// NewSubscriber creates a new NATS subscriber.
func NewSubscriber(cfg SubscriberConfig) (*Subscriber, error) {
	// Connect to NATS
	nc, err := nats.Connect(cfg.NATSURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(time.Second),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			if err != nil {
				log.Printf("NATS subscriber disconnected: %s", config.RedactErrorForURL(err, cfg.NATSURL))
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("NATS subscriber reconnected to %s", nc.ConnectedUrlRedacted())
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %s", config.RedactErrorForURL(err, cfg.NATSURL))
	}

	// Get JetStream context
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to get JetStream context: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Subscriber{
		nc:             nc,
		js:             js,
		companyID:      cfg.CompanyID,
		connectionID:   cfg.ConnectionID,
		sender:         cfg.Sender,
		blocker:        cfg.Blocker,
		typingSender:   cfg.TypingSender,
		executor:       cfg.Executor,
		profileFetcher: cfg.ProfileFetcher,
		publisher:      cfg.Publisher,
		storage:        cfg.Storage,
		ledger:         cfg.Ledger,
		ctx:            ctx,
		cancel:         cancel,
	}, nil
}

// Start begins listening for send commands.
func (s *Subscriber) Start() error {
	subject := fmt.Sprintf(SubjectSend, s.companyID, s.connectionID)
	consumerName := fmt.Sprintf(ConsumerSend, s.companyID, s.connectionID)

	// Ensure the consumer exists
	info, err := s.js.ConsumerInfo(CommandsStreamName, consumerName)
	if err != nil {
		if err == nats.ErrConsumerNotFound {
			_, err = s.js.AddConsumer(CommandsStreamName, &nats.ConsumerConfig{
				Durable:       consumerName,
				FilterSubject: subject,
				AckPolicy:     nats.AckExplicitPolicy,
				DeliverPolicy: nats.DeliverNewPolicy,
				MaxDeliver:    commandMaxDeliver,
				AckWait:       2 * time.Minute,
			})
			if err != nil {
				return fmt.Errorf("failed to create consumer: %w", err)
			}
			log.Printf("Created consumer: %s", consumerName)
		} else {
			return fmt.Errorf("failed to get consumer info: %w", err)
		}
	} else if info.Config.AckWait < 2*time.Minute || info.Config.MaxDeliver < commandMaxDeliver {
		config := info.Config
		config.AckWait = 2 * time.Minute
		config.MaxDeliver = commandMaxDeliver
		if _, err = s.js.UpdateConsumer(CommandsStreamName, &config); err != nil {
			return fmt.Errorf("failed to update consumer retry policy: %w", err)
		}
	}

	// Subscribe to the subject without broad stream-name discovery.
	sub, err := s.js.PullSubscribe(subject, consumerName, nats.BindStream(CommandsStreamName))
	if err != nil {
		return fmt.Errorf("failed to subscribe: %w", err)
	}
	s.sub = sub

	// Start processing messages in a goroutine
	go s.processMessages()
	go s.pruneProcessedCommands()

	log.Printf("Subscriber started for subject: %s", subject)
	return nil
}

// processMessages continuously fetches and processes messages.
func (s *Subscriber) processMessages() {
	// Add small delay to ensure consumer is ready
	time.Sleep(100 * time.Millisecond)

	consecutiveErrors := 0
	maxConsecutiveErrors := 5

	for {
		select {
		case <-s.ctx.Done():
			log.Println("Subscriber context cancelled, stopping")
			return
		default:
			// Fetch messages with a timeout
			msgs, err := s.sub.Fetch(10, nats.MaxWait(5*time.Second))
			if err != nil {
				if err == nats.ErrTimeout {
					consecutiveErrors = 0 // Reset on timeout (normal)
					continue
				}

				consecutiveErrors++
				log.Printf("Error fetching messages (%d/%d): %v", consecutiveErrors, maxConsecutiveErrors, err)

				// If we get too many consecutive errors, try to recreate subscription
				if consecutiveErrors >= maxConsecutiveErrors {
					log.Println("Too many consecutive errors, attempting to recreate subscription...")
					if err := s.recreateSubscription(); err != nil {
						log.Printf("Failed to recreate subscription: %v", err)
						time.Sleep(5 * time.Second)
					} else {
						consecutiveErrors = 0
						log.Println("Subscription recreated successfully")
					}
				} else {
					time.Sleep(time.Duration(consecutiveErrors) * time.Second)
				}
				continue
			}

			consecutiveErrors = 0 // Reset on success
			for _, msg := range msgs {
				s.handleCommand(msg)
			}
		}
	}
}

// handleCommand routes commands to the appropriate handler based on type.
func (s *Subscriber) handleCommand(msg *nats.Msg) {
	// Extract command type first
	var ct commandType
	if err := json.Unmarshal(msg.Data, &ct); err != nil {
		log.Printf("Failed to unmarshal command type: %v", err)
		msg.Nak()
		return
	}

	switch ct.Type {
	case "block_contact", "unblock_contact":
		s.handleBlockCommand(msg, ct.Type)
	case "typing_start", "typing_stop":
		s.handleTypingCommand(msg, ct.Type)
	case "fetch_profile_picture":
		s.handleFetchProfilePictureCommand(msg)
	case "post_status":
		s.handlePostStatusCommand(msg)
	case "group_create",
		"group_add_participants",
		"group_remove_participants",
		"group_promote_admin",
		"group_demote_admin",
		"group_remove_participant",
		"group_update_settings",
		"group_leave",
		"group_invite_link",
		"group_join_requests_fetch",
		"group_join_requests_update",
		"group_sync":
		s.handleGroupCommand(msg, ct.Type)
	case "sync_labels", "apply_label", "remove_label":
		s.handleLabelCommand(msg, ct.Type)
	case "sync_catalogs", "sync_catalog_products":
		s.handleCatalogCommand(msg, ct.Type)
	case "request_history":
		s.handleRequestHistoryCommand(msg)
	case "spawn", "kill", "status":
		// These commands are consumed by the orchestrator. A worker can also see
		// them because both consumers subscribe to its connection subject; ACK so
		// JetStream does not repeatedly redeliver a control-plane command to it.
		log.Printf("Ignoring orchestrator command: %s", ct.Type)
		msg.Ack()
	default:
		// Delegate to send command handler for all other types
		s.handleSendCommand(msg)
	}
}

func (s *Subscriber) handleRequestHistoryCommand(msg *nats.Msg) {
	var cmd RequestHistoryCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		s.retryCommand(msg, "request_history", err)
		return
	}
	if s.executor == nil {
		s.retryCommand(msg, cmd.Type, fmt.Errorf("command executor not configured"))
		return
	}
	timestamp, err := time.Parse(time.RFC3339Nano, cmd.OldestTimestamp)
	if err != nil {
		s.retryCommand(msg, cmd.Type, fmt.Errorf("invalid oldest message timestamp: %w", err))
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	if err = s.executor.RequestHistory(
		ctx,
		cmd.ChatJID,
		cmd.OldestMessageID,
		cmd.OldestFromMe,
		timestamp,
		cmd.Count,
	); err != nil {
		s.retryCommand(msg, cmd.Type, err)
		return
	}
	if s.publisher != nil && cmd.CommandID != "" {
		if err = s.publisher.PublishCommandResult(
			cmd.CommandID, cmd.Type, true, sharednats.CommandOutcomeSucceeded, "",
		); err != nil {
			s.retryCommand(msg, cmd.Type, err)
			return
		}
	}
	msg.Ack()
}

// recreateSubscription attempts to recreate the NATS subscription
func (s *Subscriber) recreateSubscription() error {
	subject := fmt.Sprintf(SubjectSend, s.companyID, s.connectionID)
	consumerName := fmt.Sprintf(ConsumerSend, s.companyID, s.connectionID)

	// Try to unsubscribe first
	if s.sub != nil {
		s.sub.Unsubscribe()
	}

	// Recreate the subscription without broad stream-name discovery.
	sub, err := s.js.PullSubscribe(subject, consumerName, nats.BindStream(CommandsStreamName))
	if err != nil {
		return fmt.Errorf("failed to recreate subscription: %w", err)
	}
	s.sub = sub
	return nil
}

func (s *Subscriber) publishStoredCommandResult(result storedCommandResult, commandID string) error {
	if s.publisher == nil {
		return fmt.Errorf("publisher is not configured")
	}
	var err error
	if result.Failed && result.CommandType == "reaction" {
		err = s.publisher.PublishCommandResult(
			commandID,
			result.CommandType,
			false,
			sharednats.CommandOutcomeFailed,
			result.ErrorMessage,
		)
	} else if result.Failed {
		err = s.publisher.PublishSendFailed(
			result.PendingMessageID,
			result.ErrorMessage,
			result.CorrelationID,
		)
	} else if result.CommandType == "reaction" {
		err = s.publisher.PublishCommandResult(
			commandID, result.CommandType, true, sharednats.CommandOutcomeSucceeded, "",
		)
	} else {
		err = s.publisher.PublishSendConfirmation(
			result.PendingMessageID,
			result.Response.ID,
			result.Response.Timestamp,
			result.CorrelationID,
		)
	}
	if err == nil && s.ledger != nil {
		err = s.ledger.MarkCommandEventPublished(s.ctx, commandID)
	}
	return err
}

func (s *Subscriber) persistCommandResult(commandID string, result storedCommandResult) error {
	if commandID == "" || s.ledger == nil {
		return nil
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal command result: %w", err)
	}
	if err = s.ledger.SaveProcessedCommand(
		s.ctx,
		commandID,
		result.CommandType,
		resultJSON,
	); err != nil {
		return fmt.Errorf("save command result: %w", err)
	}
	return nil
}

func (s *Subscriber) finishFailedSend(
	msg *nats.Msg,
	cmd SendMessageCommand,
	errorMessage string,
) {
	stored := storedCommandResult{
		PendingMessageID: cmd.MessageID,
		CommandType:      cmd.Type,
		CorrelationID:    cmd.CorrelationID,
		Failed:           true,
		ErrorMessage:     errorMessage,
	}
	if err := s.persistCommandResult(cmd.CommandID, stored); err != nil {
		log.Printf("[NATS] Failed to persist failed command result: %v", err)
		msg.Nak()
		return
	}
	if err := s.publishStoredCommandResult(stored, cmd.CommandID); err != nil {
		log.Printf("[NATS] Failed to publish failed command result: %v", err)
		msg.Nak()
		return
	}
	msg.Ack()
}

// handleSendCommand processes a send message command.
func (s *Subscriber) handleSendCommand(msg *nats.Msg) {
	var cmd SendMessageCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		log.Printf("Failed to unmarshal send command: %v", err)
		msg.Nak() // Negative acknowledgment, will be redelivered
		return
	}

	// Redelivery after a successful external side effect replays the durable
	// result instead of executing WhatsApp a second time.
	if cmd.CommandID != "" && s.ledger != nil {
		resultJSON, found, ledgerErr := s.ledger.GetProcessedCommand(s.ctx, cmd.CommandID)
		if ledgerErr != nil {
			log.Printf("[NATS] Failed to read command ledger: %v", ledgerErr)
			msg.Nak()
			return
		}
		if found {
			var stored storedCommandResult
			if err := json.Unmarshal(resultJSON, &stored); err != nil {
				log.Printf("[NATS] Invalid stored command result: %v", err)
				msg.Term()
				return
			}
			if err := s.publishStoredCommandResult(stored, cmd.CommandID); err != nil {
				log.Printf("[NATS] Failed to replay stored result: %v", err)
				msg.Nak()
				return
			}
			msg.Ack()
			return
		}
	}

	// Check delivery count from message metadata
	meta, err := msg.Metadata()
	if err != nil {
		log.Printf("Failed to get message metadata: %v", err)
	}

	// NumDelivered starts at 1. Deliveries after the side-effect budget are
	// reserved for durably publishing the terminal outcome, never for sending
	// to WhatsApp again.
	deliveryCount := uint64(1)
	streamSeq := uint64(0)
	consumerSeq := uint64(0)
	numPending := uint64(0)
	if meta != nil {
		deliveryCount = meta.NumDelivered
		streamSeq = meta.Sequence.Stream
		consumerSeq = meta.Sequence.Consumer
		numPending = meta.NumPending
	}

	// Enhanced logging with correlation ID and metadata
	correlationID := cmd.CorrelationID
	log.Printf("[NATS] Processing command: type=%s to=%s msg_id=%s corr_id=%s delivery=%d/%d stream_seq=%d consumer_seq=%d pending=%d",
		cmd.Type, cmd.To, cmd.MessageID, correlationID, deliveryCount, commandMaxDeliver, streamSeq, consumerSeq, numPending)

	if deliveryCount > commandSideEffectMaxAttempts {
		// A prior terminal failure could not persist or publish its outcome.
		// Keep retrying that outcome without repeating the WhatsApp side effect.
		finishError := "WhatsApp send failed after retry exhaustion"
		s.finishFailedSend(msg, cmd, finishError)
		return
	}

	var resp types.SendResponse
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()

	switch cmd.Type {
	case "text":
		resp, err = s.sender.SendMessage(ctx, cmd.To, cmd.Content, cmd.ReplyTo, cmd.ReplyToSender, cmd.MentionedJIDs)
	case "image", "video", "audio", "document", "sticker":
		if s.storage == nil {
			err = fmt.Errorf("object storage is not configured")
			break
		}
		tenantPrefix := fmt.Sprintf("media/%s/", s.companyID)
		if !strings.HasPrefix(cmd.MediaObjectKey, tenantPrefix) || strings.Contains(cmd.MediaObjectKey, "..") {
			err = fmt.Errorf("media object key is outside tenant prefix")
			break
		}
		if cmd.MediaSize <= 0 || cmd.MediaSize > maxSendMediaBytes {
			err = fmt.Errorf("invalid media size %d", cmd.MediaSize)
			break
		}
		var mediaData []byte
		mediaData, err = s.storage.DownloadMediaObject(ctx, cmd.MediaObjectKey, maxSendMediaBytes, cmd.MediaChecksum)
		if err == nil && int64(len(mediaData)) != cmd.MediaSize {
			err = fmt.Errorf("media size mismatch: expected %d, got %d", cmd.MediaSize, len(mediaData))
		}
		if err == nil && cmd.MediaAlbumID != "" {
			albumSender, ok := s.sender.(mediaAlbumSender)
			if !ok {
				err = fmt.Errorf("media album sending is not supported")
			} else {
				resp, err = albumSender.SendMediaAlbumMessage(
					ctx,
					cmd.To,
					cmd.Type,
					mediaData,
					cmd.Caption,
					cmd.FileName,
					cmd.MimeType,
					cmd.ReplyTo,
					cmd.ReplyToSender,
					types.MediaAlbumContext{
						ID:         cmd.MediaAlbumID,
						Index:      cmd.MediaAlbumIndex,
						Count:      cmd.MediaAlbumCount,
						ImageCount: cmd.MediaAlbumImageCount,
						VideoCount: cmd.MediaAlbumVideoCount,
					},
				)
			}
		} else if err == nil {
			resp, err = s.sender.SendMediaMessage(ctx, cmd.To, cmd.Type, mediaData, cmd.Caption, cmd.FileName, cmd.MimeType, cmd.ReplyTo, cmd.ReplyToSender)
		}
	case "reaction":
		resp, err = s.sender.SendReaction(ctx, cmd.To, cmd.TargetMessageID, cmd.Emoji, cmd.TargetSenderJID, cmd.FromMe)
	default:
		log.Printf("[NATS] Unknown message type: %s (corr_id=%s)", cmd.Type, correlationID)
		msg.Nak()
		return
	}

	if err != nil {
		log.Printf("[NATS] Send failed: msg_id=%s corr_id=%s attempt=%d/%d error=%v", cmd.MessageID, correlationID, deliveryCount, commandSideEffectMaxAttempts, err)

		// Check if this is the final retry attempt
		if deliveryCount >= commandSideEffectMaxAttempts {
			log.Printf("[NATS] Max retries exceeded: msg_id=%s corr_id=%s - marking as failed", cmd.MessageID, correlationID)
			s.finishFailedSend(msg, cmd, err.Error())
			return
		}

		// Still have retries left, NAK to trigger redelivery
		log.Printf("[NATS] Scheduling retry: msg_id=%s corr_id=%s next_attempt=%d/%d", cmd.MessageID, correlationID, deliveryCount+1, commandSideEffectMaxAttempts)
		msg.Nak()
		return
	}

	stored := storedCommandResult{
		PendingMessageID: cmd.MessageID,
		CommandType:      cmd.Type,
		Response:         resp,
		CorrelationID:    correlationID,
	}
	if persistErr := s.persistCommandResult(cmd.CommandID, stored); persistErr != nil {
		// This is the unavoidable external-side-effect/local-persistence crash
		// window. Do not ACK; operators can reconcile by command/message ID.
		log.Printf("[NATS] Failed to persist successful command result: msg_id=%s error=%v", cmd.MessageID, persistErr)
		msg.Nak()
		return
	}

	if err := s.publishStoredCommandResult(stored, cmd.CommandID); err != nil {
		log.Printf("[NATS] Failed to publish confirmation; result will replay: msg_id=%s error=%v", cmd.MessageID, err)
		msg.Nak()
		return
	}

	log.Printf("[NATS] Send success: msg_id=%s corr_id=%s to=%s real_id=%s", cmd.MessageID, correlationID, cmd.To, resp.ID)
	msg.Ack()
}

// handleBlockCommand processes a block/unblock contact command.
func (s *Subscriber) handleBlockCommand(msg *nats.Msg, cmdType string) {
	var cmd BlockContactCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		log.Printf("Failed to unmarshal block command: %v", err)
		msg.Nak()
		return
	}

	if s.blocker == nil {
		s.retryCommand(msg, cmdType, fmt.Errorf("blocker not configured"))
		return
	}

	log.Printf("Processing %s command for contact: %s", cmdType, cmd.ContactJID)

	ctx, cancel := context.WithTimeout(s.ctx, 60*time.Second)
	defer cancel()

	var err error
	if cmdType == "block_contact" {
		err = s.blocker.BlockContact(ctx, cmd.ContactJID)
	} else {
		err = s.blocker.UnblockContact(ctx, cmd.ContactJID)
	}

	if err != nil {
		s.retryCommand(msg, cmdType, err)
		return
	}

	log.Printf("Successfully executed %s for contact: %s", cmdType, cmd.ContactJID)
	msg.Ack()
}

// handleTypingCommand processes a typing indicator command.
func (s *Subscriber) handleTypingCommand(msg *nats.Msg, cmdType string) {
	var cmd TypingCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		log.Printf("Failed to unmarshal typing command: %v", err)
		msg.Nak()
		return
	}

	if s.typingSender == nil {
		log.Printf("Typing command received but typingSender not configured")
		msg.Ack() // Ack to avoid redelivery - typing is best-effort
		return
	}

	isTyping := cmdType == "typing_start"
	log.Printf("Processing typing command: jid=%s, isTyping=%v", cmd.JID, isTyping)

	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()

	if err := s.typingSender.SendChatPresence(ctx, cmd.JID, isTyping); err != nil {
		log.Printf("Failed to send chat presence: %v", err)
		// Still ack - typing is best-effort, don't retry
	} else {
		log.Printf("Typing indicator sent: jid=%s, isTyping=%v", cmd.JID, isTyping)
	}

	msg.Ack()
}

func (s *Subscriber) handleFetchProfilePictureCommand(msg *nats.Msg) {
	var cmd FetchProfilePictureCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		log.Printf("Failed to unmarshal profile picture command: %v", err)
		msg.Nak()
		return
	}
	if s.profileFetcher == nil || s.publisher == nil {
		log.Printf("Profile picture command received without required handlers")
		msg.Ack()
		return
	}

	profilePictureURL, err := s.profileFetcher.FetchProfilePicture(cmd.JID)
	if err != nil {
		// A command-driven refresh is best-effort. A transient WhatsApp,
		// download, or storage failure is not evidence that the user removed
		// their picture, so preserve existing data and allow a later request.
		log.Printf("Failed to fetch participant profile picture: %v", err)
		msg.Ack()
		return
	}
	if err := s.publisher.PublishProfilePicture(
		cmd.JID,
		profilePictureURL,
		profilePictureURL == "",
		time.Now(),
	); err != nil {
		log.Printf("Failed to publish participant profile picture: %v", err)
		msg.Nak()
		return
	}
	msg.Ack()
}

func commandDeliveryCount(msg *nats.Msg) uint64 {
	metadata, err := msg.Metadata()
	if err != nil || metadata == nil {
		return 1
	}
	return metadata.NumDelivered
}

func (s *Subscriber) retryCommand(msg *nats.Msg, commandType string, err error) {
	attempt := commandDeliveryCount(msg)
	if attempt >= 3 {
		log.Printf("[NATS] Command %s failed permanently after %d attempts: %v", commandType, attempt, err)
		var envelope struct {
			CommandID string `json:"command_id"`
		}
		_ = json.Unmarshal(msg.Data, &envelope)
		if s.publisher != nil {
			if publishErr := s.publisher.PublishCommandResult(
				envelope.CommandID, commandType, false, sharednats.CommandOutcomeFailed, err.Error(),
			); publishErr != nil {
				log.Printf("[NATS] Failed to publish command failure result: %v", publishErr)
			}
		}
		msg.Ack()
		return
	}
	log.Printf("[NATS] Command %s failed on attempt %d/3: %v", commandType, attempt, err)
	msg.Nak()
}

func (s *Subscriber) handlePostStatusCommand(msg *nats.Msg) {
	var cmd PostStatusCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		s.retryCommand(msg, "post_status", err)
		return
	}
	if s.executor == nil {
		s.retryCommand(msg, cmd.Type, fmt.Errorf("command executor not configured"))
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 90*time.Second)
	defer cancel()
	if _, err := s.executor.PostStatus(ctx, cmd.StatusType, cmd.Content, cmd.MediaURL); err != nil {
		s.retryCommand(msg, cmd.Type, err)
		return
	}
	msg.Ack()
}

// participantActionFor maps a group command to the whatsmeow participant
// change it performs. The single-participant command names are kept so an
// outbox entry enqueued before this build still executes.
func participantActionFor(commandType string) (string, bool) {
	switch commandType {
	case "group_add_participants":
		return "add", true
	case "group_remove_participants", "group_remove_participant":
		return "remove", true
	case "group_promote_admin":
		return "promote", true
	case "group_demote_admin":
		return "demote", true
	default:
		return "", false
	}
}

// handleGroupCommand executes a group administration command and then reports
// WhatsApp's own view of the result.
//
// The two halves have different retry rules, which is why they are separated by
// the command ledger (see applyGroupCommandOnce). The MUTATION must happen at
// most once: creating a group twice makes two groups, rotating an invite link
// twice kills the first one, and re-deciding a join request makes WhatsApp
// answer with an error that looks like a failure. The REPORT must eventually
// happen: acking a command whose outcome never reached the API would leave the
// workspace showing pre-command state forever. So the mutation is recorded
// before it is reported, and a retry replays the record instead of repeating
// the work.
func (s *Subscriber) handleGroupCommand(msg *nats.Msg, commandType string) {
	var cmd GroupCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	if s.executor == nil || s.publisher == nil {
		s.retryCommand(msg, commandType, fmt.Errorf("group executor or publisher not configured"))
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 90*time.Second)
	defer cancel()

	err := s.executeGroupCommand(ctx, cmd, commandType)

	// The mutation landed but its outcome could not be delivered. Retrying is
	// still right - the ledger keeps it from re-running the side effect - but if
	// the retries run out the user must be told what actually happened, not that
	// their change failed.
	var syncFailed *groupSyncFailedError
	if errors.As(err, &syncFailed) {
		s.retryAppliedGroupCommand(ctx, msg, cmd, commandType, syncFailed)
		return
	}

	// WhatsApp answered, and its answer was "no". The group's real state has
	// already been published, so retrying would only ask again and get the same
	// refusal - report it to the user and stop.
	var rejected *whatsAppRejectedError
	if errors.As(err, &rejected) {
		if publishErr := s.publisher.PublishCommandResult(
			cmd.CommandID, commandType, false, sharednats.CommandOutcomeFailed, rejected.Error(),
		); publishErr != nil {
			log.Printf("[NATS] Failed to publish group rejection: %v", publishErr)
			msg.Nak()
			return
		}
		// Only now is the command genuinely reported. Marking it delivered any
		// earlier would let a failed result-publish be redelivered, recognised
		// as "already reported", and acknowledged - silently dropping the news
		// that WhatsApp refused the request.
		if rejected.markReported != nil {
			if markErr := rejected.markReported(ctx); markErr != nil {
				log.Printf("[NATS] Failed to record reported group rejection: %v", markErr)
				msg.Nak()
				return
			}
		}
		msg.Ack()
		return
	}

	if err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	msg.Ack()
}

// whatsAppRejectedError marks an outcome WhatsApp decided, not a transport or
// execution fault. Redelivery cannot change it.
type whatsAppRejectedError struct {
	detail string
	// markReported finalizes the durable record, and runs only once the
	// rejection has actually been delivered to the API.
	markReported func(context.Context) error
}

func (e *whatsAppRejectedError) Error() string { return e.detail }

// groupSyncFailedError marks a failure that happened AFTER the change landed on
// WhatsApp - reading the group back, or delivering the result.
//
// The distinction matters to the person who pressed the button: "your change
// failed" and "your change worked, we just could not refresh the view" call for
// completely different reactions, and reporting the first when the second is
// true invites someone to redo an action that already succeeded.
type groupSyncFailedError struct {
	cause error
	// markReported finalizes the durable record once the partial outcome has
	// been delivered.
	markReported func(context.Context) error
}

func (e *groupSyncFailedError) Error() string { return e.cause.Error() }
func (e *groupSyncFailedError) Unwrap() error { return e.cause }

// retryAppliedGroupCommand retries delivery of an outcome whose mutation has
// already been applied, and reports it accurately once retries run out.
//
// The command is acked at that point rather than redelivered forever: the
// change is real, the ledger prevents it from being repeated, and WhatsApp's own
// group notification plus the connection-level joined-group refresh will
// reconcile the stored group without any further action here.
func (s *Subscriber) retryAppliedGroupCommand(
	ctx context.Context,
	msg *nats.Msg,
	cmd GroupCommand,
	commandType string,
	err *groupSyncFailedError,
) {
	attempt := commandDeliveryCount(msg)
	if attempt < commandSideEffectMaxAttempts {
		log.Printf("[NATS] Command %s applied but not yet synced (attempt %d/%d): %v",
			commandType, attempt, commandSideEffectMaxAttempts, err)
		msg.Nak()
		return
	}

	log.Printf("[NATS] Command %s applied but could not be synced after %d attempts: %v",
		commandType, attempt, err)
	if s.publisher != nil {
		detail := fmt.Sprintf(
			"The change was applied on WhatsApp, but this workspace could not be refreshed (%v). It will catch up on its own; no need to repeat the action.",
			err,
		)
		if publishErr := s.publisher.PublishCommandResult(
			cmd.CommandID, commandType, false,
			sharednats.CommandOutcomeAppliedNotSynced, detail,
		); publishErr != nil {
			log.Printf("[NATS] Failed to publish applied-but-unsynced result: %v", publishErr)
			msg.Nak()
			return
		}
		// The outcome has now been reported, even though it is a partial one.
		// Recording that keeps the ledger row prunable instead of stranding it
		// as permanently undelivered.
		if err.markReported != nil {
			if markErr := err.markReported(ctx); markErr != nil {
				log.Printf("[NATS] Failed to record reported group outcome: %v", markErr)
			}
		}
	}
	msg.Ack()
}

// rejectionFor reports whether WhatsApp applied none of the requested
// participants. A partially applied batch is left alone: the published snapshot
// already shows exactly who is in the group, so the user can see the outcome.
// A wholly rejected batch produces no visible change at all, which without this
// would be indistinguishable from the request never having been made.
func rejectionFor(action string, results []types.GroupParticipantResult) error {
	if len(results) == 0 {
		return nil
	}
	refused := make([]string, 0, len(results))
	for _, result := range results {
		if result.Applied {
			return nil
		}
		refused = append(refused, fmt.Sprintf("%s (code %d)", result.JID, result.Code))
	}
	return &whatsAppRejectedError{
		detail: fmt.Sprintf(
			"WhatsApp did not %s: %s",
			action,
			strings.Join(refused, ", "),
		),
	}
}

func (s *Subscriber) executeGroupCommand(ctx context.Context, cmd GroupCommand, commandType string) error {
	switch commandType {
	case "group_create":
		// Ledgered above all others: running this twice does not converge, it
		// produces a second real group nobody asked for.
		return s.applyGroupCommandOnce(ctx, cmd,
			func() (storedGroupResult, error) {
				snapshot, err := s.executor.CreateGroup(
					ctx, valueOrEmpty(cmd.Name), cmd.participants(),
				)
				return storedGroupResult{Snapshot: snapshot}, err
			},
			func(stored storedGroupResult) error {
				return s.publisher.PublishGroupSnapshot(
					cmd.CommandID, sharednats.GroupActionCreated, stored.Snapshot,
				)
			},
		)

	case "group_leave":
		// Ledgered: a redelivery must not call LeaveGroup on a group the account
		// already left, which WhatsApp answers with an error that would be
		// reported to the user as "leaving failed" after it actually succeeded.
		return s.applyGroupCommandOnce(ctx, cmd,
			func() (storedGroupResult, error) {
				return storedGroupResult{}, s.executor.LeaveGroup(ctx, cmd.GroupJID)
			},
			func(storedGroupResult) error {
				// Leaving is not a delete. The event only records that this
				// account is no longer a member; the group lives on for others.
				return s.publisher.PublishGroupLeft(cmd.CommandID, cmd.GroupJID)
			},
		)

	case "group_invite_link":
		if !cmd.Reset {
			// A plain read has no side effect, so a retry should fetch afresh.
			link, err := s.executor.GetGroupInviteLink(ctx, cmd.GroupJID, false)
			if err != nil {
				return err
			}
			return s.publisher.PublishGroupInviteLink(cmd.CommandID, cmd.GroupJID, link)
		}
		// A reset REVOKES the current link and mints a new one, so re-running it
		// invalidates the link the previous attempt already handed out.
		return s.applyGroupCommandOnce(ctx, cmd,
			func() (storedGroupResult, error) {
				link, err := s.executor.GetGroupInviteLink(ctx, cmd.GroupJID, true)
				return storedGroupResult{InviteLink: link}, err
			},
			func(stored storedGroupResult) error {
				return s.publisher.PublishGroupInviteLink(
					cmd.CommandID, cmd.GroupJID, stored.InviteLink,
				)
			},
		)

	case "group_join_requests_fetch":
		requests, err := s.executor.GetGroupJoinRequests(ctx, cmd.GroupJID)
		if err != nil {
			return err
		}
		return s.publisher.PublishGroupJoinRequests(cmd.CommandID, cmd.GroupJID, requests)

	case "group_join_requests_update":
		// Ledgered: re-deciding an already-decided request makes WhatsApp answer
		// with a per-participant error for every entry, which `rejectionFor`
		// would then report as a failure of an approval that in fact landed.
		return s.applyGroupCommandOnce(ctx, cmd,
			func() (storedGroupResult, error) {
				decided, err := s.executor.UpdateGroupJoinRequests(
					ctx, cmd.GroupJID, cmd.participants(), cmd.Decision,
				)
				return storedGroupResult{Results: decided}, err
			},
			func(stored storedGroupResult) error {
				// Approving adds a member, so both the remaining requests and
				// the participant list have to be re-read from WhatsApp.
				requests, err := s.executor.GetGroupJoinRequests(ctx, cmd.GroupJID)
				if err != nil {
					return err
				}
				if err = s.publisher.PublishGroupJoinRequests(
					cmd.CommandID, cmd.GroupJID, requests,
				); err != nil {
					return err
				}
				if err = s.publishGroupSnapshot(ctx, cmd); err != nil {
					return err
				}
				return rejectionFor(cmd.Decision+" join requests for", stored.Results)
			},
		)

	case "group_update_settings":
		// WhatsApp needs one request per setting and there is no transaction
		// across them, so a failure half-way leaves the earlier ones applied.
		// The snapshot is published either way - reporting "it failed" while
		// silently keeping a stale name is worse than reporting both facts.
		updateErr := s.executor.UpdateGroupSettings(ctx, cmd.GroupJID, cmd.settingsUpdate())
		if snapshotErr := s.publishGroupSnapshot(ctx, cmd); snapshotErr != nil && updateErr == nil {
			return snapshotErr
		}
		return updateErr

	case "group_sync":
		return s.publishGroupSnapshot(ctx, cmd)

	default:
		action, ok := participantActionFor(commandType)
		if !ok {
			return fmt.Errorf("unsupported group command %q", commandType)
		}
		// Ledgered for the same reason as join-request decisions: re-adding or
		// re-removing an already-applied member returns a per-participant error
		// that would be misreported as the whole request having failed.
		return s.applyGroupCommandOnce(ctx, cmd,
			func() (storedGroupResult, error) {
				results, err := s.executor.UpdateGroupParticipants(
					ctx, cmd.GroupJID, cmd.participants(), action,
				)
				return storedGroupResult{Results: results}, err
			},
			func(stored storedGroupResult) error {
				if err := s.publishGroupSnapshot(ctx, cmd); err != nil {
					return err
				}
				return rejectionFor(action, stored.Results)
			},
		)
	}
}

// applyGroupCommandOnce runs a group mutation at most once per command, then
// reports its outcome on every delivery.
//
// The split matters: the mutation is the part that must not repeat, while the
// report is the part that must eventually succeed. Recording the outcome BEFORE
// reporting means a failed publish replays the stored result rather than asking
// WhatsApp to do the work again - which is what turns a transport blip from a
// duplicated side effect (or a false "it failed") into a plain retry.
func (s *Subscriber) applyGroupCommandOnce(
	ctx context.Context,
	cmd GroupCommand,
	apply func() (storedGroupResult, error),
	report func(storedGroupResult) error,
) error {
	ledgered := cmd.CommandID != "" && s.ledger != nil

	if ledgered {
		resultJSON, published, found, err := s.readProcessedCommand(ctx, cmd.CommandID)
		if err != nil {
			return fmt.Errorf("read command ledger: %w", err)
		}
		if found && published {
			// The outcome already reached the API. Republishing would only
			// duplicate an event the workspace has applied, and the stored
			// payload may have been scrubbed, so there is nothing to replay.
			log.Printf("[NATS] Command %s already reported; acknowledging replay", cmd.CommandID)
			return nil
		}
		if found {
			var stored storedGroupResult
			if err = json.Unmarshal(resultJSON, &stored); err != nil {
				return fmt.Errorf("invalid stored group result: %w", err)
			}
			// Unknown JSON fields unmarshal silently, so a record written by a
			// different command family would replay as an all-zero result: an
			// empty snapshot, a blank invite link, or an empty verdict list that
			// `rejectionFor` would read as "nothing was rejected".
			if stored.CommandType != "" && stored.CommandType != cmd.Type {
				return fmt.Errorf(
					"ledger entry %s holds a %s result, not %s",
					cmd.CommandID, stored.CommandType, cmd.Type,
				)
			}
			// A ledger record means the mutation already landed, so any failure
			// from here on is a delivery problem, not a failed change.
			return asGroupSyncFailure(
				s.reportGroupCommand(ctx, cmd.CommandID, stored, report),
				func(markCtx context.Context) error {
					return s.markGroupCommandReported(markCtx, cmd.CommandID, stored)
				},
			)
		}
	}

	stored, err := apply()
	if err != nil {
		return err
	}
	stored.CommandType = cmd.Type

	if ledgered {
		resultJSON, marshalErr := json.Marshal(stored)
		if marshalErr != nil {
			return fmt.Errorf("marshal group result: %w", marshalErr)
		}
		if err = s.ledger.SaveProcessedCommand(ctx, cmd.CommandID, cmd.Type, resultJSON); err != nil {
			return fmt.Errorf("save group result: %w", err)
		}
	}

	// The mutation has happened; only its delivery can still fail.
	return asGroupSyncFailure(
		s.reportGroupCommand(ctx, cmd.CommandID, stored, report),
		func(markCtx context.Context) error {
			return s.markGroupCommandReported(markCtx, cmd.CommandID, stored)
		},
	)
}

// asGroupSyncFailure marks a post-mutation error so retry exhaustion can report
// "applied, not synced" rather than the flat failure the user would otherwise
// see for a change that did land.
func asGroupSyncFailure(err error, markReported func(context.Context) error) error {
	if err == nil {
		return nil
	}
	var rejected *whatsAppRejectedError
	if errors.As(err, &rejected) {
		return err
	}
	return &groupSyncFailedError{cause: err, markReported: markReported}
}

func (s *Subscriber) reportGroupCommand(
	ctx context.Context,
	commandID string,
	stored storedGroupResult,
	report func(storedGroupResult) error,
) error {
	err := report(stored)

	// A rejection is a real outcome, but it has NOT been delivered yet - the
	// caller still has to publish its command_result. Marking the command
	// delivered here would let a failed result-publish come back, be recognised
	// as already reported, and be acknowledged, losing the news that WhatsApp
	// refused the request. So the finalisation is handed to the caller to run
	// once that publish succeeds.
	var rejected *whatsAppRejectedError
	if errors.As(err, &rejected) {
		rejected.markReported = func(markCtx context.Context) error {
			return s.markGroupCommandReported(markCtx, commandID, stored)
		}
		return err
	}
	if err != nil {
		return err
	}
	return s.markGroupCommandReported(ctx, commandID, stored)
}

// markGroupCommandReported records that a command's outcome reached the API and
// drops any credential the record was holding for the replay path.
func (s *Subscriber) markGroupCommandReported(
	ctx context.Context,
	commandID string,
	stored storedGroupResult,
) error {
	if commandID == "" || s.ledger == nil {
		return nil
	}
	if err := s.ledger.MarkCommandEventPublished(ctx, commandID); err != nil {
		return err
	}
	// An invite link stored here is a second copy of a credential that lets
	// anyone holding it request to join. Once the API has it, this copy has no
	// remaining purpose, so it does not get to outlive its usefulness.
	if stored.InviteLink != "" {
		if groupLedger, ok := s.ledger.(GroupCommandLedger); ok {
			if scrubErr := groupLedger.ScrubProcessedCommandResult(ctx, commandID); scrubErr != nil {
				log.Printf("[NATS] Failed to scrub stored group result: %v", scrubErr)
			}
		}
	}
	return nil
}

// readProcessedCommand reads the ledger, including delivery state when the
// ledger implementation can report it.
func (s *Subscriber) readProcessedCommand(
	ctx context.Context,
	commandID string,
) (result []byte, published bool, found bool, err error) {
	if groupLedger, ok := s.ledger.(GroupCommandLedger); ok {
		return groupLedger.GetProcessedCommandState(ctx, commandID)
	}
	result, found, err = s.ledger.GetProcessedCommand(ctx, commandID)
	return result, false, found, err
}

// storedGroupResult is the durable record of a group mutation that must not be
// repeated on redelivery. Which field is populated depends on the command; the
// shared shape is what lets one ledger guard serve all of them.
type storedGroupResult struct {
	CommandType string                         `json:"command_type"`
	Snapshot    types.GroupSnapshot            `json:"snapshot,omitzero"`
	InviteLink  string                         `json:"invite_link,omitempty"`
	Results     []types.GroupParticipantResult `json:"results,omitempty"`
}

// publishGroupSnapshot re-reads the group from WhatsApp and publishes it, so
// the API's participant list and permissions always come from the server rather
// than from what the command asked for.
func (s *Subscriber) publishGroupSnapshot(ctx context.Context, cmd GroupCommand) error {
	snapshot, err := s.executor.GetGroupSnapshot(ctx, cmd.GroupJID)
	if err != nil {
		return err
	}
	return s.publisher.PublishGroupSnapshot(cmd.CommandID, sharednats.GroupActionSnapshot, snapshot)
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *Subscriber) handleLabelCommand(msg *nats.Msg, commandType string) {
	var cmd LabelCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	if s.executor == nil {
		s.retryCommand(msg, commandType, fmt.Errorf("command executor not configured"))
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 90*time.Second)
	defer cancel()
	if commandType == "sync_labels" {
		labels, err := s.executor.SyncLabels(ctx)
		if err != nil {
			s.retryCommand(msg, commandType, err)
			return
		}
		if s.publisher == nil {
			s.retryCommand(msg, commandType, fmt.Errorf("publisher not configured"))
			return
		}
		if err = s.publisher.PublishLabels(labels); err != nil {
			s.retryCommand(msg, commandType, err)
			return
		}
		msg.Ack()
		return
	}
	if err := s.executor.ApplyLabel(ctx, cmd.ContactJID, cmd.LabelID, commandType == "apply_label"); err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	msg.Ack()
}

func (s *Subscriber) handleCatalogCommand(msg *nats.Msg, commandType string) {
	var cmd CatalogCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	if s.executor == nil || s.publisher == nil {
		s.retryCommand(msg, commandType, fmt.Errorf("catalog executor or publisher not configured"))
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 90*time.Second)
	defer cancel()
	catalog, err := s.executor.SyncCatalog(ctx, cmd.CatalogID)
	if err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	if err = s.publisher.PublishCatalog(catalog); err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	msg.Ack()
}

// pruneProcessedCommands keeps the durable command ledger bounded.
//
// Every group mutation writes a row, so without this the table grows for the
// lifetime of a connection. Both classes are bounded, on very different
// windows: a delivered row is disposable once redelivery is impossible, while
// an undelivered row is the only thing preventing a repeated mutation and is
// kept until long past the commands stream's own retention.
func (s *Subscriber) pruneProcessedCommands() {
	groupLedger, ok := s.ledger.(GroupCommandLedger)
	if !ok {
		return
	}
	ticker := time.NewTicker(processedCommandPruneInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			removed, err := groupLedger.PruneProcessedCommands(
				s.ctx,
				processedCommandDeliveredRetention,
				processedCommandUndeliveredRetention,
			)
			if err != nil {
				log.Printf("[NATS] Failed to prune processed commands: %v", err)
				continue
			}
			if removed > 0 {
				log.Printf("[NATS] Pruned %d delivered command records", removed)
			}
		}
	}
}

// Stop stops the subscriber.
func (s *Subscriber) Stop() {
	s.cancel()
	if s.sub != nil {
		s.sub.Unsubscribe()
	}
	if s.nc != nil {
		s.nc.Close()
	}
}
