package manager

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// shutdownBudget mirrors the timeout main.go allows itself to shut down. Docker
// must not SIGKILL before the orchestrator has spent it: the marking of durable
// worker records happens inside that window, and losing it makes healthy
// connections look crashed to the next orchestrator process.
const shutdownBudget = 30 * time.Second

// serviceStopGracePeriod reads stop_grace_period out of one service block of a
// Compose file. This scans rather than parses YAML so the orchestrator module
// keeps its dependency set; the assertion is narrow enough not to need a full
// parser, and it fails loudly if the block cannot be found.
func serviceStopGracePeriod(t *testing.T, composePath, service string) (time.Duration, bool) {
	t.Helper()

	content, err := os.ReadFile(composePath)
	require.NoError(t, err, "production Compose file must be readable")

	const serviceIndent = "  "
	inService := false
	found := false
	var value string

	for _, line := range strings.Split(string(content), "\n") {
		if line == serviceIndent+service+":" {
			inService = true
			continue
		}
		if !inService {
			continue
		}
		// A new key at service indentation ends this service's block.
		if strings.HasPrefix(line, serviceIndent) && !strings.HasPrefix(line, serviceIndent+" ") &&
			strings.TrimSpace(line) != "" {
			break
		}
		if trimmed := strings.TrimSpace(line); strings.HasPrefix(trimmed, "stop_grace_period:") {
			value = strings.TrimSpace(strings.TrimPrefix(trimmed, "stop_grace_period:"))
			found = true
			break
		}
	}
	require.True(t, inService, "service %q not found in %s", service, composePath)
	if !found {
		return 0, false
	}

	grace, err := time.ParseDuration(value)
	require.NoErrorf(t, err, "stop_grace_period %q is not a duration", value)
	return grace, true
}

func TestProductionComposeGivesOrchestratorRoomToShutDown(t *testing.T) {
	composePath := filepath.Join("..", "..", "..", "..", "compose.production.yml")
	if _, err := os.Stat(composePath); os.IsNotExist(err) {
		t.Skipf("production Compose file not present at %s", composePath)
	}

	grace, ok := serviceStopGracePeriod(t, composePath, "orchestrator")
	require.True(t, ok,
		"orchestrator needs an explicit stop_grace_period; Docker's 10s default "+
			"SIGKILLs it partway through stopping workers")
	assert.Greater(t, grace, shutdownBudget,
		"stop_grace_period must exceed the %s shutdown budget in main.go", shutdownBudget)
}

// Ties the shutdown budget to what stopping a worker actually costs, so a
// change to either has to be made deliberately.
//
// Stop runs the workers concurrently, so the wall-clock cost is one worker's
// grace period rather than the sum over all of them. That is what makes the
// budget hold at GLOBAL_MAX_ACTIVE_CONNECTIONS: stopping them in turn cost
// about 7s each and overran 30s at roughly four workers.
func TestShutdownBudgetCoversConcurrentWorkerStops(t *testing.T) {
	const (
		gracePerWorker = 5 * time.Second // waitForProcessExit before SIGKILL
		killWait       = 2 * time.Second // waitForProcessExit after SIGKILL
	)

	// Concurrent stops all run the same timers at once, so the slowest worker
	// sets the total regardless of how many there are.
	worst := gracePerWorker + killWait
	assert.Less(t, worst, shutdownBudget,
		"a single worker stop no longer fits the shutdown budget")
	assert.LessOrEqual(t, 2*worst, shutdownBudget,
		"the budget should leave room for registry and NATS teardown after the "+
			"workers stop; revisit it together with the Compose stop_grace_period")
}
