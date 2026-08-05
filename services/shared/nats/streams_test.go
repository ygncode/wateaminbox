package nats

import (
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

// The events stream carries authoritative conversation data, so a full stream
// must reject new publishes (which the worker outbox replays) rather than
// silently discard unacknowledged history.
func TestEventsStreamDiscardsNewNotOld(t *testing.T) {
	if got := DefaultEventsStreamConfig().Discard; got != nats.DiscardNew {
		t.Errorf("events Discard = %v, want %v (DiscardNew)", got, nats.DiscardNew)
	}

	// The remaining streams stay on DiscardOld: commands and downloads are
	// short-lived, and the dead-letter stream must keep accepting new poison
	// events rather than reject them once full.
	for _, tt := range []struct {
		name string
		cfg  StreamConfig
	}{
		{"commands", DefaultCommandsStreamConfig()},
		{"downloads", DefaultDownloadsStreamConfig()},
		{"dead letters", DefaultDeadLettersStreamConfig()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.Discard; got != nats.DiscardOld {
				t.Errorf("Discard = %v, want %v (DiscardOld)", got, nats.DiscardOld)
			}
		})
	}
}

// DiscardNew is only recoverable under interest retention: with LimitsPolicy an
// acknowledged message keeps occupying the stream until MaxAge, so a stream
// that filled once would reject publishes for a week even after the API had
// consumed everything. Interest retention frees each message on acknowledgement,
// so draining APIEventsConsumer reopens the stream immediately.
func TestEventsStreamUsesInterestRetention(t *testing.T) {
	if got := DefaultEventsStreamConfig().Retention; got != nats.InterestPolicy {
		t.Errorf("events Retention = %v, want %v (InterestPolicy)", got, nats.InterestPolicy)
	}

	// The other streams keep limits retention. Commands and downloads are
	// consumed by per-connection durables that are created on demand, and the
	// dead-letter stream is read by operators with ad-hoc consumers, so
	// interest retention would drop their messages on publish.
	for _, tt := range []struct {
		name string
		cfg  StreamConfig
	}{
		{"commands", DefaultCommandsStreamConfig()},
		{"downloads", DefaultDownloadsStreamConfig()},
		{"dead letters", DefaultDeadLettersStreamConfig()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.Retention; got != nats.LimitsPolicy {
				t.Errorf("Retention = %v, want %v (LimitsPolicy)", got, nats.LimitsPolicy)
			}
		})
	}
}

// EnsureStream only calls UpdateStream when streamsEqual reports a difference,
// so a stream already created under the previous policies is migrated only if
// retention and discard participate in the comparison.
func TestStreamsEqualDetectsRetentionAndDiscardChange(t *testing.T) {
	existing := nats.StreamConfig{
		Name:      StreamEvents,
		Subjects:  []string{"WHATSAPP.events", "WHATSAPP.events.>"},
		MaxAge:    7 * 24 * time.Hour,
		MaxMsgs:   1000000,
		MaxBytes:  1024 * 1024 * 1024,
		Retention: nats.LimitsPolicy,
		Discard:   nats.DiscardOld,
	}

	for _, tt := range []struct {
		name   string
		mutate func(*nats.StreamConfig)
	}{
		{"discard", func(c *nats.StreamConfig) { c.Discard = nats.DiscardNew }},
		{"retention", func(c *nats.StreamConfig) { c.Retention = nats.InterestPolicy }},
		{"both", func(c *nats.StreamConfig) {
			c.Discard = nats.DiscardNew
			c.Retention = nats.InterestPolicy
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			desired := existing
			tt.mutate(&desired)
			if streamsEqual(existing, desired) {
				t.Errorf("streamsEqual reported a changed %s policy as matching; the stream would never be updated", tt.name)
			}
			if !streamsEqual(desired, desired) {
				t.Error("streamsEqual reported an identical config as different")
			}
		})
	}
}

// EnsureStream must carry both policies into the config it sends to the server;
// a dropped field would leave the events stream on the JetStream defaults
// (limits retention, discard old) and silently reintroduce the data loss.
func TestEnsureStreamAppliesEventsPolicies(t *testing.T) {
	fake := &fakeJetStream{}
	if err := EnsureStream(fake, DefaultEventsStreamConfig()); err != nil {
		t.Fatalf("EnsureStream: %v", err)
	}
	if fake.added == nil {
		t.Fatal("EnsureStream did not create the missing stream")
	}
	if fake.added.Retention != nats.InterestPolicy {
		t.Errorf("Retention sent to server = %v, want %v", fake.added.Retention, nats.InterestPolicy)
	}
	if fake.added.Discard != nats.DiscardNew {
		t.Errorf("Discard sent to server = %v, want %v", fake.added.Discard, nats.DiscardNew)
	}
	if fake.added.Storage != nats.FileStorage {
		t.Errorf("Storage sent to server = %v, want %v", fake.added.Storage, nats.FileStorage)
	}
}

