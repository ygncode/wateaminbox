package nats

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

// Consumer names (orchestrator-specific)
const (
	ConsumerCommands = "orchestrator-commands"

	// ConsumerNodeCommandsPrefix prefixes each node's durable consumer name.
	ConsumerNodeCommandsPrefix = "orchestrator-node-"

	// NodeCommandSubjectPrefix prefixes commands addressed to one orchestrator
	// node. These subjects sit inside the shared commands stream, so the shared
	// consumer also sees them and must ack-and-skip; only the owning node's
	// filtered consumer processes them.
	NodeCommandSubjectPrefix = "WHATSAPP.commands.node."
)

// NodeCommandSubject addresses a command to the orchestrator node that owns
// the given connection.
func NodeCommandSubject(nodeID, companyID, connectionID string) string {
	return fmt.Sprintf("%s%s.%s.%s", NodeCommandSubjectPrefix, nodeID, companyID, connectionID)
}

// IsNodeCommandSubject reports whether a subject is node-addressed.
func IsNodeCommandSubject(subject string) bool {
	return strings.HasPrefix(subject, NodeCommandSubjectPrefix)
}

// CreateStreams creates the required JetStream streams for the orchestrator.
// Uses shared stream configurations from the shared/nats package.
func (c *Client) CreateStreams() error {
	log.Println("Setting up JetStream streams...")
	js := c.conn.JetStream()

	// Create commands stream using shared config
	if err := sharednats.EnsureStream(js, sharednats.DefaultCommandsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create commands stream: %w", err)
	}

	// Create events stream (with the API's durable consumer) using shared config
	if err := sharednats.EnsureEventsStream(js); err != nil {
		return fmt.Errorf("failed to create events stream: %w", err)
	}

	// Create downloads stream using shared config
	if err := sharednats.EnsureStream(js, sharednats.DefaultDownloadsStreamConfig()); err != nil {
		return fmt.Errorf("failed to create downloads stream: %w", err)
	}

	if err := sharednats.EnsureStream(js, sharednats.DefaultDeadLettersStreamConfig()); err != nil {
		return fmt.Errorf("failed to create dead-letter stream: %w", err)
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

// SubscribeToNodeCommands creates this node's durable consumer and pull
// subscription for commands forwarded to it by other orchestrator instances.
// Existing consumer state is retained so commands forwarded while this node
// was offline are delivered after restart.
func (c *Client) SubscribeToNodeCommands(nodeID string) (*nats.Subscription, error) {
	js := c.conn.JetStream()
	durable := ConsumerNodeCommandsPrefix + nodeID
	filter := NodeCommandSubjectPrefix + nodeID + ".>"

	if _, err := js.ConsumerInfo(sharednats.StreamCommands, durable); err == nil {
		log.Printf("Reusing durable consumer %s", durable)
	} else if err != nats.ErrConsumerNotFound {
		return nil, fmt.Errorf("failed to inspect consumer %s: %w", durable, err)
	} else {
		consumerCfg := &nats.ConsumerConfig{
			Durable:       durable,
			Description:   "Orchestrator node consumer for commands owned by " + nodeID,
			DeliverPolicy: nats.DeliverAllPolicy,
			AckPolicy:     nats.AckExplicitPolicy,
			AckWait:       30 * time.Second,
			MaxDeliver:    5,
			FilterSubject: filter,
			MaxAckPending: 1000,
		}
		if _, err := js.AddConsumer(sharednats.StreamCommands, consumerCfg); err != nil {
			return nil, fmt.Errorf("failed to add consumer %s: %w", durable, err)
		}
		log.Printf("Created durable consumer: %s (filter %s)", durable, filter)
	}

	sub, err := js.PullSubscribe(filter, durable, nats.ManualAck())
	if err != nil {
		return nil, fmt.Errorf("failed to create node pull subscription: %w", err)
	}
	return sub, nil
}

// ForwardCommandToNode republishes a command onto the owning node's subject.
// The headers carry the forwarding hop count so an ownership race cannot
// bounce one command between nodes forever.
func (c *Client) ForwardCommandToNode(nodeID, companyID, connectionID string, data []byte, hops int) error {
	msg := nats.NewMsg(NodeCommandSubject(nodeID, companyID, connectionID))
	msg.Data = data
	msg.Header.Set(ForwardHopsHeader, fmt.Sprint(hops))
	if _, err := c.conn.JetStream().PublishMsg(msg); err != nil {
		return fmt.Errorf("failed to forward command to node %s: %w", nodeID, err)
	}
	return nil
}

// ForwardHopsHeader counts how many times a command has been forwarded
// between orchestrator nodes.
const ForwardHopsHeader = "Wa-Forward-Hops"

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
	if err := sharednats.DeleteStream(js, sharednats.StreamDeadLetters); err != nil {
		return err
	}
	return nil
}
