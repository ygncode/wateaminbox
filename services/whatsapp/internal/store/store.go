package store

import (
	"context"
	"fmt"
	"time"

	"go.mau.fi/whatsmeow/store"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Config holds store configuration.
type Config struct {
	// DatabaseURL is the PostgreSQL connection string
	DatabaseURL string
	// ConnectionID is the UUID for isolating session data (required)
	ConnectionID string
	// RequiredRole rejects accidental manager/control-plane credentials.
	RequiredRole string
	// Logger is the whatsmeow logger
	Logger waLog.Logger

	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
}

// NewStore creates a new PostgreSQL store container for whatsmeow session storage.
// The store uses the whatsapp_sessions schema and filters all data by connection_id.
func NewStore(ctx context.Context, cfg Config) (*PGContainer, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("database_url is required")
	}
	if cfg.ConnectionID == "" {
		return nil, fmt.Errorf("connection_id is required")
	}

	container, err := NewPGContainer(ctx, PGConfig{
		DatabaseURL:     cfg.DatabaseURL,
		ConnectionID:    cfg.ConnectionID,
		RequiredRole:    cfg.RequiredRole,
		Logger:          cfg.Logger,
		MaxOpenConns:    cfg.MaxOpenConns,
		MaxIdleConns:    cfg.MaxIdleConns,
		ConnMaxLifetime: cfg.ConnMaxLifetime,
		ConnMaxIdleTime: cfg.ConnMaxIdleTime,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create PostgreSQL store: %w", err)
	}

	return container, nil
}

// GetOrCreateDevice retrieves an existing device or creates a new one.
func GetOrCreateDevice(ctx context.Context, container *PGContainer) (*store.Device, error) {
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get device: %w", err)
	}

	return device, nil
}
