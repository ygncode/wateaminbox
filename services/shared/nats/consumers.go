package nats

import (
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// Durable consumer used by the API to drain WHATSAPP_EVENTS.
//
// These values mirror apps/api/src/lib/nats/client.ts
// (API_EVENTS_CONSUMER / API_EVENTS_DELIVER_SUBJECT / API_EVENTS_QUEUE and
// buildEventConsumerOptions). The API attaches to the durable by name, so the
// two definitions must stay in step: nats.js only binds to an existing durable
// when the filter subject and queue group match.
const (
	APIEventsConsumer       = "whatsapp-api-events-v1"
	APIEventsDeliverSubject = "WHATSAPP.api.events.delivery"
	APIEventsQueue          = "whatsapp-api-events"
	// APIEventsFilterSubject must cover every subject a consumer needs, because
	// interest retention drops publishes it does not match. Every subject in
	// subjects.go carries company and connection tokens and is covered; the
	// bare "WHATSAPP.events" subject the stream also captures is not. The
	// orchestrator's legacy publishStatusResponse still publishes there, and
	// nothing has ever consumed it — the API's durable is the only consumer on
	// this stream and has always filtered "WHATSAPP.events.>". See
	// orchestrator internal/types.SubjectEvents.
	APIEventsFilterSubject = "WHATSAPP.events.>"
	apiEventsAckWait       = 60 * time.Second
	apiEventsMaxDeliver    = 10
	apiEventsMaxAckPending = 128
)

// APIEventsConsumerConfig describes the API's durable events consumer.
func APIEventsConsumerConfig() *nats.ConsumerConfig {
	return &nats.ConsumerConfig{
		Durable:        APIEventsConsumer,
		Description:    "API consumer for WhatsApp events (owned by apps/api, pre-created so interest retention never drops events)",
		DeliverSubject: APIEventsDeliverSubject,
		DeliverGroup:   APIEventsQueue,
		FilterSubject:  APIEventsFilterSubject,
		DeliverPolicy:  nats.DeliverAllPolicy,
		AckPolicy:      nats.AckExplicitPolicy,
		AckWait:        apiEventsAckWait,
		MaxDeliver:     apiEventsMaxDeliver,
		MaxAckPending:  apiEventsMaxAckPending,
		ReplayPolicy:   nats.ReplayInstantPolicy,
	}
}

// EnsureEventsStream creates or updates the events stream together with the
// API's durable consumer.
//
// The consumer is created here rather than left to the API because the events
// stream uses interest retention: JetStream only stores a published message if
// a consumer is already registered for its subject. A worker that publishes
// before the API has ever subscribed would otherwise have its events accepted
// and silently discarded. Registering the durable up front also makes the
// stream safe across API downtime — an unbound push consumer holds its
// messages instead of redelivering them into a subject nobody listens on.
func EnsureEventsStream(js nats.JetStreamContext) error {
	if err := EnsureStream(js, DefaultEventsStreamConfig()); err != nil {
		return err
	}
	return EnsureAPIEventsConsumer(js)
}

// EnsureAPIEventsConsumer registers the API's durable events consumer if it is
// missing. An existing consumer is left untouched: the API owns its delivery
// tuning, and recreating it would reset the acknowledgement floor.
func EnsureAPIEventsConsumer(js nats.JetStreamContext) error {
	info, err := js.ConsumerInfo(StreamEvents, APIEventsConsumer)
	if err == nil {
		if info.Config.FilterSubject != APIEventsFilterSubject {
			// Interest retention only keeps what this filter matches, so a
			// narrower filter silently drops the rest on publish.
			log.Printf(
				"WARNING: consumer %s filters %q, not %q; events outside that filter are dropped on publish",
				APIEventsConsumer, info.Config.FilterSubject, APIEventsFilterSubject,
			)
		}
		return nil
	}
	if err != nats.ErrConsumerNotFound {
		return fmt.Errorf("failed to inspect consumer %s: %w", APIEventsConsumer, err)
	}

	if _, err := js.AddConsumer(StreamEvents, APIEventsConsumerConfig()); err != nil {
		return fmt.Errorf("failed to add consumer %s: %w", APIEventsConsumer, err)
	}
	log.Printf("Created durable consumer: %s", APIEventsConsumer)
	return nil
}
