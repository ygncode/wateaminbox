package nats

import (
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

// Consumer names (orchestrator-specific)
const (
	ConsumerCommands = "orchestrator-commands"
)

// CreateStreams creates the required JetStream streams for the orchestrator.
// Uses shared stream configurations from the shared/nats package.
func (c *Client) CreateStreams() error {
	log.Println("Setting up JetStream streams...")
	js := c.conn.JetStream()

	// Create commands stream using shared config
	if err := sharednats.EnsureStream(js, sharednats.DefaultCommandsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create commands stream: %w", err)
	}

	// Create events stream using shared config
	if err := sharednats.EnsureStream(js, sharednats.DefaultEventsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create events stream: %w", err)
	}

	// Create downloads stream using shared config
	if err := sharednats.EnsureStream(js, sharednats.DefaultDownloadsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create downloads stream: %w", err)
	}

	// Create consumer for commands
	if err := c.createCommandsConsumer(); err != nil {
		return fmt.Errorf("failed to create commands consumer: %w", err)
	}

	log.Println("JetStream streams setup complete")
	return nil
}

// createCommandsConsumer creates the durable orchestrator consumer.
// Existing state is retained so commands published while the orchestrator is
// offline are delivered after restart.
func (c *Client) createCommandsConsumer() error {
	js := c.conn.JetStream()

	if _, err := js.ConsumerInfo(sharednats.StreamCommands, ConsumerCommands); err == nil {
		log.Printf("Reusing durable consumer %s", ConsumerCommands)
		return nil
	} else if err != nats.ErrConsumerNotFound {
		return fmt.Errorf("failed to inspect consumer %s: %w", ConsumerCommands, err)
	}

	consumerCfg := commandsConsumerConfig()

	if _, err := js.AddConsumer(sharednats.StreamCommands, consumerCfg); err != nil {
		return fmt.Errorf("failed to add consumer %s: %w", ConsumerCommands, err)
	}
	log.Printf("Created durable consumer: %s (DeliverPolicy: All)", ConsumerCommands)
	return nil
}

func commandsConsumerConfig() *nats.ConsumerConfig {
	return &nats.ConsumerConfig{
		Durable:       ConsumerCommands,
		Description:   "Orchestrator consumer for processing worker commands",
		DeliverPolicy: nats.DeliverAllPolicy,
		AckPolicy:     nats.AckExplicitPolicy,
		AckWait:       30 * time.Second,
		MaxDeliver:    5,
		FilterSubject: "WHATSAPP.commands.>",
		MaxAckPending: 1000,
	}
}

// SubscribeToCommands creates a pull subscription for processing commands.
func (c *Client) SubscribeToCommands(handler func(msg *nats.Msg)) (*nats.Subscription, error) {
	js := c.conn.JetStream()

	sub, err := js.PullSubscribe(
		"WHATSAPP.commands.>", // Match all company/connection specific subjects
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
	_, err := c.conn.JetStream().Publish(subject, data)
	if err != nil {
		return fmt.Errorf("failed to publish event: %w", err)
	}
	return nil
}

// PublishCommand publishes a command to the commands stream.
func (c *Client) PublishCommand(data []byte) error {
	_, err := c.conn.JetStream().Publish("WHATSAPP.commands", data)
	if err != nil {
		return fmt.Errorf("failed to publish command: %w", err)
	}
	return nil
}

// DeleteStreams removes the JetStream streams (useful for cleanup/testing).
func (c *Client) DeleteStreams() error {
	js := c.conn.JetStream()

	if err := sharednats.DeleteStream(js, sharednats.StreamCommands); err != nil {
		return err
	}
	if err := sharednats.DeleteStream(js, sharednats.StreamEvents); err != nil {
		return err
	}
	if err := sharednats.DeleteStream(js, sharednats.StreamDownloads); err != nil {
		return err
	}
	return nil
}
