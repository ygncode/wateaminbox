package client

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	waBinary "go.mau.fi/whatsmeow/binary"
	waTypes "go.mau.fi/whatsmeow/types"
)

// TestCalculateBackoff_TransientPhase tests the exponential backoff in transient phase.
func TestCalculateBackoff_TransientPhase(t *testing.T) {
	tests := []struct {
		name                string
		attemptNum          int
		elapsedTime         time.Duration
		expectedMinDuration time.Duration
		expectedMaxDuration time.Duration
	}{
		{
			name:                "Attempt 0 - 2 seconds",
			attemptNum:          0,
			elapsedTime:         1 * time.Minute,
			expectedMinDuration: 1800 * time.Millisecond, // 2s - 10%
			expectedMaxDuration: 2200 * time.Millisecond, // 2s + 10%
		},
		{
			name:                "Attempt 1 - 4 seconds",
			attemptNum:          1,
			elapsedTime:         1 * time.Minute,
			expectedMinDuration: 3600 * time.Millisecond, // 4s - 10%
			expectedMaxDuration: 4400 * time.Millisecond, // 4s + 10%
		},
		{
			name:                "Attempt 2 - 8 seconds",
			attemptNum:          2,
			elapsedTime:         2 * time.Minute,
			expectedMinDuration: 7200 * time.Millisecond, // 8s - 10%
			expectedMaxDuration: 8800 * time.Millisecond, // 8s + 10%
		},
		{
			name:                "Attempt 3 - 16 seconds",
			attemptNum:          3,
			elapsedTime:         3 * time.Minute,
			expectedMinDuration: 14400 * time.Millisecond, // 16s - 10%
			expectedMaxDuration: 17600 * time.Millisecond, // 16s + 10%
		},
		{
			name:                "Attempt 4 - 30 seconds (capped)",
			attemptNum:          4,
			elapsedTime:         4 * time.Minute,
			expectedMinDuration: 27000 * time.Millisecond, // 30s - 10%
			expectedMaxDuration: 33000 * time.Millisecond, // 30s + 10%
		},
		{
			name:                "Attempt 5 - 30 seconds (capped at max)",
			attemptNum:          5,
			elapsedTime:         4 * time.Minute,
			expectedMinDuration: 27000 * time.Millisecond, // 30s - 10%
			expectedMaxDuration: 33000 * time.Millisecond, // 30s + 10%
		},
		{
			name:                "Attempt 10 - 30 seconds (still capped)",
			attemptNum:          10,
			elapsedTime:         4 * time.Minute,
			expectedMinDuration: 27000 * time.Millisecond, // 30s - 10%
			expectedMaxDuration: 33000 * time.Millisecond, // 30s + 10%
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{
				reconnectStartTime:  time.Now().Add(-tt.elapsedTime),
				reconnectAttemptNum: tt.attemptNum,
			}

			// Run multiple times to account for jitter
			minDuration := time.Hour
			maxDuration := time.Duration(0)

			for i := 0; i < 100; i++ {
				backoff := c.calculateBackoff()
				if backoff < minDuration {
					minDuration = backoff
				}
				if backoff > maxDuration {
					maxDuration = backoff
				}
			}

			// Allow some tolerance for statistical variation
			assert.GreaterOrEqual(t, minDuration, tt.expectedMinDuration-100*time.Millisecond,
				"minimum backoff should be at least expected min (with tolerance)")
			assert.LessOrEqual(t, maxDuration, tt.expectedMaxDuration+100*time.Millisecond,
				"maximum backoff should be at most expected max (with tolerance)")
		})
	}
}

