package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"

	_ "github.com/mattn/go-sqlite3"
)

// Config holds store configuration.
type Config struct {
	DataDir   string
	CompanyID string
	Logger    waLog.Logger
}

// NewStore creates a new SQLite store container for whatsmeow session storage.
// The database is stored at DATA_DIR/sessions.db
func NewStore(ctx context.Context, cfg Config) (*sqlstore.Container, error) {
	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data directory: %w", err)
	}

	// Construct database path
	dbPath := filepath.Join(cfg.DataDir, "sessions.db")
	dbURI := fmt.Sprintf("file:%s?_foreign_keys=on", dbPath)

	// Create the store container
	container, err := sqlstore.New(ctx, "sqlite3", dbURI, cfg.Logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create SQL store: %w", err)
	}

	return container, nil
}

// GetOrCreateDevice retrieves an existing device or creates a new one.
// If companyID is provided, it can be used to identify the device.
func GetOrCreateDevice(ctx context.Context, container *sqlstore.Container) (*store.Device, error) {
	// Try to get the first existing device
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get device: %w", err)
	}

	return device, nil
}
