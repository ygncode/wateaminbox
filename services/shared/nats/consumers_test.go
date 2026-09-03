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
	// EnsureEventsStream registers the critical/transient split on a fresh
	// stream - see TestEnsureEventsStreamCreatesOnlyCriticalAndTransientConsumers
	// for the full set and TestEnsureEventsStreamDoesNotCreateLegacyConsumer
	// for the explicit "no legacy on a fresh install" guarantee. This test
	// keeps its original, narrower scope: at least one durable consumer must
	// exist so events published before the API starts are never dropped.
	critical := fake.addedConsumers[APICriticalEventsConsumer]
	if critical == nil {
		t.Fatal("API critical events consumer was not created; events published before the API starts would be dropped")
	}
	if got := critical.Durable; got != APICriticalEventsConsumer {
		t.Errorf("created consumer %q, want %q", got, APICriticalEventsConsumer)
	}
	for _, stream := range fake.consumerStreams {
		if stream != StreamEvents {
			t.Errorf("consumer attached to %v, want every entry to be %s", fake.consumerStreams, StreamEvents)
		}
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

// --- Critical/transient consumer split --------------------------------

// allEventSubjectPatterns is every Subject* pattern defined in subjects.go
// that lives under WHATSAPP.events.>. Extend this map (and
// apiCriticalEventSubjectPatterns or apiTransientEventSubjectPatterns) when
// a new one is added; TestAPICriticalAndTransientFilterSubjectsCoverAllEventSubjects
// fails otherwise instead of silently leaking an uncovered subject.
func allEventSubjectPatterns() map[string]string {
	return map[string]string{
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
		"group":             SubjectGroup,
		"download_response": SubjectDownloadResponse,
		"connection_status": SubjectConnectionStatus,
	}
}

func TestAPICriticalAndTransientFilterSubjectsAreDisjoint(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range apiCriticalEventSubjectPatterns {
		seen[s] = true
	}
	for _, s := range apiTransientEventSubjectPatterns {
		if seen[s] {
			t.Errorf("subject pattern %q is in both the critical and transient filter lists; a consumer split must not double-deliver", s)
		}
	}
}

// Every subject the current single-consumer filter covers must land in
// exactly one of the two new consumers, or the split silently drops
// (uncovered) or double-processes (covered twice) events.
func TestAPICriticalAndTransientFilterSubjectsCoverAllEventSubjects(t *testing.T) {
	critical := map[string]bool{}
	for _, s := range apiCriticalEventSubjectPatterns {
		critical[s] = true
	}
	transient := map[string]bool{}
	for _, s := range apiTransientEventSubjectPatterns {
		transient[s] = true
	}

	for name, pattern := range allEventSubjectPatterns() {
		t.Run(name, func(t *testing.T) {
			inCritical := critical[pattern]
			inTransient := transient[pattern]
			if inCritical == inTransient {
				t.Fatalf("subject pattern %q (%s) must be covered by exactly one of apiCriticalEventSubjectPatterns/apiTransientEventSubjectPatterns; critical=%v transient=%v",
					pattern, name, inCritical, inTransient)
			}

			subject := fmt.Sprintf(pattern, "company-1", "connection-1")
			wantFilters := APICriticalEventsConsumerConfig().FilterSubjects
			if inTransient {
				wantFilters = APITransientEventsConsumerConfig().FilterSubjects
			}
			matched := false
			for _, filter := range wantFilters {
				if subjectMatches(filter, subject) {
					matched = true
					break
				}
			}
			if !matched {
				t.Fatalf("%q is not matched by the expected consumer's FilterSubjects %v", subject, wantFilters)
			}
		})
	}
}

func TestAPICriticalEventsConsumerConfigMatchesAPIClient(t *testing.T) {
	cfg := APICriticalEventsConsumerConfig()

	if cfg.Durable != "whatsapp-api-critical-events-v1" {
		t.Errorf("Durable = %q, want %q", cfg.Durable, "whatsapp-api-critical-events-v1")
	}
	if cfg.DeliverSubject != "WHATSAPP.api.critical-events.delivery" {
		t.Errorf("DeliverSubject = %q, want %q", cfg.DeliverSubject, "WHATSAPP.api.critical-events.delivery")
	}
	if cfg.DeliverGroup != "whatsapp-api-critical-events" {
		t.Errorf("DeliverGroup = %q, want %q", cfg.DeliverGroup, "whatsapp-api-critical-events")
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
	if cfg.DeliverPolicy != nats.DeliverNewPolicy {
		t.Errorf("DeliverPolicy = %v, want %v", cfg.DeliverPolicy, nats.DeliverNewPolicy)
	}
	if cfg.FilterSubject != "" {
		t.Errorf("FilterSubject = %q, want empty (must use FilterSubjects)", cfg.FilterSubject)
	}
	if len(cfg.FilterSubjects) == 0 {
		t.Fatal("FilterSubjects is empty")
	}
}

func TestAPITransientEventsConsumerConfigMatchesAPIClient(t *testing.T) {
	cfg := APITransientEventsConsumerConfig()

	if cfg.Durable != "whatsapp-api-transient-events-v1" {
		t.Errorf("Durable = %q, want %q", cfg.Durable, "whatsapp-api-transient-events-v1")
	}
	if cfg.DeliverSubject != "WHATSAPP.api.transient-events.delivery" {
		t.Errorf("DeliverSubject = %q, want %q", cfg.DeliverSubject, "WHATSAPP.api.transient-events.delivery")
	}
	if cfg.DeliverGroup != "whatsapp-api-transient-events" {
		t.Errorf("DeliverGroup = %q, want %q", cfg.DeliverGroup, "whatsapp-api-transient-events")
	}
	if cfg.AckWait != 30*time.Second {
		t.Errorf("AckWait = %v, want 30s", cfg.AckWait)
	}
	if cfg.MaxDeliver != 5 {
		t.Errorf("MaxDeliver = %d, want 5", cfg.MaxDeliver)
	}
	if cfg.MaxAckPending != 1024 {
		t.Errorf("MaxAckPending = %d, want 1024", cfg.MaxAckPending)
	}
	if cfg.DeliverPolicy != nats.DeliverNewPolicy {
		t.Errorf("DeliverPolicy = %v, want %v", cfg.DeliverPolicy, nats.DeliverNewPolicy)
	}
	want := []string{
		fmt.Sprintf(SubjectPresence, "*", "*"),
		fmt.Sprintf(SubjectTyping, "*", "*"),
	}
	if len(cfg.FilterSubjects) != len(want) {
		t.Fatalf("FilterSubjects = %v, want %v", cfg.FilterSubjects, want)
	}
	for i, s := range want {
		if cfg.FilterSubjects[i] != s {
			t.Errorf("FilterSubjects[%d] = %q, want %q", i, cfg.FilterSubjects[i], s)
		}
	}
}

// A fresh install (no pre-existing consumers) must get exactly the two new
// durables and nothing else - the legacy consumer only ever exists on a
// deployment that already had it before this split shipped.
func TestEnsureEventsStreamCreatesOnlyCriticalAndTransientConsumers(t *testing.T) {
	fake := &fakeJetStream{}

	if err := EnsureEventsStream(fake); err != nil {
		t.Fatalf("EnsureEventsStream: %v", err)
	}

	for _, durable := range []string{APICriticalEventsConsumer, APITransientEventsConsumer} {
		if _, ok := fake.addedConsumers[durable]; !ok {
			t.Errorf("EnsureEventsStream did not create durable consumer %q", durable)
		}
	}
	if len(fake.addedConsumers) != 2 {
		t.Errorf("addedConsumers = %v, want exactly 2 durables (fresh installs need only the critical/transient split)", fake.addedConsumers)
	}
}

// Complements the test above: explicitly pins that a fresh install never
// gets the legacy durable, since EnsureEventsStream no longer calls
// EnsureAPIEventsConsumer.
func TestEnsureEventsStreamDoesNotCreateLegacyConsumerOnFreshInstall(t *testing.T) {
	fake := &fakeJetStream{}

	if err := EnsureEventsStream(fake); err != nil {
		t.Fatalf("EnsureEventsStream: %v", err)
	}

	if _, ok := fake.addedConsumers[APIEventsConsumer]; ok {
		t.Errorf("EnsureEventsStream created the legacy consumer %q on a fresh install; fresh installs must not get it", APIEventsConsumer)
	}
	if _, err := fake.ConsumerInfo(StreamEvents, APIEventsConsumer); err == nil {
		t.Error("legacy consumer is registered after a fresh EnsureEventsStream run, want ErrConsumerNotFound")
	} else if err != nats.ErrConsumerNotFound {
		t.Errorf("ConsumerInfo(legacy) error = %v, want ErrConsumerNotFound", err)
	}
}

// Matching existing durables are kept so their acknowledgement floors are
// never reset. A mismatch fails closed: accepting a narrower filter could make
// API readiness healthy while critical events are silently discarded.
func TestEnsureSplitEventsConsumersKeepMatchingExistingConsumers(t *testing.T) {
	critical := *APICriticalEventsConsumerConfig()
	transient := *APITransientEventsConsumerConfig()
	fake := &fakeJetStream{existingConsumers: map[string]*nats.ConsumerInfo{
		APICriticalEventsConsumer:  {Stream: StreamEvents, Name: APICriticalEventsConsumer, Config: critical},
		APITransientEventsConsumer: {Stream: StreamEvents, Name: APITransientEventsConsumer, Config: transient},
	}}

	if err := EnsureEventsStream(fake); err != nil {
		t.Fatalf("EnsureEventsStream: %v", err)
	}
	if len(fake.addedConsumers) != 0 {
		t.Errorf("matching existing consumers were recreated: %v", fake.addedConsumers)
	}
}

func TestEnsureSplitEventsConsumerRejectsConfigurationMismatch(t *testing.T) {
	existing := *APICriticalEventsConsumerConfig()
	existing.FilterSubjects = existing.FilterSubjects[1:]
	fake := &fakeJetStream{existingConsumers: map[string]*nats.ConsumerInfo{
		APICriticalEventsConsumer: {Stream: StreamEvents, Name: APICriticalEventsConsumer, Config: existing},
	}}

	if err := EnsureAPICriticalEventsConsumer(fake); err == nil {
		t.Fatal("EnsureAPICriticalEventsConsumer accepted a mismatched filter configuration")
	}
	if fake.addedConsumers[APICriticalEventsConsumer] != nil {
		t.Error("EnsureAPICriticalEventsConsumer recreated a mismatched durable")
	}
}

// Documents the intentional cutover invariant for a deployment that already
// has the legacy consumer registered from before this split shipped:
// EnsureEventsStream must neither delete it nor recreate/touch it in any
// way. Retirement is a separate, explicitly confirmed manual production step
// (see the comment above APICriticalEventsConsumer in consumers.go), never a
// side effect of this function running again on a later deploy.
func TestEnsureEventsStreamLeavesPreExistingLegacyConsumerUntouched(t *testing.T) {
	existingLegacy := *APIEventsConsumerConfig()
	fake := &fakeJetStream{existingConsumers: map[string]*nats.ConsumerInfo{
		APIEventsConsumer: {Stream: StreamEvents, Name: APIEventsConsumer, Config: existingLegacy},
	}}

	if err := EnsureEventsStream(fake); err != nil {
		t.Fatalf("EnsureEventsStream: %v", err)
	}

	if _, ok := fake.addedConsumers[APIEventsConsumer]; ok {
		t.Error("EnsureEventsStream touched/recreated the pre-existing legacy consumer")
	}
	info, err := fake.ConsumerInfo(StreamEvents, APIEventsConsumer)
	if err != nil {
		t.Fatalf("pre-existing legacy consumer should remain registered until manually deleted: %v", err)
	}
	if info.Config.FilterSubject != APIEventsFilterSubject {
		t.Errorf("legacy consumer FilterSubject = %q, want unchanged %q", info.Config.FilterSubject, APIEventsFilterSubject)
	}
}
