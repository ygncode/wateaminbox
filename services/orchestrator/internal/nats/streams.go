package nats

import (
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// Stream and consumer names
const (
	StreamCommands = "WHATSAPP_COMMANDS"
	StreamEvents   = "WHATSAPP_EVENTS"

	ConsumerCommands = "orchestrator-commands"
)

// StreamConfig holds configuration for a JetStream stream.
type StreamConfig struct {
	Name        string
	Subjects    []string
	Description string
	MaxAge      time.Duration
	MaxMsgs     int64
	MaxBytes    int64
}

// DefaultCommandsStreamConfig returns the default configuration for the commands stream.
func DefaultCommandsStreamConfig() StreamConfig {
	return StreamConfig{
		Name:        StreamCommands,
		Subjects:    []string{"WHATSAPP.commands", "WHATSAPP.commands.>"},
		Description: "Orchestrator commands for managing WhatsApp workers (spawn, kill, status)",
		MaxAge:      24 * time.Hour,
		MaxMsgs:     100000,
		MaxBytes:    100 * 1024 * 1024, // 100MB
	}
}

// DefaultEventsStreamConfig returns the default configuration for the events stream.
func DefaultEventsStreamConfig() StreamConfig {
	return StreamConfig{
		Name:        StreamEvents,
		Subjects:    []string{"WHATSAPP.events", "WHATSAPP.events.>"},
		Description: "WhatsApp events (connected, disconnected, message, qr)",
		MaxAge:      7 * 24 * time.Hour,
		MaxMsgs:     1000000,
		MaxBytes:    1024 * 1024 * 1024, // 1GB
	}
}

// CreateStreams creates the required JetStream streams for the orchestrator.
func (c *Client) CreateStreams() error {
	log.Println("Setting up JetStream streams...")

	// Create commands stream
	if err := c.createOrUpdateStream(DefaultCommandsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create commands stream: %w", err)
	}

	// Create events stream
	if err := c.createOrUpdateStream(DefaultEventsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create events stream: %w", err)
	}

	// Create consumer for commands
	if err := c.createCommandsConsumer(); err != nil {
		return fmt.Errorf("failed to create commands consumer: %w", err)
	}

	log.Println("JetStream streams setup complete")
	return nil
}

// createOrUpdateStream creates a stream or updates it if it exists.
func (c *Client) createOrUpdateStream(cfg StreamConfig) error {
	streamCfg := &nats.StreamConfig{
		Name:        cfg.Name,
		Subjects:    cfg.Subjects,
		Description: cfg.Description,
		MaxAge:      cfg.MaxAge,
		MaxMsgs:     cfg.MaxMsgs,
		MaxBytes:    cfg.MaxBytes,
		Storage:     nats.FileStorage,
		Retention:   nats.LimitsPolicy,
		Replicas:    1,
		Discard:     nats.DiscardOld,
	}

	// Try to get existing stream
	stream, err := c.js.StreamInfo(cfg.Name)
	if err != nil {
		if err == nats.ErrStreamNotFound {
			// Create new stream
			_, err = c.js.AddStream(streamCfg)
			if err != nil {
				return fmt.Errorf("failed to add stream %s: %w", cfg.Name, err)
			}
			log.Printf("Created stream: %s", cfg.Name)
			return nil
		}
		return fmt.Errorf("failed to get stream info for %s: %w", cfg.Name, err)
	}

	// Update existing stream if needed
	if !streamsEqual(stream.Config, *streamCfg) {
		_, err = c.js.UpdateStream(streamCfg)
		if err != nil {
			return fmt.Errorf("failed to update stream %s: %w", cfg.Name, err)
		}
		log.Printf("Updated stream: %s", cfg.Name)
	} else {
		log.Printf("Stream already exists: %s", cfg.Name)
	}

	return nil
}

// createCommandsConsumer creates a durable consumer for the commands stream.
// Always deletes and recreates the consumer on startup to ensure clean state.
func (c *Client) createCommandsConsumer() error {
	consumerCfg := &nats.ConsumerConfig{
		Durable:       ConsumerCommands,
		Description:   "Orchestrator consumer for processing worker commands",
		DeliverPolicy: nats.DeliverNewPolicy, // Only deliver NEW messages (avoid replaying old ones)
		AckPolicy:     nats.AckExplicitPolicy,
		AckWait:       30 * time.Second,
		MaxDeliver:    5,
		FilterSubject: "WHATSAPP.commands",
		MaxAckPending: 1000,
	}

	// Always delete existing consumer to ensure clean state on startup
	// This prevents issues with stale delivery positions
	_, err := c.js.ConsumerInfo(StreamCommands, ConsumerCommands)
	if err == nil {
		log.Printf("Deleting existing consumer %s to ensure clean state...", ConsumerCommands)
		if err := c.js.DeleteConsumer(StreamCommands, ConsumerCommands); err != nil {
			log.Printf("Warning: failed to delete existing consumer: %v", err)
		}
	}

	// Create fresh consumer
	_, err = c.js.AddConsumer(StreamCommands, consumerCfg)
	if err != nil {
		return fmt.Errorf("failed to add consumer %s: %w", ConsumerCommands, err)
	}
	log.Printf("Created consumer: %s (DeliverPolicy: New)", ConsumerCommands)
	return nil
}

// consumerConfigMatches checks if critical consumer config settings match.
func consumerConfigMatches(existing, expected nats.ConsumerConfig) bool {
	return existing.FilterSubject == expected.FilterSubject &&
		existing.DeliverPolicy == expected.DeliverPolicy &&
		existing.AckPolicy == expected.AckPolicy
}

// SubscribeToCommands creates a pull subscription for processing commands.
func (c *Client) SubscribeToCommands(handler func(msg *nats.Msg)) (*nats.Subscription, error) {
	sub, err := c.js.PullSubscribe(
		"WHATSAPP.commands",
		ConsumerCommands,
		nats.ManualAck(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create pull subscription: %w", err)
	}

	return sub, nil
}

// PublishEvent publishes an event to the events stream.
func (c *Client) PublishEvent(subject string, data []byte) error {
	_, err := c.js.Publish(subject, data)
	if err != nil {
		return fmt.Errorf("failed to publish event: %w", err)
	}
	return nil
}

// PublishCommand publishes a command to the commands stream.
func (c *Client) PublishCommand(data []byte) error {
	_, err := c.js.Publish("WHATSAPP.commands", data)
	if err != nil {
		return fmt.Errorf("failed to publish command: %w", err)
	}
	return nil
}

// streamsEqual compares two stream configs for equality (simplified comparison).
func streamsEqual(a, b nats.StreamConfig) bool {
	if a.Name != b.Name {
		return false
	}
	if len(a.Subjects) != len(b.Subjects) {
		return false
	}
	for i, s := range a.Subjects {
		if s != b.Subjects[i] {
			return false
		}
	}
	return a.MaxAge == b.MaxAge && a.MaxMsgs == b.MaxMsgs && a.MaxBytes == b.MaxBytes
}

// DeleteStreams removes the JetStream streams (useful for cleanup/testing).
func (c *Client) DeleteStreams() error {
	if err := c.js.DeleteStream(StreamCommands); err != nil && err != nats.ErrStreamNotFound {
		return fmt.Errorf("failed to delete commands stream: %w", err)
	}
	if err := c.js.DeleteStream(StreamEvents); err != nil && err != nats.ErrStreamNotFound {
		return fmt.Errorf("failed to delete events stream: %w", err)
	}
	return nil
}
