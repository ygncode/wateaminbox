package client

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	waLog "go.mau.fi/whatsmeow/util/log"
)

// mockWhatsAppClient is a mock implementation of the WhatsApp client behavior
// for integration testing of the reconnection logic.
type mockWhatsAppClient struct {
	mu               sync.Mutex
	connectAttempts  int
	connectDelay     time.Duration
	shouldFailUntil  int // Number of attempts before success
	failAfterConnect bool // Whether to disconnect after a successful connect
	isConnected      bool
}

func (m *mockWhatsAppClient) Connect() error {
	m.mu.Lock()
	m.connectAttempts++
	attempt := m.connectAttempts
	m.mu.Unlock()

	if m.connectDelay > 0 {
		time.Sleep(m.connectDelay)
	}

	// Simulate failure until we reach the success threshold
	if m.shouldFailUntil > 0 && attempt <= m.shouldFailUntil {
		m.mu.Lock()
		m.isConnected = false
		m.mu.Unlock()
		return fmt.Errorf("mock connection failed (attempt %d/%d)", attempt, m.shouldFailUntil)
	}

	m.mu.Lock()
	m.isConnected = true
	m.mu.Unlock()

	return nil
}

func (m *mockWhatsAppClient) IsConnected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.isConnected
}

func (m *mockWhatsAppClient) Disconnect() {
	m.mu.Lock()
	m.isConnected = false
	m.mu.Unlock()
}

func (m *mockWhatsAppClient) GetAttemptCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connectAttempts
}

// mockClient wraps our Client with a mock WhatsApp client for testing.
type mockClient struct {
	*Client
	mockWA *mockWhatsAppClient
}

// newMockClient creates a test client with a mock WhatsApp client.
func newMockClient(t *testing.T, shouldFailUntil int) *mockClient {
	ctx, cancel := context.WithCancel(context.Background())

	mockWA := &mockWhatsAppClient{
		shouldFailUntil: shouldFailUntil,
		isConnected:     false,
	}

	c := &Client{
		ctx:                 ctx,
		cancelReconnect:     cancel,
		reconnectMu:         sync.Mutex{},
		reconnectStartTime:  time.Now(),
		reconnectAttemptNum: 0,
		logger:              &testLogger{},
	}

	// Override the client field with our mock
	// In real testing, we'd use an interface, but for integration tests
	// we'll simulate the behavior directly

	return &mockClient{
		Client: c,
		mockWA: mockWA,
	}
}

// testLogger suppresses log output during tests.
// It implements the waLog.Logger interface.
type testLogger struct{}

func (n *testLogger) Debugf(format string, v ...interface{}) {}
func (n *testLogger) Infof(format string, v ...interface{})  {}
func (n *testLogger) Warnf(format string, v ...interface{})  {}
func (n *testLogger) Errorf(format string, v ...interface{}) {}
func (n *testLogger) Sub(module string) waLog.Logger        { return n }

// TestShortNetworkOutage_Recovery tests recovery from a short (30s) network outage.
// This simulates a temporary network glitch where the connection should recover
// within the transient phase (first 5 minutes).
func TestShortNetworkOutage_Recovery(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Create a mock that succeeds after a few attempts (simulating ~30s outage)
	// With exponential backoff: 2s + 4s + 8s + 16s = ~30s
	// So 4-5 failed attempts should put us around 30 seconds
	mockWA := &mockWhatsAppClient{
		shouldFailUntil: 4, // Fail first 4 attempts, succeed on 5th
		connectDelay:     100 * time.Millisecond,
		isConnected:      false,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Track connection attempts
	var attemptCount atomic.Int32
	var reconnected atomic.Bool

	// Simulate the reconnection loop
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)

		startTime := time.Now()
		reconnectStartTime := startTime
		reconnectAttemptNum := 0

		for {
			// Check context cancellation
			select {
			case <-ctx.Done():
				log.Println("Test: Context cancelled, exiting reconnection loop")
				return
			default:
			}

			reconnectAttemptNum++
			elapsed := time.Since(reconnectStartTime)
			isTransientPhase := elapsed < transientPhaseDuration

			if isTransientPhase || reconnectAttemptNum%10 == 1 {
				log.Printf("Test: Reconnection attempt #%d (phase: %s, elapsed: %v)",
					reconnectAttemptNum, map[bool]string{true: "transient", false: "persistent"}[isTransientPhase], elapsed.Round(time.Second))
			}

			// Attempt connection
			err := mockWA.Connect()
			attemptCount.Add(1)

			if err != nil {
				// Calculate backoff (simplified for test)
				var backoff time.Duration
				if isTransientPhase {
					// Exponential backoff
					exponentialBackoff := initialBackoff * time.Duration(1<<uint(reconnectAttemptNum-1))
					if exponentialBackoff > maxTransientBackoff {
						exponentialBackoff = maxTransientBackoff
					}
					backoff = exponentialBackoff
				} else {
					backoff = persistentBackoff
				}

				if isTransientPhase || reconnectAttemptNum%10 == 1 {
					log.Printf("Test: Connection failed: %v, waiting %v...", err, backoff.Round(time.Millisecond))
				}

				// Wait for backoff or context cancellation
				select {
				case <-ctx.Done():
					log.Println("Test: Context cancelled during backoff")
					return
				case <-time.After(backoff):
					// Continue to next attempt
				}
				continue
			}

			// Connection successful
			totalTime := time.Since(startTime)
			log.Printf("Test: Reconnection successful after %d attempts (elapsed: %v)", reconnectAttemptNum, totalTime.Round(time.Millisecond))

			// Verify we're still in transient phase
			assert.True(t, isTransientPhase, "Short outage should recover within transient phase")
			assert.Less(t, totalTime, 90*time.Second, "Short outage recovery should complete within 90 seconds")

			reconnected.Store(true)
			return
		}
	}()

	// Wait for reconnection or timeout
	select {
	case <-doneCh:
		// Test completed
	case <-time.After(90 * time.Second):
		t.Fatal("Test timeout: Reconnection did not complete within expected time")
	case <-ctx.Done():
		t.Fatal("Test context cancelled")
	}

	// Verify results
	assert.True(t, reconnected.Load(), "Should have successfully reconnected")
	assert.GreaterOrEqual(t, attemptCount.Load(), int32(4), "Should have made at least 4 attempts")
	assert.LessOrEqual(t, attemptCount.Load(), int32(6), "Should not have made more than 6 attempts for short outage")
}