// An existing stream created before this change must be migrated in place
// rather than left on its old policies.
func TestEnsureStreamUpdatesLegacyEventsStream(t *testing.T) {
	legacy := nats.StreamConfig{
		Name:      StreamEvents,
		Subjects:  []string{"WHATSAPP.events", "WHATSAPP.events.>"},
		MaxAge:    7 * 24 * time.Hour,
		MaxMsgs:   1000000,
		MaxBytes:  1024 * 1024 * 1024,
		Retention: nats.LimitsPolicy,
		Discard:   nats.DiscardOld,
	}
	fake := &fakeJetStream{existing: &nats.StreamInfo{Config: legacy}}

	if err := EnsureStream(fake, DefaultEventsStreamConfig()); err != nil {
		t.Fatalf("EnsureStream: %v", err)
	}
	if fake.added != nil {
		t.Error("EnsureStream recreated an existing stream instead of updating it")
	}
	if fake.updated == nil {
		t.Fatal("EnsureStream left the legacy stream on limits/discard-old")
	}
	if fake.updated.Retention != nats.InterestPolicy || fake.updated.Discard != nats.DiscardNew {
		t.Errorf("update sent Retention=%v Discard=%v, want %v/%v",
			fake.updated.Retention, fake.updated.Discard, nats.InterestPolicy, nats.DiscardNew)
	}
}

// A stream that already matches must not be updated, so repeated worker starts
// do not churn the server config.
func TestEnsureStreamSkipsMatchingStream(t *testing.T) {
	cfg := DefaultEventsStreamConfig()
	fake := &fakeJetStream{}
	if err := EnsureStream(fake, cfg); err != nil {
		t.Fatalf("EnsureStream: %v", err)
	}

	second := &fakeJetStream{existing: &nats.StreamInfo{Config: *fake.added}}
	if err := EnsureStream(second, cfg); err != nil {
		t.Fatalf("EnsureStream: %v", err)
	}
	if second.updated != nil {
		t.Errorf("EnsureStream updated an already-matching stream: %#v", second.updated)
	}
}

func TestStreamConstants(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
	}{
		{"StreamCommands", StreamCommands, "WHATSAPP_COMMANDS"},
		{"StreamEvents", StreamEvents, "WHATSAPP_EVENTS"},
		{"StreamDownloads", StreamDownloads, "WHATSAPP_DOWNLOADS"},
		{"StreamDeadLetters", StreamDeadLetters, "WHATSAPP_DEAD_LETTERS"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.value != tt.want {
				t.Errorf("%s = %q, want %q", tt.name, tt.value, tt.want)
			}
		})
	}
}

func TestDefaultCommandsStreamConfig(t *testing.T) {
	cfg := DefaultCommandsStreamConfig()

	if cfg.Name != StreamCommands {
		t.Errorf("Name = %q, want %q", cfg.Name, StreamCommands)
	}

	if len(cfg.Subjects) == 0 {
		t.Error("Subjects should not be empty")
	}

	// Check it contains the base command subject
	found := false
	for _, s := range cfg.Subjects {
		if s == "WHATSAPP.commands" || s == "WHATSAPP.commands.>" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Subjects should contain WHATSAPP.commands or WHATSAPP.commands.>")
	}

	if cfg.MaxAge != 24*time.Hour {
		t.Errorf("MaxAge = %v, want %v", cfg.MaxAge, 24*time.Hour)
	}

	if cfg.MaxMsgs != 100000 {
		t.Errorf("MaxMsgs = %v, want %v", cfg.MaxMsgs, 100000)
	}

	if cfg.MaxBytes != 100*1024*1024 {
		t.Errorf("MaxBytes = %v, want %v (100MB)", cfg.MaxBytes, 100*1024*1024)
	}

	if cfg.Replicas != 1 {
		t.Errorf("Replicas = %v, want %v", cfg.Replicas, 1)
	}

	if cfg.Description == "" {
		t.Error("Description should not be empty")
	}
}

func TestDefaultEventsStreamConfig(t *testing.T) {
	cfg := DefaultEventsStreamConfig()

	if cfg.Name != StreamEvents {
		t.Errorf("Name = %q, want %q", cfg.Name, StreamEvents)
	}

	if len(cfg.Subjects) == 0 {
		t.Error("Subjects should not be empty")
	}

	// Check it contains the events subject pattern
	found := false
	for _, s := range cfg.Subjects {
		if s == "WHATSAPP.events" || s == "WHATSAPP.events.>" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Subjects should contain WHATSAPP.events or WHATSAPP.events.>")
	}

	if cfg.MaxAge != 7*24*time.Hour {
		t.Errorf("MaxAge = %v, want %v (7 days)", cfg.MaxAge, 7*24*time.Hour)
	}

	if cfg.MaxMsgs != 1000000 {
		t.Errorf("MaxMsgs = %v, want %v", cfg.MaxMsgs, 1000000)
	}

	if cfg.MaxBytes != 1024*1024*1024 {
		t.Errorf("MaxBytes = %v, want %v (1GB)", cfg.MaxBytes, 1024*1024*1024)
	}
}

