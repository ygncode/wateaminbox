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

// --- Transient/critical event consumer split -------------------------------
//
// Presence and typing events are ephemeral, loss-tolerant, and can spike into
// the thousands right after a reconnect (WhatsApp resyncing presence for
// every contact). APIEventsConsumer above is a single ack-gated, serially
// processed push consumer filtering every event subject, so a presence storm
// queues ahead of (or interleaved with) a send_confirmation published only
// moments earlier for the same connection - delaying its processing far
// beyond what the worker's "immediate" publish would suggest, which is what
// let apps/api's 5-minute pending-message cleanup race a still-queued
// confirmation and mark a delivered message "failed".
//
// APICriticalEventsConsumer and APITransientEventsConsumer below split that
// single consumer into two independent durables on the same stream, each
// with its own delivery loop, so a transient-event burst cannot block
// critical-event processing. They are NEW, disjoint durable names rather
// than an in-place edit of APIEventsConsumer's FilterSubject, because:
//
//  1. nats-server does not support an "exclude" filter, so narrowing
//     APIEventsConsumer's FilterSubject to "everything except presence/
//     typing" requires switching it from a single FilterSubject to a
//     FilterSubjects list - a config shape change to a consumer already
//     live in production.
//  2. Changing a live durable's filter takes effect for future deliveries,
//     but does nothing for messages the consumer already has outstanding
//     (unacked/pending) under its old filter, and there is a window between
//     "old filter stops matching new presence publishes" and "new transient
//     consumer's filter starts matching them" where, if misordered, a
//     publish would match no consumer's filter at all - under interest
//     retention that publish is accepted and immediately discarded, with no
//     error and no way to recover it.
//
// A brand-new consumer name sidesteps both risks: it begins retaining new
// matching events when created, delivers them once explicitly bound, and never
// mutates APIEventsConsumer's acknowledgement floor.
//
// EnsureEventsStream (below) registers ONLY APICriticalEventsConsumer and
// APITransientEventsConsumer - it deliberately does not call
// EnsureAPIEventsConsumer any more. That split on its own already covers
// every WHATSAPP.events.* subject (see
// TestAPICriticalAndTransientFilterSubjectsCoverAllEventSubjects), so:
//
//   - A fresh install (stream and consumers created for the first time)
//     never gets APIEventsConsumer at all - there is nothing to retire
//     later, and interest retention is already fully covered by the two new
//     consumers alone.
//   - An existing production deployment that already has APIEventsConsumer
//     registered from before this split keeps it exactly as it was:
//     EnsureEventsStream no longer creates, recreates, or otherwise touches
//     it. It keeps its blanket FilterSubject and keeps receiving its own
//     independent copy of every event as the interest-retention safety net
//     through the cutover window below, right up until an operator
//     explicitly retires it.
//
// Required cutover for an existing deployment (deliberately NOT automated
// by this change):
//  1. Drain the legacy consumer, then stop every old API replica and every
//     WhatsApp event publisher before creating these consumers. Old and new
//     APIs must not overlap, and no event may be published in the gap: such an
//     event would be retained only by the legacy consumer, while an event seen
//     by both consumer generations can trigger non-idempotent side effects
//     twice.
//  2. Deploy this change, create the split consumers, and start only the new
//     API revision. Confirm APICriticalEventsConsumer and
//     APITransientEventsConsumer are healthy (num_pending/num_ack_pending
//     not climbing) and that presence bursts no longer show up as backlog
//     on the critical consumer.
//  3. Only then explicitly delete the legacy APIEventsConsumer durable
//     (e.g. `nats consumer rm WHATSAPP_EVENTS whatsapp-api-events-v1`).
//     Skipping this step leaves an unbound consumer accumulating unacked
//     interest on every event forever, which eventually fills
//     WHATSAPP_EVENTS (DiscardNew) and starts rejecting publishes
//     stream-wide.
//
// Step 3 is a deliberate, human-confirmed production action against a
// specific already-existing deployment and is not performed by any code in
// this repository.
const (
	APICriticalEventsConsumer       = "whatsapp-api-critical-events-v1"
	APICriticalEventsDeliverSubject = "WHATSAPP.api.critical-events.delivery"
	APICriticalEventsQueue          = "whatsapp-api-critical-events"

	APITransientEventsConsumer       = "whatsapp-api-transient-events-v1"
	APITransientEventsDeliverSubject = "WHATSAPP.api.transient-events.delivery"
	APITransientEventsQueue          = "whatsapp-api-transient-events"

	apiCriticalEventsAckWait       = 60 * time.Second
	apiCriticalEventsMaxDeliver    = 10
	apiCriticalEventsMaxAckPending = 128

	// Presence/typing are high-volume and tolerate loss, so this consumer
	// can carry a much larger in-flight window than the critical path
	// without risking data loss elsewhere; a shorter AckWait also recycles
	// stalled deliveries faster since redelivering a presence event is cheap.
	apiTransientEventsAckWait       = 30 * time.Second
	apiTransientEventsMaxDeliver    = 5
	apiTransientEventsMaxAckPending = 1024
)