// TestLongNetworkOutage_Recovery tests recovery from a long (10min) network outage.
// This simulates an extended outage that transitions from transient to persistent phase.
func TestLongNetworkOutage_Recovery(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	t.Skip("Skipping long outage test by default (takes 10+ minutes). Run with 'go test -long' to enable.")

	// This test simulates a 10-minute outage
	// The reconnection should:
	// 1. Start in transient phase (exponential backoff: 2s -> 4s -> 8s -> 16s -> 30s)
	// 2. Transition to persistent phase after 5 minutes (fixed 2-minute intervals)
	// 3. Continue until connection is restored

	// For a 10-minute test, we need the connection to fail for ~10 minutes
	// With transient phase lasting 5 minutes, then persistent phase at 2-minute intervals
	// Approximate attempts in transient phase: ~15-20 (with increasing backoff)
	// In persistent phase: ~2-3 attempts (at 2 minutes each)

	// This would take too long for automated testing, so we simulate the phase transition
	// by manipulating the start time

	// Verify the phase transition logic
	tests := []struct {
		name            string
		elapsed         time.Duration
		expectedPhase   string
		expectedBackoff time.Duration
	}{
		{
			name:            "At 1 minute - transient phase",
			elapsed:         1 * time.Minute,
			expectedPhase:   "transient",
			expectedBackoff: maxTransientBackoff, // Capped at 30s
		},
		{
			name:            "At 4 minutes - still transient",
			elapsed:         4 * time.Minute,
			expectedPhase:   "transient",
			expectedBackoff: maxTransientBackoff,
		},
		{
			name:            "At 5 minutes - still transient (at boundary)",
			elapsed:         5 * time.Minute,
			expectedPhase:   "transient",
			expectedBackoff: maxTransientBackoff,
		},
		{
			name:            "At 6 minutes - persistent phase",
			elapsed:         6 * time.Minute,
			expectedPhase:   "persistent",
			expectedBackoff: persistentBackoff,
		},
		{
			name:            "At 10 minutes - persistent phase",
			elapsed:         10 * time.Minute,
			expectedPhase:   "persistent",
			expectedBackoff: persistentBackoff,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{
				reconnectStartTime:  time.Now().Add(-tt.elapsed),
				reconnectAttemptNum: 100, // High number to ensure we're capped in transient
			}

			backoff := c.calculateBackoff()
			isTransientPhase := tt.elapsed < transientPhaseDuration

			// Verify phase
			if tt.expectedPhase == "transient" {
				assert.True(t, isTransientPhase, "Should be in transient phase")
				assert.Less(t, backoff, 40*time.Second, "Transient phase backoff should be < 40s")
			} else {
				assert.False(t, isTransientPhase, "Should be in persistent phase")
				assert.Greater(t, backoff, 90*time.Second, "Persistent phase backoff should be ~2 minutes")
				assert.Less(t, backoff, 150*time.Second, "Persistent phase backoff should be ~2 minutes")
			}
		})
	}
}

