package nats

import (
	"testing"

	natsgo "github.com/nats-io/nats.go"
)

func TestCommandsConsumerConfigRetainsOfflineCommands(t *testing.T) {
	cfg := commandsConsumerConfig()

	if cfg.Durable != ConsumerCommands {
		t.Fatalf("expected durable %q, got %q", ConsumerCommands, cfg.Durable)
	}
	if cfg.DeliverPolicy != natsgo.DeliverAllPolicy {
		t.Fatalf("expected DeliverAllPolicy, got %v", cfg.DeliverPolicy)
	}
	if cfg.AckPolicy != natsgo.AckExplicitPolicy {
		t.Fatalf("expected explicit acknowledgements, got %v", cfg.AckPolicy)
	}
	if cfg.FilterSubject != "WHATSAPP.commands.>" {
		t.Fatalf("unexpected filter subject %q", cfg.FilterSubject)
	}
}
