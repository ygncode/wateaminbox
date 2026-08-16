package handler

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow/types"
)

func testGroupJID(user string) types.JID {
	return types.JID{User: user, Server: types.GroupServer}
}

// newRefreshHandler builds the minimum Handler needed to exercise refresh
// coalescing: no WhatsApp client, no publisher, just the scheduler.
func newRefreshHandler(onRefresh func(types.JID)) *Handler {
	return &Handler{
		groupRefreshPending: make(map[string]bool),
		groupRefreshSlots:   make(chan struct{}, maxConcurrentGroupRefreshes),
		refreshGroupFn:      onRefresh,
	}
}

// A burst of changes to one group must collapse into a bounded number of reads
// - the refresh re-reads current state, so an earlier one is always superseded.
func TestGroupRefreshCoalescesABurstForOneGroup(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	release := make(chan struct{})
	started := make(chan struct{}, 1)

	handler := newRefreshHandler(func(types.JID) {
		mu.Lock()
		calls++
		count := calls
		mu.Unlock()
		if count == 1 {
			started <- struct{}{}
			<-release // hold the first refresh open while the burst arrives
		}
	})

	group := testGroupJID("120363000000000001")
	handler.scheduleGroupRefresh(group)
	<-started

	// Ten more events land while the first read is still in flight.
	for range 10 {
		handler.scheduleGroupRefresh(group)
	}
	close(release)

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return calls == 2
	}, time.Second, 5*time.Millisecond,
		"a burst should produce the in-flight read plus exactly one follow-up")
}

// The race this pins: a change arriving in the window where the worker has
// decided to stop must still be honoured. Losing it leaves the workspace on
// stale membership until something unrelated triggers another refresh.
func TestGroupRefreshNeverDropsAChangeThatArrivesWhileStopping(t *testing.T) {
	group := testGroupJID("120363000000000002")

	for attempt := range 200 {
		var mu sync.Mutex
		calls := 0
		done := make(chan struct{})

		handler := newRefreshHandler(func(types.JID) {
			mu.Lock()
			calls++
			count := calls
			mu.Unlock()
			if count == 2 {
				close(done)
			}
		})

		handler.scheduleGroupRefresh(group)
		// Re-schedule immediately, racing the worker's decision to stop. Either
		// the flag is seen (a second refresh runs) or the key was released (a
		// new worker starts) - both end in a second refresh. What must never
		// happen is the request vanishing.
		time.Sleep(time.Duration(attempt%3) * time.Microsecond)
		handler.scheduleGroupRefresh(group)

		select {
		case <-done:
		case <-time.After(2 * time.Second):
			mu.Lock()
			observed := calls
			mu.Unlock()
			t.Fatalf("attempt %d: a scheduled refresh was dropped (only %d ran)", attempt, observed)
		}
	}
}

// Distinct groups are independent and are capped, not serialized one at a time.
func TestGroupRefreshRunsDistinctGroupsConcurrentlyUpToTheCap(t *testing.T) {
	var mu sync.Mutex
	inFlight, peak := 0, 0
	release := make(chan struct{})
	var wg sync.WaitGroup

	handler := newRefreshHandler(func(types.JID) {
		mu.Lock()
		inFlight++
		if inFlight > peak {
			peak = inFlight
		}
		mu.Unlock()
		<-release
		mu.Lock()
		inFlight--
		mu.Unlock()
		wg.Done()
	})

	const groups = maxConcurrentGroupRefreshes + 3
	wg.Add(groups)
	for index := range groups {
		handler.scheduleGroupRefresh(testGroupJID("12036300000000000" + string(rune('a'+index))))
	}

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return inFlight == maxConcurrentGroupRefreshes
	}, time.Second, 5*time.Millisecond, "the cap should be saturated")

	close(release)
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	assert.LessOrEqual(t, peak, maxConcurrentGroupRefreshes,
		"concurrent WhatsApp reads must stay inside the cap")
}

// An empty JID names no group and must not start a worker.
func TestGroupRefreshIgnoresAnEmptyJID(t *testing.T) {
	called := false
	handler := newRefreshHandler(func(types.JID) { called = true })
	handler.scheduleGroupRefresh(types.EmptyJID)
	time.Sleep(20 * time.Millisecond)
	assert.False(t, called)
}