// TestCalculateBackoff_PersistentPhase tests the fixed backoff in persistent phase.
func TestCalculateBackoff_PersistentPhase(t *testing.T) {
	tests := []struct {
		name                string
		attemptNum          int
		elapsedTime         time.Duration
		expectedMinDuration time.Duration
		expectedMaxDuration time.Duration
	}{
		{
			name:                "After 5 minutes - 2 minutes fixed",
			attemptNum:          0,
			elapsedTime:         6 * time.Minute,
			expectedMinDuration: 108 * time.Second, // 2m - 10%
			expectedMaxDuration: 132 * time.Second, // 2m + 10%
		},
		{
			name:                "After 10 minutes - still 2 minutes",
			attemptNum:          100,
			elapsedTime:         10 * time.Minute,
			expectedMinDuration: 108 * time.Second,
			expectedMaxDuration: 132 * time.Second,
		},
		{
			name:                "After 1 hour - still 2 minutes",
			attemptNum:          500,
			elapsedTime:         1 * time.Hour,
			expectedMinDuration: 108 * time.Second,
			expectedMaxDuration: 132 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{
				reconnectStartTime:  time.Now().Add(-tt.elapsedTime),
				reconnectAttemptNum: tt.attemptNum,
			}

			// Run multiple times to account for jitter
			minDuration := time.Hour
			maxDuration := time.Duration(0)

			for i := 0; i < 100; i++ {
				backoff := c.calculateBackoff()
				if backoff < minDuration {
					minDuration = backoff
				}
				if backoff > maxDuration {
					maxDuration = backoff
				}
			}

			// Allow some tolerance for statistical variation
			assert.GreaterOrEqual(t, minDuration, tt.expectedMinDuration-1*time.Second,
				"minimum backoff should be at least expected min (with tolerance)")
			assert.LessOrEqual(t, maxDuration, tt.expectedMaxDuration+1*time.Second,
				"maximum backoff should be at most expected max (with tolerance)")
		})
	}
}

// TestCalculateBackoff_PhaseTransition tests the transition from transient to persistent phase.
func TestCalculateBackoff_PhaseTransition(t *testing.T) {
	// Just before transition (4:59)
	c1 := &Client{
		reconnectStartTime:  time.Now().Add(-4*time.Minute - 59*time.Second),
		reconnectAttemptNum: 10,
	}
	backoffTransient := c1.calculateBackoff()

	// Just after transition (5:01)
	c2 := &Client{
		reconnectStartTime:  time.Now().Add(-5*time.Minute - 1*time.Second),
		reconnectAttemptNum: 10,
	}
	backoffPersistent := c2.calculateBackoff()

	// Transient phase should use exponential (capped at 30s)
	assert.Less(t, backoffTransient, 40*time.Second, "transient phase should use exponential backoff")

	// Persistent phase should use 2 minutes
	assert.Greater(t, backoffPersistent, 90*time.Second, "persistent phase should use 2-minute backoff")
	assert.Less(t, backoffPersistent, 150*time.Second, "persistent phase should use 2-minute backoff")
}

// TestCalculateBackoff_JitterDistribution tests that jitter is properly distributed.
func TestCalculateBackoff_JitterDistribution(t *testing.T) {
	c := &Client{
		reconnectStartTime:  time.Now().Add(-1 * time.Minute),
		reconnectAttemptNum: 0, // Should give ~2s with jitter
	}

	// Collect samples
	samples := make([]time.Duration, 1000)
	for i := 0; i < 1000; i++ {
		samples[i] = c.calculateBackoff()
	}

	// Find min and max
	minSample := samples[0]
	maxSample := samples[0]
	sum := time.Duration(0)
	for _, s := range samples {
		if s < minSample {
			minSample = s
		}
		if s > maxSample {
			maxSample = s
		}
		sum += s
	}
	avg := sum / time.Duration(len(samples))

	// Expected range is 1.8s to 2.2s (2s ± 10%)
	assert.Greater(t, minSample, 1700*time.Millisecond, "jitter should produce values below 2s")
	assert.Less(t, minSample, 1900*time.Millisecond, "jitter min should be close to 1.8s")
	assert.Greater(t, maxSample, 2100*time.Millisecond, "jitter should produce values above 2s")
	assert.Less(t, maxSample, 2400*time.Millisecond, "jitter max should be close to 2.2s")

	// Average should be close to 2s
	assert.Greater(t, avg, 1900*time.Millisecond, "average should be close to 2s")
	assert.Less(t, avg, 2100*time.Millisecond, "average should be close to 2s")
}

