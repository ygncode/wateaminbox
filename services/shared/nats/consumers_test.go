package nats

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

// subjectMatches reports whether a NATS subject filter matches a concrete
// subject, using the server's token rules: "*" matches one token, ">" matches
// one or more trailing tokens.
func subjectMatches(filter, subject string) bool {
	filterTokens := strings.Split(filter, ".")
	subjectTokens := strings.Split(subject, ".")

	for i, token := range filterTokens {
		if token == ">" {
			return i < len(subjectTokens)
		}
		if i >= len(subjectTokens) {
			return false
		}
		if token != "*" && token != subjectTokens[i] {
			return false
		}
	}
	return len(filterTokens) == len(subjectTokens)
}

func TestSubjectMatches(t *testing.T) {
	for _, tt := range []struct {
		filter, subject string
		want            bool
	}{
		{"WHATSAPP.events.>", "WHATSAPP.events.c1.k1.message", true},
		{"WHATSAPP.events.>", "WHATSAPP.events.c1", true},
		{"WHATSAPP.events.>", "WHATSAPP.events", false},
		{"WHATSAPP.events.>", "WHATSAPP.commands.c1", false},
		{"WHATSAPP.events.*.*.qr", "WHATSAPP.events.c1.k1.qr", true},
		{"WHATSAPP.events.*.*.qr", "WHATSAPP.events.c1.k1.message", false},
		{"WHATSAPP.events.*.*.qr", "WHATSAPP.events.c1.k1.qr.extra", false},
		{"WHATSAPP.api.events.delivery", "WHATSAPP.api.events.delivery", true},
	} {
		t.Run(tt.filter+"/"+tt.subject, func(t *testing.T) {
			if got := subjectMatches(tt.filter, tt.subject); got != tt.want {
				t.Errorf("subjectMatches(%q, %q) = %v, want %v", tt.filter, tt.subject, got, tt.want)
			}
		})
	}
}

// The API attaches to this durable by name from TypeScript. nats.js only binds
// to an existing consumer when the filter subject and queue group match, so a
// silent edit here would leave the API unable to subscribe. The expected values
// are duplicated as literals on purpose: they mirror
// apps/api/src/lib/nats/client.ts and changing either side must be deliberate.
func TestAPIEventsConsumerConfigMatchesAPIClient(t *testing.T) {
	cfg := APIEventsConsumerConfig()

	if cfg.Durable != "whatsapp-api-events-v1" {
		t.Errorf("Durable = %q, want %q (API_EVENTS_CONSUMER)", cfg.Durable, "whatsapp-api-events-v1")
	}
	if cfg.DeliverSubject != "WHATSAPP.api.events.delivery" {
		t.Errorf("DeliverSubject = %q, want %q (API_EVENTS_DELIVER_SUBJECT)", cfg.DeliverSubject, "WHATSAPP.api.events.delivery")
	}
	if cfg.DeliverGroup != "whatsapp-api-events" {
		t.Errorf("DeliverGroup = %q, want %q (API_EVENTS_QUEUE)", cfg.DeliverGroup, "whatsapp-api-events")
	}
	if cfg.FilterSubject != "WHATSAPP.events.>" {
		t.Errorf("FilterSubject = %q, want %q", cfg.FilterSubject, "WHATSAPP.events.>")
	}
	if cfg.DeliverPolicy != nats.DeliverAllPolicy {
		t.Errorf("DeliverPolicy = %v, want %v (opts.deliverAll)", cfg.DeliverPolicy, nats.DeliverAllPolicy)
	}
	if cfg.AckWait != 60*time.Second {
		t.Errorf("AckWait = %v, want 60s", cfg.AckWait)
	}
	if cfg.MaxDeliver != 10 {
		t.Errorf("MaxDeliver = %d, want 10", cfg.MaxDeliver)
	}
	if cfg.MaxAckPending != 128 {
		t.Errorf("MaxAckPending = %d, want 128", cfg.MaxAckPending)
	}
	if cfg.ReplayPolicy != nats.ReplayInstantPolicy {
		t.Errorf("ReplayPolicy = %v, want %v (opts.replayInstantly)", cfg.ReplayPolicy, nats.ReplayInstantPolicy)
	}
}

// Interest retention removes a message once the consumer acknowledges it. With
// AckNone the server would consider every delivery acknowledged immediately and
// drop events the API had not persisted yet.
func TestAPIEventsConsumerRequiresExplicitAcks(t *testing.T) {
	if got := APIEventsConsumerConfig().AckPolicy; got != nats.AckExplicitPolicy {
		t.Errorf("AckPolicy = %v, want %v", got, nats.AckExplicitPolicy)
	}
}

