package nats

import (
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// Stream names used by WhatsApp services.
const (
	StreamCommands    = "WHATSAPP_COMMANDS"
	StreamEvents      = "WHATSAPP_EVENTS"
	StreamDownloads   = "WHATSAPP_DOWNLOADS"
	StreamDeadLetters = "WHATSAPP_DEAD_LETTERS"
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
	// Retention selects when a stored message becomes eligible for removal. The
	// zero value is nats.LimitsPolicy, which keeps every message until a limit
	// (MaxAge/MaxMsgs/MaxBytes) forces it out, regardless of acknowledgements.
	Retention nats.RetentionPolicy
	// Discard selects the behaviour when a limit is reached. The zero value is
	// nats.DiscardOld, which silently removes the oldest messages even when a
	// consumer has not acknowledged them.
	Discard nats.DiscardPolicy
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
//
// Discard is DiscardNew rather than DiscardOld because this stream carries
// authoritative conversation data. Producers are far more parallel than the
// single API event consumer: each worker runs a history-sync pool, so several
// connections synchronising at once can outrun the consumer and reach MaxBytes.
// Under DiscardOld JetStream would drop the oldest messages, which are exactly
// the ones the API has not processed yet, losing conversation history silently.
// DiscardNew instead fails the publish, and the worker's PostgreSQL event
// outbox retains the event and replays it once the consumer drains.
//
// Retention is InterestPolicy so that DiscardNew can recover. Under
// LimitsPolicy an acknowledged message still occupies the stream until MaxAge
// expires, so a stream that once hit MaxMsgs/MaxBytes would keep rejecting
// publishes for up to a week even after the API had consumed everything —
// the outbox would never drain. Interest retention deletes each message as
// soon as APIEventsConsumer acknowledges (or terminates) it, so draining the
// consumer immediately reopens the stream for new publishes.
//
// Interest retention only stores a message when a consumer already filters its
// subject, so APIEventsConsumer must exist before the first publish. Use
// EnsureEventsStream, which creates both, rather than calling EnsureStream
// with this config directly.
func DefaultEventsStreamConfig() StreamConfig {
	return StreamConfig{
		Name:        StreamEvents,
		Subjects:    []string{"WHATSAPP.events", "WHATSAPP.events.>"},
		Description: "WhatsApp events (connected, disconnected, message, qr)",
		MaxAge:      7 * 24 * time.Hour,
		MaxMsgs:     1000000,
		MaxBytes:    1024 * 1024 * 1024, // 1GB
		Replicas:    1,
		Retention:   nats.InterestPolicy,
		Discard:     nats.DiscardNew,
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

// DefaultDeadLettersStreamConfig retains poison events after consumers stop
// redelivery. It is deliberately separate from WHATSAPP_EVENTS so the API
// event consumer cannot consume its own dead-letter publications.
func DefaultDeadLettersStreamConfig() StreamConfig {
	return StreamConfig{
		Name:        StreamDeadLetters,
		Subjects:    []string{"WHATSAPP.dead_letter", "WHATSAPP.dead_letter.>"},
		Description: "Terminal WhatsApp events retained for operator inspection and replay",
		MaxAge:      30 * 24 * time.Hour,
		MaxMsgs:     100000,
		MaxBytes:    256 * 1024 * 1024, // 256MB
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
		Retention:   cfg.Retention,
		Replicas:    replicas,
		Discard:     cfg.Discard,
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
	// Retention and Discard must be compared so a stream created under previous
	// policies is updated in place rather than left on the old behaviour.
	// nats-server accepts both as in-place updates and keeps already-stored
	// messages (verified against nats-server 2.10, the version deployed by
	// docker-compose).
	return a.MaxAge == b.MaxAge && a.MaxMsgs == b.MaxMsgs && a.MaxBytes == b.MaxBytes &&
		a.Retention == b.Retention && a.Discard == b.Discard
}

// DeleteStream deletes a stream by name.
func DeleteStream(js nats.JetStreamContext, name string) error {
	err := js.DeleteStream(name)
	if err != nil && err != nats.ErrStreamNotFound {
		return fmt.Errorf("failed to delete stream %s: %w", name, err)
	}
	return nil
}