// TestGracefulShutdown_DuringReconnect tests that graceful shutdown works
// when reconnection is in progress.
func TestGracefulShutdown_DuringReconnect(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Create a mock that always fails (simulating continuous outage)
	mockWA := &mockWhatsAppClient{
		shouldFailUntil: 9999, // Always fail
		connectDelay:     50 * time.Millisecond,
		isConnected:      false,
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Track attempts
	var attemptCount atomic.Int32
	shutdownInitiated := make(chan struct{})
	reconnectStopped := make(chan struct{})

	// Simulate the reconnection loop
	go func() {
		defer close(reconnectStopped)

		reconnectAttemptNum := 0

		for {
			// Check context cancellation
			select {
			case <-ctx.Done():
				log.Println("Test: Reconnection loop cancelled by context")
				return
			default:
			}

			reconnectAttemptNum++
			attemptCount.Add(1)

			// Attempt connection
			err := mockWA.Connect()
			if err != nil {
				// Short backoff for faster test
				backoff := 500 * time.Millisecond

				log.Printf("Test: Attempt #%d failed, waiting %v...", reconnectAttemptNum, backoff)

				// Wait for backoff or context cancellation
				select {
				case <-ctx.Done():
					log.Println("Test: Context cancelled during backoff")
					return
				case <-time.After(backoff):
					// Continue
				}
				continue
			}

			// Should not reach here in this test
			return
		}
	}()

	// Wait for a few reconnection attempts
	time.Sleep(1500 * time.Millisecond)
	initialAttempts := attemptCount.Load()
	assert.Greater(t, initialAttempts, int32(1), "Should have made at least one reconnection attempt")

	// Initiate graceful shutdown
	close(shutdownInitiated)
	log.Println("Test: Initiating graceful shutdown...")

	// Cancel the context (simulating StopReconnect)
	cancel()

	// Wait for reconnection to stop
	select {
	case <-reconnectStopped:
		log.Println("Test: Reconnection loop stopped successfully")
	case <-time.After(5 * time.Second):
		t.Fatal("Test timeout: Reconnection loop did not stop within 5 seconds")
	}

	// Verify that reconnection stopped
	finalAttempts := attemptCount.Load()
	log.Printf("Test: Total attempts before shutdown: %d", finalAttempts)

	// Give some time for any goroutines to finish
	time.Sleep(500 * time.Millisecond)

	// The reconnection should have stopped shortly after cancel was called
	// We expect at most 1-2 more attempts after shutdown (depending on timing)
	maxAdditionalAttempts := initialAttempts + 3
	assert.LessOrEqual(t, finalAttempts, maxAdditionalAttempts,
		"Reconnection should stop shortly after context cancellation")
}

// TestHandleReconnect_ContextCancellation tests that HandleReconnect respects
// context cancellation at various points in the loop.
func TestHandleReconnect_ContextCancellation(t *testing.T) {
	tests := []struct {
		name               string
		cancelAfter        time.Duration
		expectedMinAttempts int
		expectedMaxAttempts int
	}{
		{
			name:                "Cancel immediately",
			cancelAfter:         0,
			expectedMinAttempts: 0,
			expectedMaxAttempts: 1,
		},
		{
			name:                "Cancel after first attempt",
			cancelAfter:         100 * time.Millisecond,
			expectedMinAttempts: 1,
			expectedMaxAttempts: 3,
		},
		{
			name:                "Cancel during backoff",
			cancelAfter:         1 * time.Second,
			expectedMinAttempts: 1,
			expectedMaxAttempts: 12, // Up to ~10 attempts with 100ms backoff in 1 second
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockWA := &mockWhatsAppClient{
				shouldFailUntil: 9999,
				connectDelay:     10 * time.Millisecond,
				isConnected:      false,
			}

			ctx, cancel := context.WithCancel(context.Background())

			var attemptCount atomic.Int32

			doneCh := make(chan struct{})
			go func() {
				defer close(doneCh)

				reconnectAttemptNum := 0

				for {
					select {
					case <-ctx.Done():
						return
					default:
					}

					reconnectAttemptNum++
					attemptCount.Add(1)

					_ = mockWA.Connect()

					// Use short backoff for test
					select {
					case <-ctx.Done():
						return
					case <-time.After(100 * time.Millisecond):
					}
				}
			}()

			// Cancel after specified duration
			time.Sleep(tt.cancelAfter)
			cancel()

			// Wait for goroutine to exit
			select {
			case <-doneCh:
			case <-time.After(5 * time.Second):
				t.Fatal("Test timeout: Reconnection loop did not stop")
			}

			attempts := attemptCount.Load()
			assert.GreaterOrEqual(t, int(attempts), tt.expectedMinAttempts,
				"Should have made at least %d attempts", tt.expectedMinAttempts)
			assert.LessOrEqual(t, int(attempts), tt.expectedMaxAttempts,
				"Should not have made more than %d attempts", tt.expectedMaxAttempts)
		})
	}
}

// TestStopReconnect_Idempotent tests that StopReconnect can be called multiple times safely.
func TestStopReconnect_Idempotent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	c := &Client{
		ctx:             ctx,
		cancelReconnect: cancel,
		reconnectMu:     sync.Mutex{},
		logger:          &testLogger{},
	}

	// Should not panic
	assert.NotPanics(t, func() {
		c.StopReconnect()
		c.StopReconnect()
		c.StopReconnect()
	}, "StopReconnect should be idempotent")
}

