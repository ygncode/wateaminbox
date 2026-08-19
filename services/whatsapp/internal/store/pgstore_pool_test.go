package store

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const validUUID = "00000000-0000-0000-0000-000000000001"

func TestNewPGContainer_RejectsNegativeMaxOpenConns(t *testing.T) {
	_, err := NewPGContainer(context.Background(), PGConfig{
		DatabaseURL:  "postgres://localhost:5432/test",
		ConnectionID: validUUID,
		MaxOpenConns: -1,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must be positive")
}

func TestNewPGContainer_RejectsNegativeMaxIdleConns(t *testing.T) {
	_, err := NewPGContainer(context.Background(), PGConfig{
		DatabaseURL:  "postgres://localhost:5432/test",
		ConnectionID: validUUID,
		MaxIdleConns: -1,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must be non-negative")
}

func TestNewPGContainer_RejectsNegativeConnMaxLifetime(t *testing.T) {
	_, err := NewPGContainer(context.Background(), PGConfig{
		DatabaseURL:     "postgres://localhost:5432/test",
		ConnectionID:    validUUID,
		ConnMaxLifetime: -1 * time.Second,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "LIFETIME must be non-negative")
}

func TestNewPGContainer_RejectsNegativeConnMaxIdleTime(t *testing.T) {
	_, err := NewPGContainer(context.Background(), PGConfig{
		DatabaseURL:     "postgres://localhost:5432/test",
		ConnectionID:    validUUID,
		ConnMaxIdleTime: -1 * time.Second,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "IDLE_TIME must be non-negative")
}
