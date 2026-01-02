package nats

import (
	"context"
	"log"

	"github.com/nats-io/nats.go"
)

// Config holds NATS client configuration.
type Config struct {
	URL string
}

// Client wraps the NATS connection.
type Client struct {
	conn *nats.Conn
	js   nats.JetStreamContext
}

// NewClient creates a new NATS client connection.
func NewClient(ctx context.Context, cfg Config) (*Client, error) {
	log.Printf("Connecting to NATS at %s...", cfg.URL)

	conn, err := nats.Connect(cfg.URL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("NATS disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			log.Println("NATS reconnected")
		}),
	)
	if err != nil {
		return nil, err
	}

	js, err := conn.JetStream()
	if err != nil {
		conn.Close()
		return nil, err
	}

	log.Println("Connected to NATS successfully")

	return &Client{
		conn: conn,
		js:   js,
	}, nil
}

// Close closes the NATS connection.
func (c *Client) Close() {
	if c.conn != nil {
		c.conn.Drain()
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
	return c.js
}

// Connection returns the underlying NATS connection.
func (c *Client) Connection() *nats.Conn {
	return c.conn
}