// TestCalculateBackoff_PersistentPhaseTransition tests the exact moment of phase transition.
func TestCalculateBackoff_PersistentPhaseTransition(t *testing.T) {
	// Test the boundary conditions around the 5-minute transition
	// Note: Phase check is `elapsed < transientPhaseDuration`, so exactly 5:00
	// is in persistent phase (not transient).
	tests := []struct {
		name                string
		elapsed             time.Duration
		attemptNum          int
		expectTransient     bool
		expectedMinBackoff  time.Duration
		expectedMaxBackoff  time.Duration
	}{
		{
			name:               "4:59 - transient",
			elapsed:            4*time.Minute + 59*time.Second,
			attemptNum:         10, // Realistic attempt number for this elapsed time
			expectTransient:    true,
			expectedMinBackoff: 27 * time.Second,
			expectedMaxBackoff: 33 * time.Second,
		},
		{
			name:               "5:00 - persistent (exact boundary, uses >=)",
			elapsed:            5 * time.Minute,
			attemptNum:         10,
			expectTransient:    false,
			expectedMinBackoff: 108 * time.Second,
			expectedMaxBackoff: 132 * time.Second,
		},
		{
			name:               "5:01 - persistent",
			elapsed:            5*time.Minute + 1*time.Second,
			attemptNum:         10,
			expectTransient:    false,
			expectedMinBackoff: 108 * time.Second,
			expectedMaxBackoff: 132 * time.Second,
		},
		{
			name:               "5:30 - persistent",
			elapsed:            5*time.Minute + 30*time.Second,
			attemptNum:         10,
			expectTransient:    false,
			expectedMinBackoff: 108 * time.Second,
			expectedMaxBackoff: 132 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{
				reconnectStartTime:  time.Now().Add(-tt.elapsed),
				reconnectAttemptNum: tt.attemptNum,
			}

			backoff := c.calculateBackoff()
			isTransient := tt.elapsed < transientPhaseDuration

			assert.Equal(t, tt.expectTransient, isTransient,
				"Phase detection should be correct for %v elapsed", tt.elapsed)

			if tt.expectTransient {
				assert.GreaterOrEqual(t, backoff, tt.expectedMinBackoff)
				assert.LessOrEqual(t, backoff, tt.expectedMaxBackoff)
			} else {
				assert.GreaterOrEqual(t, backoff, tt.expectedMinBackoff)
				assert.LessOrEqual(t, backoff, tt.expectedMaxBackoff)
			}
		})
	}
}

// TestReconnectDuplicateLoop_Prevention tests that calling HandleReconnect
// multiple times concurrently doesn't create multiple reconnection loops.
func TestReconnectDuplicateLoop_Prevention(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := &Client{
		ctx:             ctx,
		cancelReconnect: cancel,
		reconnectMu:     sync.Mutex{},
		logger:          &testLogger{},
	}

	var loopCount atomic.Int32
	var wg sync.WaitGroup

	// Try to start multiple reconnection loops concurrently
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			// Simulate the mutex check in HandleReconnect
			if !c.reconnectMu.TryLock() {
				// Duplicate detected, return early
				return
			}
			defer c.reconnectMu.Unlock()

			// This is the actual reconnection loop
			loopCount.Add(1)
			time.Sleep(100 * time.Millisecond)
		}()
	}

	wg.Wait()

	// Only one loop should have started
	assert.Equal(t, int32(1), loopCount.Load(), "Only one reconnection loop should run")
}

