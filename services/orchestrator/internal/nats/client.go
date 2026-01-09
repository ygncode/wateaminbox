package nats

import (
	"context"
	"fmt"

	"github.com/nats-io/nats.go"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

// Config holds NATS client configuration.
type Config struct {
	URL string
}

// Client wraps the shared NATS connection with orchestrator-specific functionality.
type Client struct {
	conn *sharednats.Connection
}

// NewClient creates a new NATS client connection using the shared connection utilities.
func NewClient(ctx context.Context, cfg Config) (*Client, error) {
	conn, err := sharednats.NewConnection(ctx, sharednats.ConnectionConfig{
		URL:  cfg.URL,
		Name: "orchestrator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create NATS connection: %w", err)
	}

	return &Client{
		conn: conn,
	}, nil
}

// Close closes the NATS connection.
func (c *Client) Close() {
	if c.conn != nil {
		c.conn.Close()
	}
}

// Publish publishes a message to a subject.
func (c *Client) Publish(subject string, data []byte) error {
	return c.conn.Publish(subject, data)
}

// Subscribe creates a subscription to a subject.
func (c *Client) Subscribe(subject string, handler nats.MsgHandler) (*nats.Subscription, error) {
	return c.conn.Subscribe(subject, handler)
}

// QueueSubscribe creates a queue subscription.
func (c *Client) QueueSubscribe(subject, queue string, handler nats.MsgHandler) (*nats.Subscription, error) {
	return c.conn.QueueSubscribe(subject, queue, handler)
}

// JetStream returns the JetStream context.
func (c *Client) JetStream() nats.JetStreamContext {
	return c.conn.JetStream()
}

// Connection returns the underlying NATS connection.
func (c *Client) Connection() *nats.Conn {
	return c.conn.Conn()
}
