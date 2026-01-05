package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
)

// SendMessageCommand represents a command to send a message.
type SendMessageCommand struct {
	MessageID     string `json:"message_id"`
	To            string `json:"to"`              // JID of the recipient
	Type          string `json:"type"`            // "text", "image", "document", "video", "audio", "reaction"
	Content       string `json:"content"`         // Text content or media URL
	Caption       string `json:"caption"`         // Caption for media messages
	FileName      string `json:"file_name"`       // File name for documents
	MimeType      string `json:"mime_type"`       // MIME type for media
	MediaData     []byte `json:"media_data"`      // Base64 decoded media data
	ReplyTo       string `json:"reply_to"`        // Message ID to reply to
	ReplyToSender string `json:"reply_to_sender"` // JID of the sender of the quoted message
	// Reaction-specific fields
	TargetMessageID string `json:"target_message_id"` // Message ID to react to (for reaction type)
	Emoji           string `json:"emoji"`             // Emoji for reaction (for reaction type)
	FromMe          bool   `json:"from_me"`           // Whether the target message is from us (for reaction type)
}

// MessageSender is the interface for sending WhatsApp messages.
type MessageSender interface {
	SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error)
	SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error)
	SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, fromMe bool) (types.SendResponse, error)
}

// Subscriber handles subscribing to NATS command subjects.
type Subscriber struct {
	nc           *nats.Conn
	js           nats.JetStreamContext
	companyID    string
	connectionID string
	sender       MessageSender
	publisher    *Publisher
	sub          *nats.Subscription
	ctx          context.Context
	cancel       context.CancelFunc
}

// SubscriberConfig holds configuration for the subscriber.
type SubscriberConfig struct {
	NATSURL      string
	CompanyID    string
	ConnectionID string
	Sender       MessageSender
	Publisher    *Publisher
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
		nc:           nc,
		js:           js,
		companyID:    cfg.CompanyID,
		connectionID: cfg.ConnectionID,
		sender:       cfg.Sender,
		publisher:    cfg.Publisher,
		ctx:          ctx,
		cancel:       cancel,
	}, nil
}

// Start begins listening for send commands.
func (s *Subscriber) Start() error {
	subject := fmt.Sprintf(SubjectSend, s.companyID, s.connectionID)
	consumerName := fmt.Sprintf(ConsumerSend, s.companyID, s.connectionID)

	// Ensure the consumer exists
	_, err := s.js.ConsumerInfo(CommandsStreamName, consumerName)
	if err != nil {
		if err == nats.ErrConsumerNotFound {
			// Create durable consumer
			_, err = s.js.AddConsumer(CommandsStreamName, &nats.ConsumerConfig{
				Durable:       consumerName,
				FilterSubject: subject,
				AckPolicy:     nats.AckExplicitPolicy,
				DeliverPolicy: nats.DeliverNewPolicy,
				MaxDeliver:    3, // Retry up to 3 times
				AckWait:       30 * time.Second,
			})
			if err != nil {
				return fmt.Errorf("failed to create consumer: %w", err)
			}
			log.Printf("Created consumer: %s", consumerName)
		} else {
			return fmt.Errorf("failed to get consumer info: %w", err)
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
				s.handleSendCommand(msg)
			}
		}
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

// handleSendCommand processes a send message command.
func (s *Subscriber) handleSendCommand(msg *nats.Msg) {
	var cmd SendMessageCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		log.Printf("Failed to unmarshal send command: %v", err)
		msg.Nak() // Negative acknowledgment, will be redelivered
		return
	}

	log.Printf("Processing send command: type=%s, to=%s, reply_to=%s, reply_to_sender=%s", cmd.Type, cmd.To, cmd.ReplyTo, cmd.ReplyToSender)

	var resp types.SendResponse
	var err error
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()

	switch cmd.Type {
	case "text":
		resp, err = s.sender.SendMessage(ctx, cmd.To, cmd.Content, cmd.ReplyTo, cmd.ReplyToSender)
	case "image", "video", "audio", "document":
		resp, err = s.sender.SendMediaMessage(ctx, cmd.To, cmd.Type, cmd.MediaData, cmd.Caption, cmd.FileName, cmd.MimeType, cmd.ReplyTo, cmd.ReplyToSender)
	case "reaction":
		resp, err = s.sender.SendReaction(ctx, cmd.To, cmd.TargetMessageID, cmd.Emoji, cmd.FromMe)
	default:
		log.Printf("Unknown message type: %s", cmd.Type)
		msg.Nak()
		return
	}

	if err != nil {
		log.Printf("Failed to send message: %v", err)
		msg.Nak()
		return
	}

	// Publish send confirmation event with the real WhatsApp message ID
	if s.publisher != nil {
		if err := s.publisher.PublishSendConfirmation(cmd.MessageID, resp.ID, resp.Timestamp); err != nil {
			log.Printf("Failed to publish send confirmation: %v", err)
			// Don't Nak - the message was sent successfully, we just failed to notify
		} else {
			log.Printf("Published send confirmation: %s -> %s", cmd.MessageID, resp.ID)
		}
	}

	log.Printf("Successfully sent message to %s", cmd.To)
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