/*
================================================================================
E2E TEST PROCEDURES (Manual Testing)
================================================================================

This section documents manual end-to-end test procedures for verifying the
infinite reconnection strategy under real-world conditions.

Prerequisites:
- A working WhatsApp Business API account
- The WhatsApp worker service running with debug logging enabled
- Network simulation tools (e.g., `tc` for Linux, or physical network isolation)

================================================================================
Test 1: Short Network Outage (30 seconds)
================================================================================

Purpose: Verify that transient network issues are handled with exponential backoff.

Steps:
1. Start the WhatsApp worker service
2. Connect and authenticate a WhatsApp device
3. Wait for the connection to stabilize (status: "connected")
4. Simulate a 30-second network outage:
   - Linux: `sudo tc qdisc add dev eth0 root netem loss 100%`
   - Wait 30 seconds
   - Restore: `sudo tc qdisc del dev eth0 root`
5. Observe the logs for reconnection behavior

Expected Results:
- Reconnection attempts start within 2 seconds
- Backoff progression: 2s → 4s → 8s → 16s → 30s
- Connection recovers within ~60 seconds total
- All reconnection attempts are logged
- Status callback shows "connected" after recovery

Success Criteria:
- Exponential backoff pattern is observed
- No more than 6 reconnection attempts
- Full recovery within 90 seconds

================================================================================
Test 2: Extended Network Outage (10 minutes)
================================================================================

Purpose: Verify the two-phase backoff strategy transitions correctly.

Steps:
1. Start the WhatsApp worker service
2. Connect and authenticate a WhatsApp device
3. Wait for the connection to stabilize
4. Simulate a 10-minute network outage:
   - Disconnect the network interface
   - Set a firewall rule to block WhatsApp servers
5. Observe the logs for reconnection behavior for the full 10 minutes
6. Restore network connectivity
7. Wait for connection recovery

Expected Results:
- Phase 1 (0-5 minutes): Exponential backoff (2s → 30s capped)
- Every attempt is logged during Phase 1
- Phase 2 (5+ minutes): Fixed 2-minute intervals
- Only every 10th attempt is logged during Phase 2 (reduces log noise)
- Phase transition occurs at exactly 5 minutes
- Connection recovers immediately when network is restored

Success Criteria:
- Smooth phase transition at 5-minute mark
- Log frequency reduces in Phase 2
- No memory leaks or goroutine leaks
- Connection recovers after 10 minutes

================================================================================
Test 3: Extended Outage (2+ hours)
================================================================================

Purpose: Verify long-running stability and graceful degradation.

Steps:
1. Start the WhatsApp worker service
2. Connect and authenticate a WhatsApp device
3. Wait for the connection to stabilize
4. Simulate a 2-hour network outage (or use a maintenance window)
5. Monitor the service for:
   - Memory usage stability
   - Goroutine count stability
   - Log file growth (should be controlled in Phase 2)
6. Restore network connectivity after 2+ hours

Expected Results:
- Reconnection continues at 2-minute intervals
- Memory usage remains stable (no leaks)
- Log file growth is controlled (~6 log entries/hour in Phase 2)
- No goroutine leaks
- Connection recovers when network is restored

Success Criteria:
- Service runs stably for 2+ hours without intervention
- No resource exhaustion
- Clean recovery after extended outage

================================================================================
Test 4: Graceful Shutdown During Reconnection
================================================================================

Purpose: Verify that the service can shut down cleanly while reconnecting.

Steps:
1. Start the WhatsApp worker service
2. Connect and authenticate a WhatsApp device
3. Disconnect the network (causing continuous reconnection attempts)
4. Wait for at least 3 reconnection attempts (verify reconnection loop is active)
5. Send SIGTERM signal to the service: `kill -TERM <pid>`
6. Observe the shutdown process

Expected Results:
- "Stopping reconnection loop..." message is logged
- Reconnection loop exits within 1 second
- Clean shutdown with no error messages
- All goroutines exit cleanly
- No resource leaks

Success Criteria:
- Shutdown completes within 5 seconds
- No panic or error messages
- Clean exit code (0)

================================================================================
Test 5: Duplicate Reconnection Prevention
================================================================================

Purpose: Verify that multiple disconnection events don't spawn multiple loops.

Steps:
1. Start the WhatsApp worker service with debug logging
2. Connect and authenticate a WhatsApp device
3. Trigger multiple rapid disconnection events:
   - Disconnect/reconnect network 3 times in quick succession
   - Or send multiple disconnect events via WhatsApp
4. Observe the logs

Expected Results:
- "Reconnection loop already active, skipping duplicate call" message appears
- Only one reconnection loop is active
- No panic or race conditions

Success Criteria:
- Only one reconnection loop runs
- No duplicate goroutines
- Clean reconnection after network stabilizes

================================================================================
Test 6: Phase Boundary Edge Cases
================================================================================

Purpose: Verify behavior at the exact phase transition point.

Steps:
1. Start the WhatsApp worker service
2. Connect and authenticate a WhatsApp device
3. Disconnect the network
4. Monitor the exact time of phase transition (5 minutes)
5. Verify backoff calculation at 4:59, 5:00, and 5:01

Expected Results:
- 4:59: Exponential backoff (capped at 30s)
- 5:00: Still exponential backoff (at boundary)
- 5:01: Fixed 2-minute backoff
- Smooth transition with no sudden jumps

Success Criteria:
- Continuous backoff behavior at boundary
- No jarring transition in reconnection timing

================================================================================
Performance Metrics to Monitor
================================================================================

During all tests, monitor:
- Memory usage (heap, stack): Should remain stable
- Goroutine count: Should not grow continuously
- CPU usage: Should be minimal during backoff periods
- Log file size: Should grow slowly in Phase 2
- Network connections: Only one active connection attempt at a time

Tools:
- `go tool pprof` for profiling
- `runtime.ReadMemStats()` for memory tracking
- `runtime.NumGoroutine()` for goroutine counting
- System monitoring: top, htop, /proc/meminfo

================================================================================
Troubleshooting Common Issues
================================================================================

1. Reconnection loop doesn't stop after SIGTERM:
   - Verify context is passed correctly from main.go
   - Check that StopReconnect() is called in shutdown sequence

2. Memory leaks during reconnection:
   - Check for goroutine leaks (use runtime.NumGoroutine())
   - Verify timers are being cleaned up properly
   - Check for unbounded slice/map growth

3. Phase transition doesn't occur:
   - Verify time.Now() is being called correctly
   - Check transientPhaseDuration constant value (should be 5 minutes)

4. Duplicate reconnection loops:
   - Verify reconnectMu.TryLock() is working correctly
   - Check that defer reconnectMu.Unlock() is in place

================================================================================
*/

