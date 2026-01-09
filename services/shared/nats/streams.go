package nats

import (
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// Stream names used by WhatsApp services.
const (
	StreamCommands  = "WHATSAPP_COMMANDS"
	StreamEvents    = "WHATSAPP_EVENTS"
	StreamDownloads = "WHATSAPP_DOWNLOADS"
)

// StreamConfig holds configuration for creating a JetStream stream.
type StreamConfig struct {
	Name        string
	Subjects    []string
	Description string
	MaxAge      time.Duration
	MaxMsgs     int64
	MaxBytes    int64
	Replicas    int
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
		Replicas:    1,
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
		Replicas:    1,
	}
}

// DefaultDownloadsStreamConfig returns the default configuration for the downloads stream.
func DefaultDownloadsStreamConfig() StreamConfig {
	return StreamConfig{
		Name:        StreamDownloads,
		Subjects:    []string{"WHATSAPP.download", "WHATSAPP.download.>"},
		Description: "On-demand media download requests from API to WhatsApp workers",
		MaxAge:      1 * time.Hour,
		MaxMsgs:     10000,
		MaxBytes:    10 * 1024 * 1024, // 10MB
		Replicas:    1,
	}
}

// EnsureStream creates a stream if it doesn't exist, or updates it if configuration differs.
func EnsureStream(js nats.JetStreamContext, cfg StreamConfig) error {
	replicas := cfg.Replicas
	if replicas < 1 {
		replicas = 1
	}

	streamCfg := &nats.StreamConfig{
		Name:        cfg.Name,
		Subjects:    cfg.Subjects,
		Description: cfg.Description,
		MaxAge:      cfg.MaxAge,
		MaxMsgs:     cfg.MaxMsgs,
		MaxBytes:    cfg.MaxBytes,
		Storage:     nats.FileStorage,
		Retention:   nats.LimitsPolicy,
		Replicas:    replicas,
		Discard:     nats.DiscardOld,
	}

	// Try to get existing stream
	stream, err := js.StreamInfo(cfg.Name)
	if err != nil {
		if err == nats.ErrStreamNotFound {
			// Create new stream
			_, err = js.AddStream(streamCfg)
			if err != nil {
				return fmt.Errorf("failed to add stream %s: %w", cfg.Name, err)
			}
			log.Printf("Created stream: %s", cfg.Name)
			return nil
		}
		return fmt.Errorf("failed to get stream info for %s: %w", cfg.Name, err)
	}

	// Update existing stream if configuration differs
	if !streamsEqual(stream.Config, *streamCfg) {
		_, err = js.UpdateStream(streamCfg)
		if err != nil {
			return fmt.Errorf("failed to update stream %s: %w", cfg.Name, err)
		}
		log.Printf("Updated stream: %s", cfg.Name)
	} else {
		log.Printf("Stream already exists: %s", cfg.Name)
	}

	return nil
}

// streamsEqual compares two stream configs for equality.
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

// DeleteStream deletes a stream by name.
func DeleteStream(js nats.JetStreamContext, name string) error {
	err := js.DeleteStream(name)
	if err != nil && err != nats.ErrStreamNotFound {
		return fmt.Errorf("failed to delete stream %s: %w", name, err)
	}
	return nil
}