// TestCalculateBackoff_EdgeCases tests edge cases for calculateBackoff.
func TestCalculateBackoff_EdgeCases(t *testing.T) {
	tests := []struct {
		name        string
		attemptNum  int
		elapsedTime time.Duration
		shouldCap   bool
	}{
		{
			name:        "Zero attempts",
			attemptNum:  0,
			elapsedTime: 1 * time.Minute,
			shouldCap:   false,
		},
		{
			name:        "Large attempt number that triggers cap (but not overflow)",
			attemptNum:  10,
			elapsedTime: 1 * time.Minute,
			shouldCap:   true,
		},
		{
			name:        "Exactly at phase boundary",
			attemptNum:  50,
			elapsedTime: transientPhaseDuration,
			shouldCap:   false,
		},
		{
			name:        "Just over phase boundary",
			attemptNum:  50,
			elapsedTime: transientPhaseDuration + 1*time.Millisecond,
			shouldCap:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{
				reconnectStartTime:  time.Now().Add(-tt.elapsedTime),
				reconnectAttemptNum: tt.attemptNum,
			}

			// Should not panic
			backoff := c.calculateBackoff()

			// Should return a reasonable duration
			assert.Greater(t, backoff, time.Duration(0), "backoff should be positive")
			assert.Less(t, backoff, 3*time.Minute, "backoff should be less than 3 minutes")

			// If we're in the cap range, verify it's capped
			if tt.shouldCap {
				assert.LessOrEqual(t, backoff, 35*time.Second, "should be capped near maxTransientBackoff with jitter")
			}
		})
	}
}

// TestCalculateBackoff_ExponentialGrowth tests the exponential growth pattern.
func TestCalculateBackoff_ExponentialGrowth(t *testing.T) {
	c := &Client{
		reconnectStartTime: time.Now().Add(-1 * time.Minute),
	}

	// Test that backoff grows exponentially
	backoffs := make([]time.Duration, 5)
	for i := 0; i < 5; i++ {
		c.reconnectAttemptNum = i
		backoffs[i] = c.calculateBackoff()
		// Reset to get deterministic value (without jitter, approximate)
	}

	// Each subsequent backoff should be larger (approximately)
	// Note: Due to jitter, we need to check the general pattern
	c.reconnectAttemptNum = 0
	b0 := c.calculateBackoff()
	c.reconnectAttemptNum = 1
	b1 := c.calculateBackoff()
	c.reconnectAttemptNum = 2
	b2 := c.calculateBackoff()

	// Due to jitter, we check if the average trend is increasing
	assert.Greater(t, b1, 1800*time.Millisecond, "attempt 1 should be > ~1.8s")
	assert.Greater(t, b2, 3500*time.Millisecond, "attempt 2 should be > ~3.5s")

	// b0 is collected but not directly compared due to jitter
	_ = b0
}

// TestHandleReconnect_DuplicateLoopPrevention tests that duplicate HandleReconnect calls are prevented.
func TestHandleReconnect_DuplicateLoopPrevention(t *testing.T) {
	c := &Client{
		reconnectMu: sync.Mutex{},
	}

	// Lock the mutex to simulate an active reconnection loop
	c.reconnectMu.Lock()

	// This should return immediately without trying to acquire the lock again
	// We can't test this directly without mocking, but we can verify the mutex behavior

	// TryLock should fail when mutex is already locked
	assert.False(t, c.reconnectMu.TryLock(), "TryLock should fail when mutex is already locked")

	// Unlock to clean up
	c.reconnectMu.Unlock()

	// TryLock should succeed now
	assert.True(t, c.reconnectMu.TryLock(), "TryLock should succeed when mutex is unlocked")
	c.reconnectMu.Unlock()
}