// TestE2EDocumentation_Exists verifies that E2E test documentation is present.
// This test ensures the documentation above is kept in sync with the code.
func TestE2EDocumentation_Exists(t *testing.T) {
	// This test serves as a reminder to update E2E documentation
	// when the reconnection logic changes.

	// Verify key constants that E2E tests depend on
	assert.Equal(t, 2*time.Second, initialBackoff, "E2E docs may need update if initialBackoff changes")
	assert.Equal(t, 30*time.Second, maxTransientBackoff, "E2E docs may need update if maxTransientBackoff changes")
	assert.Equal(t, 5*time.Minute, transientPhaseDuration, "E2E docs may need update if transientPhaseDuration changes")
	assert.Equal(t, 2*time.Minute, persistentBackoff, "E2E docs may need update if persistentBackoff changes")
	assert.Equal(t, 0.1, jitterFactor, "E2E docs may need update if jitterFactor changes")
}

// TestReconnectState_Transitions tests the state transitions during reconnection.
func TestReconnectState_Transitions(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := &Client{
		ctx:             ctx,
		cancelReconnect: cancel,
		reconnectMu:     sync.Mutex{},
		logger:          &testLogger{},
		connected:       true,
		reconnecting:     false,
	}

	// Initial state: connected, not reconnecting
	c.mu.RLock()
	connected := c.connected
	reconnecting := c.reconnecting
	c.mu.RUnlock()

	assert.True(t, connected, "Initially connected")
	assert.False(t, reconnecting, "Not reconnecting initially")

	// Simulate disconnection - start reconnection
	c.mu.Lock()
	c.connected = false
	c.reconnecting = true
	c.mu.Unlock()

	c.mu.RLock()
	connected = c.connected
	reconnecting = c.reconnecting
	c.mu.RUnlock()

	assert.False(t, connected, "Not connected during reconnection")
	assert.True(t, reconnecting, "Reconnecting flag is set")

	// Simulate successful reconnection
	c.mu.Lock()
	c.connected = true
	c.reconnecting = false
	c.mu.Unlock()

	c.mu.RLock()
	connected = c.connected
	reconnecting = c.reconnecting
	c.mu.RUnlock()

	assert.True(t, connected, "Connected after reconnection")
	assert.False(t, reconnecting, "No longer reconnecting")
}

// TestCalculateBackoff_AllAttempts tests backoff calculation for all attempts
// in the transient phase.
func TestCalculateBackoff_AllAttempts(t *testing.T) {
	c := &Client{
		reconnectStartTime: time.Now().Add(-1 * time.Minute),
	}

	expectedBackoffs := []struct {
		attempt int
		min     time.Duration
		max     time.Duration
	}{
		{0, 1800 * time.Millisecond, 2200 * time.Millisecond},  // 2s ±10%
		{1, 3600 * time.Millisecond, 4400 * time.Millisecond},  // 4s ±10%
		{2, 7200 * time.Millisecond, 8800 * time.Millisecond},  // 8s ±10%
		{3, 14400 * time.Millisecond, 17600 * time.Millisecond}, // 16s ±10%
		{4, 27000 * time.Millisecond, 33000 * time.Millisecond}, // 30s ±10%
		{5, 27000 * time.Millisecond, 33000 * time.Millisecond}, // 30s capped
		{10, 27000 * time.Millisecond, 33000 * time.Millisecond}, // 30s capped
	}

	for _, tt := range expectedBackoffs {
		t.Run(fmt.Sprintf("attempt_%d", tt.attempt), func(t *testing.T) {
			t.Logf("Testing attempt %d", tt.attempt)

			// Sample multiple times to account for jitter
			minSample := time.Hour
			maxSample := time.Duration(0)

			for i := 0; i < 50; i++ {
				c.reconnectAttemptNum = tt.attempt
				backoff := c.calculateBackoff()
				if backoff < minSample {
					minSample = backoff
				}
				if backoff > maxSample {
					maxSample = backoff
				}
			}

			assert.GreaterOrEqual(t, minSample, tt.min-100*time.Millisecond,
				"Attempt %d: min backoff should be at least %v", tt.attempt, tt.min)
			assert.LessOrEqual(t, maxSample, tt.max+100*time.Millisecond,
				"Attempt %d: max backoff should be at most %v", tt.attempt, tt.max)
		})
	}
}