// Under interest retention a publish to a subject no consumer filters for is
// accepted and discarded, so the filter has to cover every event subject the
// workers and orchestrator publish.
func TestAPIEventsFilterCoversPublishedEventSubjects(t *testing.T) {
	patterns := map[string]string{
		"qr":                SubjectQR,
		"status":            SubjectStatus,
		"message":           SubjectMessage,
		"receipt":           SubjectReceipt,
		"presence":          SubjectPresence,
		"contact":           SubjectContact,
		"profile_picture":   SubjectProfilePicture,
		"message_revoke":    SubjectMessageRevoke,
		"send_confirmation": SubjectSendConfirm,
		"typing":            SubjectTyping,
		"reaction":          SubjectReaction,
		"sync_status":       SubjectSyncStatus,
		"history_sync_page": SubjectHistorySyncPage,
		"labels":            SubjectLabels,
		"catalogs":          SubjectCatalogs,
		"catalog_products":  SubjectCatalogProducts,
		"command_result":    SubjectCommandResult,
		"download_response": SubjectDownloadResponse,
		"connection_status": SubjectConnectionStatus,
	}

	eventsCfg := DefaultEventsStreamConfig()
	for name, pattern := range patterns {
		t.Run(name, func(t *testing.T) {
			subject := fmt.Sprintf(pattern, "company-1", "connection-1")

			captured := false
			for _, streamSubject := range eventsCfg.Subjects {
				if subjectMatches(streamSubject, subject) {
					captured = true
					break
				}
			}
			if !captured {
				t.Fatalf("%q is not captured by the events stream subjects %v", subject, eventsCfg.Subjects)
			}
			if !subjectMatches(APIEventsFilterSubject, subject) {
				t.Errorf("%q is stored by the events stream but not matched by %q, so interest retention drops it",
					subject, APIEventsFilterSubject)
			}
		})
	}
}

// The stream captures one subject the API filter misses: the bare
// "WHATSAPP.events". Under interest retention a publish there is acknowledged
// and then discarded, which is survivable only because nothing consumes it —
// the orchestrator's legacy publishStatusResponse is the sole producer and the
// API's durable has always filtered "WHATSAPP.events.>". Pin the subject list
// so a third subject cannot be added without confronting that drop.
func TestOnlyTheBareSubjectEscapesTheAPIFilter(t *testing.T) {
	subjects := DefaultEventsStreamConfig().Subjects
	want := []string{"WHATSAPP.events", "WHATSAPP.events.>"}

	if len(subjects) != len(want) {
		t.Fatalf("events stream subjects = %v, want %v", subjects, want)
	}
	for i, s := range subjects {
		if s != want[i] {
			t.Fatalf("events stream subjects = %v, want %v", subjects, want)
		}
	}

	if subjectMatches(APIEventsFilterSubject, "WHATSAPP.events") {
		t.Error("the bare subject is now covered by the API filter; update this test and the consumers.go note")
	}
	if !subjectMatches(APIEventsFilterSubject, "WHATSAPP.events.c1.k1.message") {
		t.Error("scoped event subjects must stay covered by the API filter")
	}
}

// A push consumer whose delivery subject is itself captured by the stream is
// rejected by nats-server ("deliver subject forms a cycle"), which would make
// EnsureEventsStream fail at startup.
func TestAPIEventsDeliverSubjectIsOutsideTheStream(t *testing.T) {
	for _, streamSubject := range DefaultEventsStreamConfig().Subjects {
		if subjectMatches(streamSubject, APIEventsDeliverSubject) {
			t.Errorf("deliver subject %q is captured by stream subject %q; nats-server rejects the consumer as a cycle",
				APIEventsDeliverSubject, streamSubject)
		}
	}
}

// The consumer has to exist before the first publish, otherwise interest
// retention discards events published by a worker that started before the API.
func TestEnsureEventsStreamCreatesStreamAndConsumer(t *testing.T) {
	fake := &fakeJetStream{}

	if err := EnsureEventsStream(fake); err != nil {
		t.Fatalf("EnsureEventsStream: %v", err)
	}
	if fake.added == nil {
		t.Fatal("events stream was not created")
	}
	if fake.addedConsumer == nil {
		t.Fatal("API events consumer was not created; events published before the API starts would be dropped")
	}
	if got := fake.addedConsumer.Durable; got != APIEventsConsumer {
		t.Errorf("created consumer %q, want %q", got, APIEventsConsumer)
	}
	if len(fake.consumerStreams) != 1 || fake.consumerStreams[0] != StreamEvents {
		t.Errorf("consumer attached to %v, want [%s]", fake.consumerStreams, StreamEvents)
	}
}

// Recreating the durable would reset the acknowledgement floor and replay the
// whole stream, so an existing consumer is left alone.
func TestEnsureAPIEventsConsumerKeepsExistingConsumer(t *testing.T) {
	existing := *APIEventsConsumerConfig()
	existing.MaxAckPending = 512 // operator tuning applied through the API
	fake := &fakeJetStream{existingConsumer: &nats.ConsumerInfo{
		Stream: StreamEvents,
		Name:   APIEventsConsumer,
		Config: existing,
	}}

	if err := EnsureAPIEventsConsumer(fake); err != nil {
		t.Fatalf("EnsureAPIEventsConsumer: %v", err)
	}
	if fake.addedConsumer != nil {
		t.Error("EnsureAPIEventsConsumer recreated an existing durable consumer")
	}
}