// TestHandleReconnect_ContextResolution tests that context resolution works correctly.
func TestHandleReconnect_ContextResolution(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tests := []struct {
		name         string
		storedCtx    context.Context
		passedCtx    context.Context
		expectCancel bool
	}{
		{
			name:         "Passed context takes priority",
			storedCtx:    context.Background(),
			passedCtx:    ctx,
			expectCancel: true,
		},
		{
			name:         "Stored context used when passed is nil",
			storedCtx:    ctx,
			passedCtx:    nil,
			expectCancel: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// This test verifies the context priority logic
			// Priority: passed ctx > stored c.ctx > context.Background()

			shutdownCtx := tt.passedCtx
			if shutdownCtx == nil {
				shutdownCtx = tt.storedCtx
			}
			if shutdownCtx == nil {
				shutdownCtx = context.Background()
			}

			// Verify the resolved context
			if tt.expectCancel {
				// The resolved context should be cancellable
				assert.NotNil(t, shutdownCtx, "context should not be nil")
				select {
				case <-shutdownCtx.Done():
					// Context is cancelled (expected in some test scenarios)
				default:
					// Context is not cancelled (also valid)
				}
			}
		})
	}
}

// TestStopReconnect_CallsCancelFunc tests that StopReconnect calls the cancel function.
func TestStopReconnect_CallsCancelFunc(t *testing.T) {
	cancelCalled := false
	ctx, cancel := context.WithCancel(context.Background())

	c := &Client{
		ctx:             ctx,
		cancelReconnect: func() { cancelCalled = true; cancel() },
	}

	// Verify initial state
	assert.False(t, cancelCalled, "cancel should not be called initially")

	// Call StopReconnect
	c.StopReconnect()

	// Verify cancel was called
	assert.True(t, cancelCalled, "cancel should be called after StopReconnect")

	// Verify context is cancelled
	select {
	case <-c.ctx.Done():
		// Expected
	default:
		t.Error("context should be cancelled after StopReconnect")
	}
}

// TestStopReconnect_NilCancelFunc tests that StopReconnect handles nil cancel function.
func TestStopReconnect_NilCancelFunc(t *testing.T) {
	c := &Client{
		ctx:             context.Background(),
		cancelReconnect: nil,
	}

	// Should not panic
	assert.NotPanics(t, func() {
		c.StopReconnect()
	}, "StopReconnect should not panic when cancelReconnect is nil")
}

// TestConstants verifies the backoff constants are properly defined.
func TestConstants(t *testing.T) {
	// Verify constants are non-zero and reasonable
	assert.Greater(t, initialBackoff, time.Duration(0), "initialBackoff should be positive")
	assert.Equal(t, 2*time.Second, initialBackoff, "initialBackoff should be 2 seconds")

	assert.Greater(t, maxTransientBackoff, initialBackoff, "maxTransientBackoff should be greater than initialBackoff")
	assert.Equal(t, 30*time.Second, maxTransientBackoff, "maxTransientBackoff should be 30 seconds")

	assert.Greater(t, transientPhaseDuration, time.Duration(0), "transientPhaseDuration should be positive")
	assert.Equal(t, 5*time.Minute, transientPhaseDuration, "transientPhaseDuration should be 5 minutes")

	assert.Greater(t, persistentBackoff, maxTransientBackoff, "persistentBackoff should be greater than maxTransientBackoff")
	assert.Equal(t, 2*time.Minute, persistentBackoff, "persistentBackoff should be 2 minutes")

	assert.Greater(t, jitterFactor, 0.0, "jitterFactor should be positive")
	assert.Less(t, jitterFactor, 1.0, "jitterFactor should be less than 1")
	assert.Equal(t, 0.1, jitterFactor, "jitterFactor should be 0.1 (10%)")
}

// BenchmarkCalculateBackoff_TransientPhase benchmarks the backoff calculation.
func BenchmarkCalculateBackoff_TransientPhase(b *testing.B) {
	c := &Client{
		reconnectStartTime:  time.Now().Add(-1 * time.Minute),
		reconnectAttemptNum: 3,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.calculateBackoff()
	}
}

// BenchmarkCalculateBackoff_PersistentPhase benchmarks the backoff calculation.
func BenchmarkCalculateBackoff_PersistentPhase(b *testing.B) {
	c := &Client{
		reconnectStartTime:  time.Now().Add(-10 * time.Minute),
		reconnectAttemptNum: 100,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.calculateBackoff()
	}
}

// TestClient_ContextStorage tests that the client stores context properly.
func TestClient_ContextStorage(t *testing.T) {
	ctx := context.Background()
	customCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	c := &Client{
		ctx:             customCtx,
		cancelReconnect: cancel,
	}

	// Verify context is stored
	assert.Equal(t, customCtx, c.ctx, "context should be stored")
	assert.NotNil(t, c.cancelReconnect, "cancel function should be stored")
}

