// Package nats provides shared NATS client utilities for WhatsApp services.
package nats

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/ygncode-lab/whatsapp-web/services/shared/config"
)

// ConnectionConfig holds configuration for creating a NATS connection.
type ConnectionConfig struct {
	// URL is the NATS server URL (e.g., "nats://localhost:4222").
	URL string

	// Name is an optional client name for identification in NATS monitoring.
	Name string

	// RetryOnFailedConnect enables automatic retry on initial connection failure.
	// Defaults to true if not explicitly set.
	RetryOnFailedConnect *bool

	// MaxReconnects sets the maximum number of reconnection attempts.
	// Use -1 for unlimited reconnects. Defaults to -1.
	MaxReconnects *int

	// ReconnectWait sets the time to wait between reconnection attempts.
	// Defaults to 1 second.
	ReconnectWait time.Duration

	// DisconnectHandler is called when the connection is lost.
	DisconnectHandler func(err error)

	// ReconnectHandler is called when the connection is re-established.
	ReconnectHandler func()
}

// Connection wraps a NATS connection with JetStream support.
type Connection struct {
	nc  *nats.Conn
	js  nats.JetStreamContext
	cfg ConnectionConfig
}

// NewConnection creates a new NATS connection with the specified configuration.
// It returns a Connection with JetStream context initialized.
func NewConnection(ctx context.Context, cfg ConnectionConfig) (*Connection, error) {
	if cfg.URL == "" {
		return nil, fmt.Errorf("NATS URL is required")
	}

	opts := buildConnectionOptions(cfg)

	log.Printf("Connecting to NATS at %s...", config.RedactURL(cfg.URL))

	nc, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to get JetStream context: %w", err)
	}

	log.Printf("Connected to NATS successfully at %s", config.RedactURL(cfg.URL))

	return &Connection{
		nc:  nc,
		js:  js,
		cfg: cfg,
	}, nil
}

// buildConnectionOptions converts ConnectionConfig to nats.Option slice.
func buildConnectionOptions(cfg ConnectionConfig) []nats.Option {
	opts := make([]nats.Option, 0, 6)

	// Client name
	if cfg.Name != "" {
		opts = append(opts, nats.Name(cfg.Name))
	}

	// Retry on failed connect (default true)
	retryOnFailed := true
	if cfg.RetryOnFailedConnect != nil {
		retryOnFailed = *cfg.RetryOnFailedConnect
	}
	opts = append(opts, nats.RetryOnFailedConnect(retryOnFailed))

	// Max reconnects (default unlimited)
	maxReconnects := -1
	if cfg.MaxReconnects != nil {
		maxReconnects = *cfg.MaxReconnects
	}
	opts = append(opts, nats.MaxReconnects(maxReconnects))

	// Reconnect wait (default 1 second)
	reconnectWait := time.Second
	if cfg.ReconnectWait > 0 {
		reconnectWait = cfg.ReconnectWait
	}
	opts = append(opts, nats.ReconnectWait(reconnectWait))

	// Disconnect handler
	opts = append(opts, nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
		if err != nil {
			log.Printf("NATS disconnected: %v", err)
		}
		if cfg.DisconnectHandler != nil {
			cfg.DisconnectHandler(err)
		}
	}))

	// Reconnect handler
	opts = append(opts, nats.ReconnectHandler(func(nc *nats.Conn) {
		log.Printf("NATS reconnected to %s", config.RedactURL(nc.ConnectedUrl()))
		if cfg.ReconnectHandler != nil {
			cfg.ReconnectHandler()
		}
	}))

	return opts
}

// Conn returns the underlying NATS connection.
func (c *Connection) Conn() *nats.Conn {
	return c.nc
}

// JetStream returns the JetStream context.
func (c *Connection) JetStream() nats.JetStreamContext {
	return c.js
}

// Publish publishes a message to a subject using core NATS.
func (c *Connection) Publish(subject string, data []byte) error {
	return c.nc.Publish(subject, data)
}

// Subscribe creates a subscription to a subject.
func (c *Connection) Subscribe(subject string, handler nats.MsgHandler) (*nats.Subscription, error) {
	return c.nc.Subscribe(subject, handler)
}

// QueueSubscribe creates a queue subscription.
func (c *Connection) QueueSubscribe(subject, queue string, handler nats.MsgHandler) (*nats.Subscription, error) {
	return c.nc.QueueSubscribe(subject, queue, handler)
}

// PublishJS publishes a message to JetStream and returns the publish acknowledgment.
func (c *Connection) PublishJS(subject string, data []byte) (*nats.PubAck, error) {
	return c.js.Publish(subject, data)
}

// Close gracefully closes the NATS connection.
// It drains the connection before closing to ensure all pending messages are sent.
func (c *Connection) Close() {
	if c.nc != nil {
		c.nc.Drain()
	}
}

// IsConnected returns true if the connection is currently connected.
func (c *Connection) IsConnected() bool {
	return c.nc != nil && c.nc.IsConnected()
}

// ConnectedUrl returns the URL of the currently connected server.
func (c *Connection) ConnectedUrl() string {
	if c.nc != nil {
		return c.nc.ConnectedUrl()
	}
	return ""
}