// apiTransientEventSubjectPatterns are the sharednats.Subject* patterns that
// are ephemeral, high-volume, and safe to process independently of the
// critical path.
var apiTransientEventSubjectPatterns = []string{
	SubjectPresence,
	SubjectTyping,
}

// apiCriticalEventSubjectPatterns is every other WHATSAPP.events.* subject
// pattern from subjects.go. This list, together with
// apiTransientEventSubjectPatterns, must cover every Subject* constant in
// subjects.go - TestAPICriticalAndTransientFilterSubjectsCoverAllEventSubjects
// fails if a new one is added to subjects.go without being added here too.
//
// send_failed has no entry of its own: the worker publishes it on
// SubjectSendConfirm (see whatsapp/internal/nats/publisher.go
// PublishSendFailed), so it is already covered by that pattern.
var apiCriticalEventSubjectPatterns = []string{
	SubjectQR,
	SubjectStatus,
	SubjectMessage,
	SubjectReceipt,
	SubjectContact,
	SubjectProfilePicture,
	SubjectMessageRevoke,
	SubjectSendConfirm,
	SubjectReaction,
	SubjectSyncStatus,
	SubjectHistorySyncPage,
	SubjectLabels,
	SubjectCatalogs,
	SubjectCatalogProducts,
	SubjectCommandResult,
	SubjectGroup,
	SubjectDownloadResponse,
	SubjectConnectionStatus,
}

// wildcardSubjects renders each "WHATSAPP.events.%s.%s.<type>" pattern with
// NATS single-token wildcards, producing a concrete FilterSubjects entry
// (e.g. "WHATSAPP.events.*.*.presence") that matches that type across every
// company and connection.
func wildcardSubjects(patterns []string) []string {
	out := make([]string, len(patterns))
	for i, p := range patterns {
		out[i] = fmt.Sprintf(p, "*", "*")
	}
	return out
}

// APICriticalEventsConsumerConfig describes the durable, disjoint-from-legacy
// consumer for every WHATSAPP.events.* subject except presence/typing.
func APICriticalEventsConsumerConfig() *nats.ConsumerConfig {
	return &nats.ConsumerConfig{
		Durable:        APICriticalEventsConsumer,
		Description:    "API consumer for durable/critical WhatsApp events (message, receipt, send_confirmation, ...); excludes presence/typing so a presence storm cannot delay these - see APITransientEventsConsumer",
		DeliverSubject: APICriticalEventsDeliverSubject,
		DeliverGroup:   APICriticalEventsQueue,
		FilterSubjects: wildcardSubjects(apiCriticalEventSubjectPatterns),
		// Start at creation time. On an existing stream, replaying events already
		// handled by the legacy consumer would duplicate non-idempotent lifecycle
		// side effects during cutover.
		DeliverPolicy: nats.DeliverNewPolicy,
		AckPolicy:     nats.AckExplicitPolicy,
		AckWait:       apiCriticalEventsAckWait,
		MaxDeliver:    apiCriticalEventsMaxDeliver,
		MaxAckPending: apiCriticalEventsMaxAckPending,
		ReplayPolicy:  nats.ReplayInstantPolicy,
	}
}

// APITransientEventsConsumerConfig describes the durable consumer for
// ephemeral WhatsApp events (presence, typing), isolated from
// APICriticalEventsConsumer so bursts here cannot delay message/receipt/
// send_confirmation processing.
func APITransientEventsConsumerConfig() *nats.ConsumerConfig {
	return &nats.ConsumerConfig{
		Durable:        APITransientEventsConsumer,
		Description:    "API consumer for ephemeral WhatsApp events (presence, typing); isolated from APICriticalEventsConsumer",
		DeliverSubject: APITransientEventsDeliverSubject,
		DeliverGroup:   APITransientEventsQueue,
		FilterSubjects: wildcardSubjects(apiTransientEventSubjectPatterns),
		DeliverPolicy:  nats.DeliverNewPolicy,
		AckPolicy:      nats.AckExplicitPolicy,
		AckWait:        apiTransientEventsAckWait,
		MaxDeliver:     apiTransientEventsMaxDeliver,
		MaxAckPending:  apiTransientEventsMaxAckPending,
		ReplayPolicy:   nats.ReplayInstantPolicy,
	}
}