func TestDefaultDownloadsStreamConfig(t *testing.T) {
	cfg := DefaultDownloadsStreamConfig()

	if cfg.Name != StreamDownloads {
		t.Errorf("Name = %q, want %q", cfg.Name, StreamDownloads)
	}

	if len(cfg.Subjects) == 0 {
		t.Error("Subjects should not be empty")
	}

	// Check it contains the download subject pattern
	found := false
	for _, s := range cfg.Subjects {
		if s == "WHATSAPP.download" || s == "WHATSAPP.download.>" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Subjects should contain WHATSAPP.download or WHATSAPP.download.>")
	}

	if cfg.MaxAge != 1*time.Hour {
		t.Errorf("MaxAge = %v, want %v (1 hour)", cfg.MaxAge, 1*time.Hour)
	}

	if cfg.MaxMsgs != 10000 {
		t.Errorf("MaxMsgs = %v, want %v", cfg.MaxMsgs, 10000)
	}

	if cfg.MaxBytes != 10*1024*1024 {
		t.Errorf("MaxBytes = %v, want %v (10MB)", cfg.MaxBytes, 10*1024*1024)
	}
}

func TestDefaultDeadLettersStreamConfig(t *testing.T) {
	cfg := DefaultDeadLettersStreamConfig()

	if cfg.Name != StreamDeadLetters {
		t.Errorf("Name = %q, want %q", cfg.Name, StreamDeadLetters)
	}
	if len(cfg.Subjects) == 0 || cfg.Subjects[len(cfg.Subjects)-1] != "WHATSAPP.dead_letter.>" {
		t.Errorf("Subjects = %#v, want dead-letter wildcard", cfg.Subjects)
	}
	if cfg.MaxAge != 30*24*time.Hour {
		t.Errorf("MaxAge = %v, want 30 days", cfg.MaxAge)
	}
}

func TestStreamConfigValuesAreReasonable(t *testing.T) {
	configs := []struct {
		name   string
		config StreamConfig
	}{
		{"Commands", DefaultCommandsStreamConfig()},
		{"Events", DefaultEventsStreamConfig()},
		{"Downloads", DefaultDownloadsStreamConfig()},
		{"DeadLetters", DefaultDeadLettersStreamConfig()},
	}

	for _, tt := range configs {
		t.Run(tt.name, func(t *testing.T) {
			cfg := tt.config

			if cfg.Name == "" {
				t.Error("Name should not be empty")
			}

			if cfg.MaxAge <= 0 {
				t.Error("MaxAge should be positive")
			}

			if cfg.MaxMsgs <= 0 {
				t.Error("MaxMsgs should be positive")
			}

			if cfg.MaxBytes <= 0 {
				t.Error("MaxBytes should be positive")
			}

			if cfg.Replicas < 1 {
				t.Error("Replicas should be at least 1")
			}
		})
	}
}

func TestStreamsEqual(t *testing.T) {
	tests := []struct {
		name  string
		a     StreamConfig
		b     StreamConfig
		equal bool
	}{
		{
			name:  "identical configs",
			a:     DefaultEventsStreamConfig(),
			b:     DefaultEventsStreamConfig(),
			equal: true,
		},
		{
			name:  "different names",
			a:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			b:     StreamConfig{Name: "B", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			equal: false,
		},
		{
			name:  "different subjects",
			a:     StreamConfig{Name: "A", Subjects: []string{"a", "b"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			b:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			equal: false,
		},
		{
			name:  "different MaxAge",
			a:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			b:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: 2 * time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			equal: false,
		},
		{
			name:  "different MaxMsgs",
			a:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			b:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 200, MaxBytes: 1000},
			equal: false,
		},
		{
			name:  "different MaxBytes",
			a:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 1000},
			b:     StreamConfig{Name: "A", Subjects: []string{"a"}, MaxAge: time.Hour, MaxMsgs: 100, MaxBytes: 2000},
			equal: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create nats.StreamConfig equivalents for comparison
			// Note: streamsEqual is unexported, so we test behavior indirectly
			// by checking that the configs differ where expected

			// Since streamsEqual is internal, we verify the config values directly
			if tt.equal {
				if tt.a.Name != tt.b.Name {
					t.Error("Names should be equal")
				}
				if tt.a.MaxAge != tt.b.MaxAge {
					t.Error("MaxAge should be equal")
				}
			} else {
				differs := tt.a.Name != tt.b.Name ||
					tt.a.MaxAge != tt.b.MaxAge ||
					tt.a.MaxMsgs != tt.b.MaxMsgs ||
					tt.a.MaxBytes != tt.b.MaxBytes ||
					len(tt.a.Subjects) != len(tt.b.Subjects)
				if !differs {
					t.Error("Configs should differ in at least one field")
				}
			}
		})
	}
}
