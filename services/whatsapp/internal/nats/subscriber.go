package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

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
	MessageID      string `json:"message_id"`
	To             string `json:"to"`               // JID of the recipient
	Type           string `json:"type"`             // "text", "image", "document", "video", "audio", "reaction"
	Content        string `json:"content"`          // Text content or media URL
	Caption        string `json:"caption"`          // Caption for media messages
	FileName       string `json:"file_name"`        // File name for documents
	MimeType       string `json:"mime_type"`        // MIME type for media
	MediaObjectKey string `json:"media_object_key"` // Tenant-scoped storage key
	MediaSize      int64  `json:"media_size"`
	MediaChecksum  string `json:"media_checksum"`
	ReplyTo        string `json:"reply_to"`        // Message ID to reply to
	ReplyToSender  string `json:"reply_to_sender"` // JID of the sender of the quoted message
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

type storedCommandResult struct {
	PendingMessageID string             `json:"pending_message_id"`
	CommandType      string             `json:"command_type"`
	Response         types.SendResponse `json:"response"`
	CorrelationID    string             `json:"correlation_id"`
	Failed           bool               `json:"failed,omitempty"`
	ErrorMessage     string             `json:"error_message,omitempty"`
}

type MessageSender interface {
	SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error)
	SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error)
	SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, targetSenderJID string, fromMe bool) (types.SendResponse, error)
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
	UpdateGroupParticipant(ctx context.Context, groupJID, participantJID, action string) error
	UpdateGroupSettings(ctx context.Context, groupJID string, name, description *string) error
	SyncLabels(ctx context.Context) ([]types.WhatsAppLabel, error)
	ApplyLabel(ctx context.Context, contactJID, labelID string, labeled bool) error
	SyncCatalog(ctx context.Context, catalogID string) (types.Catalog, error)
}

// ProfilePictureFetcher fetches and stores a WhatsApp profile picture.
type ProfilePictureFetcher interface {
	FetchProfilePicture(jid string) string
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

type GroupCommand struct {
	Type           string  `json:"type"`
	GroupJID       string  `json:"group_jid"`
	ParticipantJID string  `json:"participant_jid"`
	Name           *string `json:"name"`
	Description    *string `json:"description"`
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

// CommandEventPublisher publishes durable outcomes produced by commands.
// The interface keeps command execution independently testable from NATS.
type CommandEventPublisher interface {
	PublishSendConfirmation(pendingMessageID, messageID string, timestamp time.Time, correlationID string) error
	PublishSendFailed(pendingMessageID, errorMessage, correlationID string) error
	PublishCommandResult(commandID, commandType string, success bool, errorMessage string) error
	PublishProfilePicture(contactJID, profilePictureURL string, remove bool, timestamp time.Time) error
	PublishLabels(labels []types.WhatsAppLabel) error
	PublishCatalog(catalog types.Catalog) error
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
				log.Printf("NATS subscriber disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("NATS subscriber reconnected to %s", nc.ConnectedUrl())
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

	// Subscribe to the subject
	sub, err := s.js.PullSubscribe(subject, consumerName)
	if err != nil {
		return fmt.Errorf("failed to subscribe: %w", err)
	}
	s.sub = sub

	// Start processing messages in a goroutine
	go s.processMessages()

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
	case "group_promote_admin", "group_demote_admin", "group_remove_participant", "group_update_settings":
		s.handleGroupCommand(msg, ct.Type)
	case "sync_labels", "apply_label", "remove_label":
		s.handleLabelCommand(msg, ct.Type)
	case "sync_catalogs", "sync_catalog_products":
		s.handleCatalogCommand(msg, ct.Type)
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

// recreateSubscription attempts to recreate the NATS subscription
func (s *Subscriber) recreateSubscription() error {
	subject := fmt.Sprintf(SubjectSend, s.companyID, s.connectionID)
	consumerName := fmt.Sprintf(ConsumerSend, s.companyID, s.connectionID)

	// Try to unsubscribe first
	if s.sub != nil {
		s.sub.Unsubscribe()
	}

	// Recreate the subscription
	sub, err := s.js.PullSubscribe(subject, consumerName)
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
			result.ErrorMessage,
		)
	} else if result.Failed {
		err = s.publisher.PublishSendFailed(
			result.PendingMessageID,
			result.ErrorMessage,
			result.CorrelationID,
		)
	} else if result.CommandType == "reaction" {
		err = s.publisher.PublishCommandResult(commandID, result.CommandType, true, "")
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
		resp, err = s.sender.SendMessage(ctx, cmd.To, cmd.Content, cmd.ReplyTo, cmd.ReplyToSender)
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
		if err == nil {
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

	profilePictureURL := s.profileFetcher.FetchProfilePicture(cmd.JID)
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
			if publishErr := s.publisher.PublishCommandResult(envelope.CommandID, commandType, false, err.Error()); publishErr != nil {
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

func (s *Subscriber) handleGroupCommand(msg *nats.Msg, commandType string) {
	var cmd GroupCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	if s.executor == nil {
		s.retryCommand(msg, commandType, fmt.Errorf("command executor not configured"))
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 60*time.Second)
	defer cancel()
	var err error
	switch commandType {
	case "group_promote_admin":
		err = s.executor.UpdateGroupParticipant(ctx, cmd.GroupJID, cmd.ParticipantJID, "promote")
	case "group_demote_admin":
		err = s.executor.UpdateGroupParticipant(ctx, cmd.GroupJID, cmd.ParticipantJID, "demote")
	case "group_remove_participant":
		err = s.executor.UpdateGroupParticipant(ctx, cmd.GroupJID, cmd.ParticipantJID, "remove")
	case "group_update_settings":
		err = s.executor.UpdateGroupSettings(ctx, cmd.GroupJID, cmd.Name, cmd.Description)
	}
	if err != nil {
		s.retryCommand(msg, commandType, err)
		return
	}
	msg.Ack()
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