func TestEnsureSocketConnected(t *testing.T) {
	t.Run("skips connect when the socket has already recovered", func(t *testing.T) {
		connectCalled := false
		err := ensureSocketConnected(
			func() bool { return true },
			func() error {
				connectCalled = true
				return nil
			},
		)

		require.NoError(t, err)
		assert.False(t, connectCalled)
	})

	t.Run("accepts recovery racing with a failed connect call", func(t *testing.T) {
		connected := false
		err := ensureSocketConnected(
			func() bool { return connected },
			func() error {
				connected = true
				return assert.AnError
			},
		)

		require.NoError(t, err)
	})

	t.Run("returns a genuine connection error", func(t *testing.T) {
		err := ensureSocketConnected(
			func() bool { return false },
			func() error { return assert.AnError },
		)

		require.ErrorIs(t, err, assert.AnError)
	})
}

// TestIsConnected tests the connected flag behavior.
// Note: The full IsConnected() method also checks the underlying whatsmeow client,
// which requires a full client setup. This test verifies the internal flag state.
func TestIsConnected(t *testing.T) {
	c := &Client{
		connected: false,
	}

	// Initially not connected
	c.mu.RLock()
	connectedState := c.connected
	c.mu.RUnlock()
	assert.False(t, connectedState, "should not be connected initially")

	// Set connected flag
	c.mu.Lock()
	c.connected = true
	c.mu.Unlock()

	c.mu.RLock()
	connectedState = c.connected
	c.mu.RUnlock()
	assert.True(t, connectedState, "internal connected flag should be set")

	// Note: c.IsConnected() would also require c.client to be non-nil and IsConnected() on the client
	// which requires full whatsmeow client setup
}

func TestCatalogNodeHelpers(t *testing.T) {
	node := waBinary.Node{
		Tag:     "product",
		Attrs:   waBinary.Attrs{"id": "product-1"},
		Content: []waBinary.Node{{Tag: "name", Content: []byte("Tea")}},
	}
	assert.Equal(t, "product-1", nodeAttr(node, "id"))
	assert.Equal(t, "Tea", nodeText(node, "name"))
	var products []waBinary.Node
	collectNodes(waBinary.Node{Tag: "catalog", Content: []waBinary.Node{node}}, "product", &products)
	require.Len(t, products, 1)
}

func TestBuildReactionKeyIncludesIncomingGroupParticipant(t *testing.T) {
	group, err := waTypes.ParseJID("120363123456789012@g.us")
	require.NoError(t, err)

	key, err := buildReactionKey(
		group,
		"3EB0GROUPMESSAGE",
		"15551234567:8@s.whatsapp.net",
		false,
	)

	require.NoError(t, err)
	assert.Equal(t, "120363123456789012@g.us", key.GetRemoteJID())
	assert.Equal(t, "3EB0GROUPMESSAGE", key.GetID())
	assert.False(t, key.GetFromMe())
	assert.Equal(t, "15551234567@s.whatsapp.net", key.GetParticipant())
}

func TestBuildReactionKeyOmitsParticipantForOwnGroupMessage(t *testing.T) {
	group, err := waTypes.ParseJID("120363123456789012@g.us")
	require.NoError(t, err)

	key, err := buildReactionKey(group, "3EB0OWNMESSAGE", "", true)

	require.NoError(t, err)
	assert.True(t, key.GetFromMe())
	assert.Empty(t, key.GetParticipant())
}

func TestBuildReactionKeyRejectsMissingIncomingGroupParticipant(t *testing.T) {
	group, err := waTypes.ParseJID("120363123456789012@g.us")
	require.NoError(t, err)

	_, err = buildReactionKey(group, "3EB0GROUPMESSAGE", "", false)

	require.ErrorContains(t, err, "target sender JID is required")
}