// ensureAPIEventsConsumerVariant is the shared idempotent create-if-missing
// body for the two split consumers. It intentionally does not replace
// EnsureAPIEventsConsumer's own body above, so the legacy consumer's
// long-lived production behavior stays byte-for-byte unchanged by this
// change.
func ensureAPIEventsConsumerVariant(js nats.JetStreamContext, name string, cfg *nats.ConsumerConfig) error {
	info, err := js.ConsumerInfo(StreamEvents, name)
	if err == nil {
		if !stringSlicesEqualUnordered(info.Config.FilterSubjects, cfg.FilterSubjects) ||
			info.Config.DeliverSubject != cfg.DeliverSubject ||
			info.Config.DeliverGroup != cfg.DeliverGroup ||
			info.Config.DeliverPolicy != cfg.DeliverPolicy ||
			info.Config.AckPolicy != cfg.AckPolicy ||
			info.Config.AckWait != cfg.AckWait ||
			info.Config.MaxDeliver != cfg.MaxDeliver ||
			info.Config.MaxAckPending != cfg.MaxAckPending {
			return fmt.Errorf(
				"consumer %s configuration does not match required split-consumer configuration; refusing to start because omitted event filters can cause silent data loss",
				name,
			)
		}
		return nil
	}
	if err != nats.ErrConsumerNotFound {
		return fmt.Errorf("failed to inspect consumer %s: %w", name, err)
	}

	if _, err := js.AddConsumer(StreamEvents, cfg); err != nil {
		return fmt.Errorf("failed to add consumer %s: %w", name, err)
	}
	log.Printf("Created durable consumer: %s", name)
	return nil
}

func stringSlicesEqualUnordered(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := make(map[string]int, len(a))
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
	}
	for _, count := range seen {
		if count != 0 {
			return false
		}
	}
	return true
}

// EnsureAPICriticalEventsConsumer registers the critical-path consumer if
// missing. An existing consumer is left untouched, matching
// EnsureAPIEventsConsumer's rationale: recreating it would reset the
// acknowledgement floor.
func EnsureAPICriticalEventsConsumer(js nats.JetStreamContext) error {
	return ensureAPIEventsConsumerVariant(js, APICriticalEventsConsumer, APICriticalEventsConsumerConfig())
}

// EnsureAPITransientEventsConsumer registers the transient-event consumer if
// missing. Same leave-untouched-if-existing rationale as
// EnsureAPICriticalEventsConsumer.
func EnsureAPITransientEventsConsumer(js nats.JetStreamContext) error {
	return ensureAPIEventsConsumerVariant(js, APITransientEventsConsumer, APITransientEventsConsumerConfig())
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
// EnsureEventsStream deliberately does NOT call EnsureAPIEventsConsumer.
// A fresh install has no legacy consumer and needs none: the critical and
// transient consumers below already have disjoint FilterSubjects that
// together cover every WHATSAPP.events.* subject (see
// TestAPICriticalAndTransientFilterSubjectsCoverAllEventSubjects), so
// interest retention is fully satisfied without it.
//
// A production deployment that already has APIEventsConsumer registered
// from before this split keeps it exactly as it is: this function never
// creates, recreates, or otherwise touches it. That existing consumer is
// left in place on purpose as the interest-retention safety net through the
// cutover window described above APICriticalEventsConsumer, and is removed
// only by the deliberate, separately confirmed manual step in step 3 there
// (e.g. `nats consumer rm WHATSAPP_EVENTS whatsapp-api-events-v1`) - never
// as a side effect of this function running again on a later deploy.
func EnsureEventsStream(js nats.JetStreamContext) error {
	if err := EnsureStream(js, DefaultEventsStreamConfig()); err != nil {
		return err
	}
	if err := EnsureAPICriticalEventsConsumer(js); err != nil {
		return err
	}
	return EnsureAPITransientEventsConsumer(js)
}

// EnsureAPIEventsConsumer registers the API's legacy durable events consumer
// if it is missing. An existing consumer is left untouched: the API owns its
// delivery tuning, and recreating it would reset the acknowledgement floor.
//
// EnsureEventsStream no longer calls this (see the cutover note above
// APICriticalEventsConsumer) - it is kept only as a historical/manual
// reference, e.g. for a one-off script inspecting or reasoning about an
// existing production deployment's legacy consumer. Nothing in this
// repository invokes it automatically any more.
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