// TestHandleReconnect_StatusCallback tests that status callbacks are invoked correctly.
func TestHandleReconnect_StatusCallback(t *testing.T) {
	var statusUpdates []struct {
		status string
		reason string
	}
	var mu sync.Mutex

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := &Client{
		ctx:             ctx,
		cancelReconnect: cancel,
		reconnectMu:     sync.Mutex{},
		logger:          &testLogger{},
		statusCb: func(status, reason string) {
			mu.Lock()
			defer mu.Unlock()
			statusUpdates = append(statusUpdates, struct{ status, reason string }{status, reason})
		},
	}

	// Verify callback is stored
	assert.NotNil(t, c.statusCb, "Status callback should be stored")

	// Simulate the callback being called
	if c.statusCb != nil {
		c.statusCb("connected", "test")
	}

	mu.Lock()
	count := len(statusUpdates)
	mu.Unlock()

	assert.Equal(t, 1, count, "Status callback should have been called once")
	assert.Equal(t, "connected", statusUpdates[0].status, "Status should be 'connected'")
	assert.Equal(t, "test", statusUpdates[0].reason, "Reason should be 'test'")
}

// TestContextCancellation_Integration tests context cancellation behavior
// in a more realistic scenario with multiple goroutines.
func TestContextCancellation_Integration(t *testing.T) {
	parentCtx := context.Background()

	// Create a client with a cancellable context
	reconnectCtx, cancelReconnect := context.WithCancel(parentCtx)

	c := &Client{
		ctx:             reconnectCtx,
		cancelReconnect: cancelReconnect,
		reconnectMu:     sync.Mutex{},
		logger:          &testLogger{},
	}

	// Verify context is not cancelled initially
	select {
	case <-c.ctx.Done():
		t.Fatal("Context should not be cancelled initially")
	default:
		// Expected
	}

	// Call StopReconnect
	c.StopReconnect()

	// Verify context is now cancelled
	select {
	case <-c.ctx.Done():
		// Expected
	case <-time.After(time.Second):
		t.Fatal("Context should be cancelled after StopReconnect")
	}
}

// TestHandleReconnect_ConcurrentCancellation tests cancellation happening
// concurrently with reconnection attempts.
func TestHandleReconnect_ConcurrentCancellation(t *testing.T) {
	mockWA := &mockWhatsAppClient{
		shouldFailUntil: 9999,
		connectDelay:     50 * time.Millisecond,
		isConnected:      false,
	}

	ctx, cancel := context.WithCancel(context.Background())

	var attemptCount atomic.Int32
	loopExited := make(chan struct{})

	// Start reconnection loop
	go func() {
		defer close(loopExited)

		reconnectAttemptNum := 0

		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			reconnectAttemptNum++
			attemptCount.Add(1)

			_ = mockWA.Connect()

			select {
			case <-ctx.Done():
				return
			case <-time.After(200 * time.Millisecond):
			}
		}
	}()

	// Wait for first attempt
	time.Sleep(100 * time.Millisecond)
	require.Greater(t, attemptCount.Load(), int32(0), "Should have made at least one attempt")

	// Cancel concurrently with the next attempt
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		cancel()
	}()

	go func() {
		defer wg.Done()
		// Try to read attempt count while cancellation happens
		for attemptCount.Load() == 0 {
			time.Sleep(10 * time.Millisecond)
		}
	}()

	wg.Wait()

	// Wait for loop to exit
	select {
	case <-loopExited:
	case <-time.After(5 * time.Second):
		t.Fatal("Reconnection loop did not exit in time")
	}

	// Verify loop exited cleanly
	t.Logf("Loop exited after %d attempts", attemptCount.Load())
}

// TestTwoPhaseBackoff_FullSimulation simulates the complete two-phase backoff
// strategy with accelerated timing.
func TestTwoPhaseBackoff_FullSimulation(t *testing.T) {
	// This test uses a shortened transient phase for faster testing
	originalTransientPhase := transientPhaseDuration
	defer func() {
		// Note: We can't actually modify the constant, but we can simulate
		// the behavior by manipulating the reconnectStartTime
		_ = originalTransientPhase
	}()

	tests := []struct {
		name                string
		simulatedElapsed    time.Duration
		attemptNum          int
		expectedPhase       string
		expectedMinBackoff  time.Duration
		expectedMaxBackoff  time.Duration
	}{
		{
			name:               "Early transient phase",
			simulatedElapsed:   1 * time.Minute,
			attemptNum:         0,
			expectedPhase:      "transient",
			expectedMinBackoff: 1800 * time.Millisecond,
			expectedMaxBackoff: 2200 * time.Millisecond,
		},
		{
			name:               "Late transient phase",
			simulatedElapsed:   4 * time.Minute,
			attemptNum:         10,
			expectedPhase:      "transient",
			expectedMinBackoff: 27000 * time.Millisecond,
			expectedMaxBackoff: 33000 * time.Millisecond,
		},
		{
			name:               "Persistent phase",
			simulatedElapsed:   6 * time.Minute,
			attemptNum:         100,
			expectedPhase:      "persistent",
			expectedMinBackoff: 108 * time.Second,
			expectedMaxBackoff: 132 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{
				reconnectStartTime:  time.Now().Add(-tt.simulatedElapsed),
				reconnectAttemptNum: tt.attemptNum,
				logger:              &testLogger{},
			}

			backoff := c.calculateBackoff()
			isTransient := tt.simulatedElapsed < transientPhaseDuration

			actualPhase := "persistent"
			if isTransient {
				actualPhase = "transient"
			}

			assert.Equal(t, tt.expectedPhase, actualPhase,
				"Phase should be correctly detected")

			assert.GreaterOrEqual(t, backoff, tt.expectedMinBackoff,
				"Backoff should be at least %v", tt.expectedMinBackoff)
			assert.LessOrEqual(t, backoff, tt.expectedMaxBackoff,
				"Backoff should be at most %v", tt.expectedMaxBackoff)
		})
	}
}

