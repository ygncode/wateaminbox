package types

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

// The events stream uses interest retention, so a publish the API's durable
// consumer does not filter for is acknowledged and then discarded. SubjectEvents
// is such a subject, and publishStatusResponse still uses it — which is only
// tolerable because nothing has ever consumed it. This pins that reasoning: if
// the constant is ever changed into a delivered subject, the payloads on it
// (types.WorkerStatusResponse, not a sharednats.WhatsAppEvent envelope) would
// start failing the API's parser and land in the dead-letter stream instead.
func TestSubjectEventsIsNotCoveredByTheAPIConsumerFilter(t *testing.T) {
	require.Equal(t, "WHATSAPP.events", SubjectEvents)

	// "WHATSAPP.events.>" matches only subjects with a token after "events".
	prefix := strings.TrimSuffix(sharednats.APIEventsFilterSubject, ">")
	require.Equal(t, "WHATSAPP.events.", prefix)

	assert.False(t, strings.HasPrefix(SubjectEvents, prefix),
		"SubjectEvents is now delivered to the API; its payloads must be WhatsAppEvent envelopes or the API will dead-letter them")
}

// The scoped subject the orchestrator uses for connection status must stay
// inside the API filter — that one carries a WhatsAppEvent envelope and is the
// path the API actually consumes.
func TestConnectionStatusSubjectIsCoveredByTheAPIConsumerFilter(t *testing.T) {
	prefix := strings.TrimSuffix(sharednats.APIEventsFilterSubject, ">")

	assert.True(t, strings.HasPrefix(sharednats.SubjectConnectionStatus, prefix),
		"connection status events would be dropped on publish under interest retention")
}