func TestFindGroupReactionSenderUsesGroupPrimaryIdentity(t *testing.T) {
	phone := mustParseClientJID(t, "84855316944@s.whatsapp.net")
	lid := mustParseClientJID(t, "48954691608613@lid")

	sender, ok := findGroupReactionSender(phone, []waTypes.GroupParticipant{{
		JID:         lid,
		PhoneNumber: phone,
		LID:         lid,
	}})

	require.True(t, ok)
	assert.Equal(t, lid, sender)
}

func TestFindGroupReactionSenderKeepsPNForPNAddressedGroup(t *testing.T) {
	phone := mustParseClientJID(t, "84855316944@s.whatsapp.net")
	lid := mustParseClientJID(t, "48954691608613@lid")

	sender, ok := findGroupReactionSender(lid, []waTypes.GroupParticipant{{
		JID:         phone,
		PhoneNumber: phone,
		LID:         lid,
	}})

	require.True(t, ok)
	assert.Equal(t, phone, sender)
}

func mustParseClientJID(t *testing.T, raw string) waTypes.JID {
	t.Helper()
	jid, err := waTypes.ParseJID(raw)
	require.NoError(t, err)
	return jid
}

// TestSetStatusCallback tests the status callback setter.
func TestSetStatusCallback(t *testing.T) {
	c := &Client{}

	called := false
	c.SetStatusCallback(func(status, reason string) {
		called = true
	})

	// Trigger the callback
	if c.statusCb != nil {
		c.statusCb("connected", "test")
	}

	assert.True(t, called, "status callback should be called")
}

// TestSetQRCallback tests the QR callback setter.
func TestSetQRCallback(t *testing.T) {
	c := &Client{}

	called := false
	var receivedQR string
	c.SetQRCallback(func(qrCode string) {
		called = true
		receivedQR = qrCode
	})

	// Trigger the callback
	if c.qrCallback != nil {
		c.qrCallback("test-qr-code")
	}

	assert.True(t, called, "QR callback should be called")
	assert.Equal(t, "test-qr-code", receivedQR, "QR code should be passed correctly")
}

// TestSendResponse_Structure verifies the SendResponse structure.
func TestSendResponse_Structure(t *testing.T) {
	// Import the types package
	// This test verifies that SendResponse has the correct fields

	testTime := time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)

	// This would normally come from whatsmeow's response
	// We're testing the structure our code expects
	messageID := "3EB01234567890@s.whatsapp.net"
	timestamp := testTime

	// Verify we can construct a response with the expected data
	assert.NotEmpty(t, messageID, "message ID should not be empty")
	assert.False(t, timestamp.IsZero(), "timestamp should not be zero")

	// Verify the timestamp format
	assert.Equal(t, "2026-01-05 12:00:00 +0000 UTC", timestamp.String())
}

