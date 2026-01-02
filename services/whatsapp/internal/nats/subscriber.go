package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	// Subject for sending messages (matches orchestrator's WHATSAPP_COMMANDS stream)
	SubjectSend = "WHATSAPP.commands.%s"

	// Stream name for commands
	CommandsStreamName = "WHATSAPP_COMMANDS"

	// Consumer name for message sending
	ConsumerSend = "whatsapp-send-%s"
)

// SendMessageCommand represents a command to send a message.
type SendMessageCommand struct {
	MessageID   string `json:"message_id"`
	To          string `json:"to"`           // JID of the recipient
	Type        string `json:"type"`         // "text", "image", "document", "video", "audio"
	Content     string `json:"content"`      // Text content or media URL
	Caption     string `json:"caption"`      // Caption for media messages
	FileName    string `json:"file_name"`    // File name for documents
	MimeType    string `json:"mime_type"`    // MIME type for media
	MediaData   []byte `json:"media_data"`   // Base64 decoded media data
	ReplyTo     string `json:"reply_to"`     // Message ID to reply to
}

// MessageSender is the interface for sending WhatsApp messages.
type MessageSender interface {
	SendMessage(ctx context.Context, jid string, text string) error
	SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string) error
}

// Subscriber handles subscribing to NATS command subjects.
type Subscriber struct {
	nc          *nats.Conn
	js          nats.JetStreamContext
	companyID   string
	sender      MessageSender
	sub         *nats.Subscription
	ctx         context.Context
	cancel      context.CancelFunc
}

// SubscriberConfig holds configuration for the subscriber.
type SubscriberConfig struct {
	NATSURL   string
	CompanyID string
	Sender    MessageSender
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
		nc:        nc,
		js:        js,
		companyID: cfg.CompanyID,
		sender:    cfg.Sender,
		ctx:       ctx,
		cancel:    cancel,
	}, nil
}

// Start begins listening for send commands.
func (s *Subscriber) Start() error {
	subject := fmt.Sprintf(SubjectSend, s.companyID)
	consumerName := fmt.Sprintf(ConsumerSend, s.companyID)

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
	for {
		select {
		case <-s.ctx.Done():
			log.Println("Subscriber context cancelled, stopping")
			return
		default:
			// Fetch messages with a timeout
			msgs, err := s.sub.Fetch(10, nats.MaxWait(5*time.Second))
			if err != nil {
				if err != nats.ErrTimeout {
					log.Printf("Error fetching messages: %v", err)
				}
				continue
			}

			for _, msg := range msgs {
				s.handleSendCommand(msg)
			}
		}
	}
}

// handleSendCommand processes a send message command.
func (s *Subscriber) handleSendCommand(msg *nats.Msg) {
	var cmd SendMessageCommand
	if err := json.Unmarshal(msg.Data, &cmd); err != nil {
		log.Printf("Failed to unmarshal send command: %v", err)
		msg.Nak() // Negative acknowledgment, will be redelivered
		return
	}

	log.Printf("Processing send command: type=%s, to=%s", cmd.Type, cmd.To)

	var err error
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()

	switch cmd.Type {
	case "text":
		err = s.sender.SendMessage(ctx, cmd.To, cmd.Content)
	case "image", "video", "audio", "document":
		err = s.sender.SendMediaMessage(ctx, cmd.To, cmd.Type, cmd.MediaData, cmd.Caption, cmd.FileName, cmd.MimeType)
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