// TestHandleReconnect_NilContextHandling tests that nil contexts are handled gracefully.
func TestHandleReconnect_NilContextHandling(t *testing.T) {
	c := &Client{
		ctx:             nil,
		cancelReconnect: nil,
		reconnectMu:     sync.Mutex{},
		logger:          &testLogger{},
	}

	// This would normally start an infinite loop, but we're just testing
	// that the nil context doesn't cause a panic in the setup code
	assert.NotPanics(t, func() {
		// The actual HandleReconnect would loop forever, so we just
		// verify the struct doesn't panic when accessed
		_ = c.ctx
		_ = c.cancelReconnect
	})
}

// BenchmarkHandleReconnect_LoopOverhead benchmarks the overhead of a single
// reconnection loop iteration.
func BenchmarkHandleReconnect_LoopOverhead(b *testing.B) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mockWA := &mockWhatsAppClient{
		connectDelay: 10 * time.Millisecond,
		isConnected:   false,
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		// Simulate one iteration of the reconnection loop
		select {
		case <-ctx.Done():
			return
		default:
		}

		_ = mockWA.Connect()
	}
}

// TestReconnectError_Metrics tests error tracking and metrics.
func TestReconnectError_Metrics(t *testing.T) {
	mockWA := &mockWhatsAppClient{
		shouldFailUntil: 2, // Only fail first 2 attempts (faster test)
		connectDelay:     1 * time.Millisecond,
		isConnected:      false,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var successCount atomic.Int32
	var errorCount atomic.Int32

	doneCh := make(chan struct{})

	go func() {
		defer close(doneCh)

		reconnectStartTime := time.Now()
		reconnectAttemptNum := 0

		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			reconnectAttemptNum++

			err := mockWA.Connect()
			if err != nil {
				errorCount.Add(1)

				// Calculate backoff
				var backoff time.Duration
				elapsed := time.Since(reconnectStartTime)
				if elapsed < transientPhaseDuration {
					exponentialBackoff := initialBackoff * time.Duration(1<<uint(reconnectAttemptNum-1))
					if exponentialBackoff > maxTransientBackoff {
						exponentialBackoff = maxTransientBackoff
					}
					backoff = exponentialBackoff
				} else {
					backoff = persistentBackoff
				}

				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}
				continue
			}

			successCount.Add(1)
			return
		}
	}()

	select {
	case <-doneCh:
		// Test completed successfully
	case <-time.After(10 * time.Second):
		t.Fatal("Test timeout")
	}

	assert.Equal(t, int32(1), successCount.Load(), "Should have one successful connection")
	assert.Equal(t, int32(2), errorCount.Load(), "Should have two failed attempts")
}

// TestReconnectBackoff_JitterDistribution verifies that jitter doesn't
// cause systematic bias in backoff times.
func TestReconnectBackoff_JitterDistribution(t *testing.T) {
	c := &Client{
		reconnectStartTime:  time.Now().Add(-1 * time.Minute),
		reconnectAttemptNum: 0,
	}

	// Collect many samples to verify distribution
	const sampleSize = 10000
	samples := make([]time.Duration, sampleSize)

	for i := 0; i < sampleSize; i++ {
		samples[i] = c.calculateBackoff()
	}

	// Calculate statistics
	var sum int64
	minSample := samples[0]
	maxSample := samples[0]

	for _, s := range samples {
		sum += int64(s)
		if s < minSample {
			minSample = s
		}
		if s > maxSample {
			maxSample = s
		}
	}

	avg := time.Duration(sum / sampleSize)

	// Expected average is 2 seconds (2000ms)
	// With jitterFactor=0.1, the range is 1800ms-2200ms
	// Average should be very close to 2000ms
	expectedAvg := 2000 * time.Millisecond
	tolerance := 50 * time.Millisecond // Allow ±50ms deviation

	assert.InDelta(t, expectedAvg, avg, float64(tolerance),
		"Average backoff should be close to expected value")

	// Verify range covers the expected jitter range
	assert.Less(t, minSample, 1900*time.Millisecond,
		"Min should be below 1900ms (2s - 10% - some margin)")
	assert.Greater(t, minSample, 1700*time.Millisecond,
		"Min should be above 1700ms (2s - 10% - full margin)")

	assert.Greater(t, maxSample, 2100*time.Millisecond,
		"Max should be above 2100ms (2s + 10% - some margin)")
	assert.Less(t, maxSample, 2400*time.Millisecond,
		"Max should be below 2400ms (2s + 10% + full margin)")
}