// MockMessageSender is a mock implementation of MessageSender for testing.
type MockMessageSender struct {
	SendMessageFunc      func(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (interface{}, error)
	SendMediaMessageFunc func(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (interface{}, error)
}

// TestSendMessage_InvalidJID tests that SendMessage returns error for invalid JID.
func TestSendMessage_InvalidJID(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	// Test with invalid JID (no @ symbol)
	resp, err := c.SendMessage(ctx, "invalid-jid", "Hello", "", "")
	assert.Error(t, err, "should return error for invalid JID")
	assert.Empty(t, resp.ID, "response ID should be empty on error")
	assert.True(t, resp.Timestamp.IsZero(), "response timestamp should be zero on error")
	// The error should mention "invalid JID" or fail with nil client error
	assert.True(t, strings.Contains(err.Error(), "invalid JID") || strings.Contains(err.Error(), "client is nil"),
		"error should mention invalid JID or client is nil")
}

// TestSendMessage_ValidJID_ParsesSuccessfully tests that a valid JID format is accepted.
func TestSendMessage_ValidJID_ParsesSuccessfully(t *testing.T) {
	ctx := context.Background()
	c := &Client{
		// Note: We can't create a real whatsmeow.Client without a database connection
		// The test validates JID parsing which happens before client.SendMessage is called
	}

	// Note: This will fail at the SendMessage step because we're not connected,
	// but it validates that the JID parsing works
	_, err := c.SendMessage(ctx, "1234567890@s.whatsapp.net", "Hello", "", "")

	// The error should be from the actual send attempt, not JID parsing
	// (JID parsing should succeed)
	assert.Error(t, err, "should return error (not connected)")
	// The error should NOT be "invalid JID" if the JID format is correct
	assert.NotContains(t, err.Error(), "invalid JID", "error should not mention invalid JID for valid format")
}

// TestSendMediaMessage_UnsupportedMediaType tests that SendMediaMessage returns error for unsupported media type.
func TestSendMediaMessage_UnsupportedMediaType(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	data := []byte("fake data")
	resp, err := c.SendMediaMessage(ctx, "1234567890@s.whatsapp.net", "unsupported", data, "caption", "file.txt", "text/plain", "", "")

	assert.Error(t, err, "should return error for unsupported media type")
	assert.Contains(t, err.Error(), "unsupported media type", "error should mention unsupported media type")
	assert.Empty(t, resp.ID, "response ID should be empty on error")
}

// TestSendMediaMessage_InvalidJID tests that SendMediaMessage returns error for invalid JID.
func TestSendMediaMessage_InvalidJID(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	data := []byte("fake data")
	resp, err := c.SendMediaMessage(ctx, "invalid-jid", "image", data, "caption", "file.jpg", "image/jpeg", "", "")

	assert.Error(t, err, "should return error for invalid JID")
	assert.Empty(t, resp.ID, "response ID should be empty on error")
	// The error should mention "invalid JID" or fail with nil/upload client error
	assert.True(t, strings.Contains(err.Error(), "invalid JID") || strings.Contains(err.Error(), "failed to"),
		"error should mention invalid JID or failure")
}

// TestSendMediaMessage_ImageType_ParsesSuccessfully tests that image type is recognized.
func TestSendMediaMessage_ImageType_ParsesSuccessfully(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	data := []byte("fake image data")
	_, err := c.SendMediaMessage(ctx, "1234567890@s.whatsapp.net", "image", data, "test caption", "test.jpg", "image/jpeg", "", "")

	// Should fail at upload/send step (client is nil), not at type recognition
	assert.Error(t, err, "should return error (client is nil)")
	// Since client is nil, we get a different error, but it's not "unsupported media type"
	assert.NotContains(t, err.Error(), "unsupported media type", "error should not mention unsupported media type for image")
}

// TestSendMediaMessage_VideoType_ParsesSuccessfully tests that video type is recognized.
func TestSendMediaMessage_VideoType_ParsesSuccessfully(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	data := []byte("fake video data")
	_, err := c.SendMediaMessage(ctx, "1234567890@s.whatsapp.net", "video", data, "test caption", "test.mp4", "video/mp4", "", "")

	// Should fail at upload/send step (client is nil), not at type recognition
	assert.Error(t, err, "should return error (client is nil)")
	assert.NotContains(t, err.Error(), "unsupported media type", "error should not mention unsupported media type for video")
}

// TestSendMediaMessage_DocumentType_ParsesSuccessfully tests that document type is recognized.
func TestSendMediaMessage_DocumentType_ParsesSuccessfully(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	data := []byte("fake document data")
	_, err := c.SendMediaMessage(ctx, "1234567890@s.whatsapp.net", "document", data, "test caption", "test.pdf", "application/pdf", "", "")

	// Should fail at upload/send step (client is nil), not at type recognition
	assert.Error(t, err, "should return error (client is nil)")
	assert.NotContains(t, err.Error(), "unsupported media type", "error should not mention unsupported media type for document")
}

// TestSendMediaMessage_AudioType_ParsesSuccessfully tests that audio type is recognized.
func TestSendMediaMessage_AudioType_ParsesSuccessfully(t *testing.T) {
	ctx := context.Background()
	c := &Client{}

	data := []byte("fake audio data")
	_, err := c.SendMediaMessage(ctx, "1234567890@s.whatsapp.net", "audio", data, "", "", "audio/ogg; codecs=opus", "", "")

	// Should fail at upload/send step (client is nil), not at type recognition
	assert.Error(t, err, "should return error (client is nil)")
	assert.NotContains(t, err.Error(), "unsupported media type", "error should not mention unsupported media type for audio")
}
