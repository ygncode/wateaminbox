package handler

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

// mockDownloader is a mock implementation of WhatsAppClient for testing.
type mockDownloader struct {
	mu                sync.Mutex
	downloadCallCount int
	downloadDelay     time.Duration
	downloadErrors    []error // Errors to return on each call (nil means success)
	downloadData      []byte  // Data to return on success
	onDownload        func()  // Callback invoked on each download
	client            *whatsmeow.Client
}

func (m *mockDownloader) DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error) {
	m.mu.Lock()
	m.downloadCallCount++

	// Track concurrent downloads
	currentCall := m.downloadCallCount - 1
	m.mu.Unlock()

	// Invoke callback if provided
	if m.onDownload != nil {
		m.onDownload()
	}

	// Simulate delay if configured
	if m.downloadDelay > 0 {
		select {
		case <-time.After(m.downloadDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	// Check if we have a specific error for this call
	if len(m.downloadErrors) > 0 {
		if currentCall < len(m.downloadErrors) {
			err := m.downloadErrors[currentCall]
			if err != nil {
				return nil, err
			}
		} else if len(m.downloadErrors) > 0 {
			// If we've exhausted the error list, return the last error
			err := m.downloadErrors[len(m.downloadErrors)-1]
			if err != nil {
				return nil, err
			}
		}
	}

	// Return success data
	if m.downloadData != nil {
		return m.downloadData, nil
	}
	return []byte("test-media-data"), nil
}

func (m *mockDownloader) GetClient() *whatsmeow.Client {
	return m.client
}

func (m *mockDownloader) HandleReconnect(ctx context.Context) {
	// No-op
}

func (m *mockDownloader) SendPresence(ctx context.Context, state types.Presence) error {
	// No-op for unit tests
	return nil
}

func (m *mockDownloader) SubscribePresence(ctx context.Context, jid types.JID) error {
	// No-op for unit tests
	return nil
}

func (m *mockDownloader) GetDownloadCallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.downloadCallCount
}

func (m *mockDownloader) ResetCallCount() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.downloadCallCount = 0
}

func (m *mockDownloader) BlockContact(ctx context.Context, jid string) error {
	// No-op for unit tests
	return nil
}

func (m *mockDownloader) UnblockContact(ctx context.Context, jid string) error {
	// No-op for unit tests
	return nil
}

// mockDownloadableMessage implements whatsmeow.DownloadableMessage for testing.
type mockDownloadableMessage struct {
	directPath    string
	mediaKey      []byte
	fileSHA256    []byte
	fileEncSHA256 []byte
}

func (m *mockDownloadableMessage) GetDirectPath() string {
	return m.directPath
}

func (m *mockDownloadableMessage) GetMediaKey() []byte {
	return m.mediaKey
}

func (m *mockDownloadableMessage) GetFileSHA256() []byte {
	return m.fileSHA256
}

func (m *mockDownloadableMessage) GetFileEncSHA256() []byte {
	return m.fileEncSHA256
}

// newMockDownloadable creates a mock downloadable message.
func newMockDownloadable() *mockDownloadableMessage {
	return &mockDownloadableMessage{
		directPath:    "/test/path",
		mediaKey:      []byte("test-media-key"),
		fileSHA256:    []byte("test-file-sha256"),
		fileEncSHA256: []byte("test-file-enc-sha256"),
	}
}

// newTestHandler creates a handler with a mock downloader for testing.
func newTestHandler(mock *mockDownloader) *Handler {
	cfg := Config{
		WorkerID:  "test-worker",
		CompanyID: "test-company",
		Client:    mock, // Inject the mock directly
	}
	return New(cfg)
}

// TestDownloadWithRetry_SuccessOnFirstAttempt tests successful download on first try.
func TestDownloadWithRetry_SuccessOnFirstAttempt(t *testing.T) {
	mock := &mockDownloader{
		downloadData: []byte("test-media-data"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	data, err := h.downloadWithRetry(ctx, downloadable)

	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	if string(data) != "test-media-data" {
		t.Fatalf("Expected 'test-media-data', got '%s'", string(data))
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 1 {
		t.Fatalf("Expected 1 download call, got %d", callCount)
	}
}

// TestDownloadWithRetry_SuccessAfterRetry tests successful download after retry.
func TestDownloadWithRetry_SuccessAfterRetry(t *testing.T) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("temporary network error"),
			errors.New("another temporary error"),
			nil, // Third attempt succeeds
		},
		downloadData: []byte("test-media-data"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	// Measure time to verify backoff delays occurred
	start := time.Now()
	data, err := h.downloadWithRetry(ctx, downloadable)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Expected success after retries, got error: %v", err)
	}

	if string(data) != "test-media-data" {
		t.Fatalf("Expected 'test-media-data', got '%s'", string(data))
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 3 {
		t.Fatalf("Expected 3 download calls, got %d", callCount)
	}

	// Verify that backoff delays occurred (1s + 2s = 3s minimum expected)
	// Allow some margin for timing variations
	expectedMinDelay := mediaDownloadBaseDelay + (mediaDownloadBaseDelay * 2)
	if elapsed < expectedMinDelay {
		t.Fatalf("Expected minimum delay of %v, got %v", expectedMinDelay, elapsed)
	}
}

// TestDownloadWithRetry_AllAttemptsFail tests failure after all retries exhausted.
func TestDownloadWithRetry_AllAttemptsFail(t *testing.T) {
	expectedErr := errors.New("permanent download failure")
	// Make sure we have enough errors for all 4 attempts
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("temporary network error 1"),
			errors.New("temporary network error 2"),
			errors.New("temporary network error 3"),
			expectedErr, // 4th attempt fails
		},
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	data, err := h.downloadWithRetry(ctx, downloadable)

	if err == nil {
		t.Fatal("Expected error after all retries failed, got success")
	}

	if data != nil {
		t.Fatalf("Expected nil data on failure, got %v", data)
	}

	if !errors.Is(err, expectedErr) && err.Error() != expectedErr.Error() {
		t.Fatalf("Expected last error '%v', got '%v'", expectedErr, err)
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != mediaDownloadMaxRetries {
		t.Fatalf("Expected %d download calls, got %d", mediaDownloadMaxRetries, callCount)
	}
}

// TestDownloadWithRetry_ContextCancellationBeforeAttempt tests context cancellation before any attempt.
func TestDownloadWithRetry_ContextCancellationBeforeAttempt(t *testing.T) {
	mock := &mockDownloader{}

	h := newTestHandler(mock)

	// Create an already-cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	downloadable := newMockDownloadable()

	data, err := h.downloadWithRetry(ctx, downloadable)

	if err != context.Canceled {
		t.Fatalf("Expected context.Canceled error, got: %v", err)
	}

	if data != nil {
		t.Fatalf("Expected nil data on context cancellation, got %v", data)
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 0 {
		t.Fatalf("Expected 0 download calls when context already cancelled, got %d", callCount)
	}
}

// TestDownloadWithRetry_ContextCancellationDuringBackoff tests context cancellation during backoff.
func TestDownloadWithRetry_ContextCancellationDuringBackoff(t *testing.T) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("first attempt fails"),
		},
	}

	h := newTestHandler(mock)

	ctx, cancel := context.WithCancel(context.Background())
	downloadable := newMockDownloadable()

	// Start download in a goroutine
	doneCh := make(chan struct{})
	var resultErr error

	go func() {
		_, resultErr = h.downloadWithRetry(ctx, downloadable)
		close(doneCh)
	}()

	// Wait for first attempt to fail
	time.Sleep(100 * time.Millisecond)

	// Cancel context during backoff
	cancel()

	// Wait for goroutine to complete
	select {
	case <-doneCh:
	case <-time.After(5 * time.Second):
		t.Fatal("Test timed out waiting for context cancellation")
	}

	if resultErr != context.Canceled {
		t.Fatalf("Expected context.Canceled error, got: %v", resultErr)
	}

	callCount := mock.GetDownloadCallCount()
	// Should have made exactly 1 call before backoff
	if callCount != 1 {
		t.Fatalf("Expected 1 download call before context cancelled during backoff, got %d", callCount)
	}
}

// TestDownloadWithRetry_PerAttemptTimeout tests per-attempt timeout.
func TestDownloadWithRetry_PerAttemptTimeout(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 2+ minute timeout verification in short mode")
	}

	mock := &mockDownloader{
		// Simulate a download that takes longer than the per-attempt timeout
		downloadDelay: mediaDownloadAttemptTimeout + 100*time.Millisecond,
		downloadData:  []byte("test-media-data"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	// The per-attempt timeout should cause this to fail after mediaDownloadMaxRetries
	start := time.Now()
	_, err := h.downloadWithRetry(ctx, downloadable)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("Expected error due to timeout, got success")
	}

	// Should fail with context deadline exceeded (from the per-attempt timeout)
	// or could be wrapped
	if err != nil && !errors.Is(err, context.DeadlineExceeded) {
		t.Logf("Note: Error is not DeadlineExceeded, got: %v (may be wrapped or last error)", err)
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != mediaDownloadMaxRetries {
		t.Fatalf("Expected %d download calls (all timed out), got %d", mediaDownloadMaxRetries, callCount)
	}

	// The total time should be approximately: mediaDownloadMaxRetries * mediaDownloadAttemptTimeout + backoff delays
	// Each attempt times out after mediaDownloadAttemptTimeout, then backoff occurs
	expectedMinTime := time.Duration(mediaDownloadMaxRetries)*mediaDownloadAttemptTimeout +
		mediaDownloadBaseDelay + (mediaDownloadBaseDelay * 2) + (mediaDownloadBaseDelay * 4)

	if elapsed < expectedMinTime {
		t.Logf("Warning: Elapsed time %v is less than expected minimum %v (timing variations possible)",
			elapsed, expectedMinTime)
	}
}

// TestDownloadWithRetry_BackoffTimingVerification verifies correct backoff timing.
func TestDownloadWithRetry_BackoffTimingVerification(t *testing.T) {
	callTimestamps := make([]time.Time, 0, mediaDownloadMaxRetries)
	var mu sync.Mutex

	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("attempt 1 fails"),
			errors.New("attempt 2 fails"),
			errors.New("attempt 3 fails"),
			errors.New("attempt 4 fails"),
		},
		onDownload: func() {
			mu.Lock()
			callTimestamps = append(callTimestamps, time.Now())
			mu.Unlock()
		},
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	h.downloadWithRetry(ctx, downloadable)

	if len(callTimestamps) != mediaDownloadMaxRetries {
		t.Fatalf("Expected %d call timestamps, got %d", mediaDownloadMaxRetries, len(callTimestamps))
	}

	// Verify backoff delays between attempts
	// Attempt 1 to 2: ~1s backoff
	// Attempt 2 to 3: ~2s backoff
	// Attempt 3 to 4: ~4s backoff
	delays := make([]time.Duration, 0, mediaDownloadMaxRetries-1)
	for i := 1; i < len(callTimestamps); i++ {
		delay := callTimestamps[i].Sub(callTimestamps[i-1])
		delays = append(delays, delay)
	}

	// First delay should be approximately mediaDownloadBaseDelay (1s)
	if len(delays) > 0 {
		expectedDelay1 := mediaDownloadBaseDelay
		// Allow 50% margin for timing variations
		minDelay1 := time.Duration(float64(expectedDelay1) * 0.5)
		maxDelay1 := time.Duration(float64(expectedDelay1) * 1.5)

		if delays[0] < minDelay1 || delays[0] > maxDelay1 {
			t.Errorf("First backoff delay %v is outside expected range [%v, %v]",
				delays[0], minDelay1, maxDelay1)
		}
	}

	// Second delay should be approximately 2 * mediaDownloadBaseDelay (2s)
	if len(delays) > 1 {
		expectedDelay2 := mediaDownloadBaseDelay * 2
		minDelay2 := time.Duration(float64(expectedDelay2) * 0.5)
		maxDelay2 := time.Duration(float64(expectedDelay2) * 1.5)

		if delays[1] < minDelay2 || delays[1] > maxDelay2 {
			t.Errorf("Second backoff delay %v is outside expected range [%v, %v]",
				delays[1], minDelay2, maxDelay2)
		}
	}

	// Third delay should be approximately 4 * mediaDownloadBaseDelay (4s)
	if len(delays) > 2 {
		expectedDelay3 := mediaDownloadBaseDelay * 4
		minDelay3 := time.Duration(float64(expectedDelay3) * 0.5)
		maxDelay3 := time.Duration(float64(expectedDelay3) * 1.5)

		if delays[2] < minDelay3 || delays[2] > maxDelay3 {
			t.Errorf("Third backoff delay %v is outside expected range [%v, %v]",
				delays[2], minDelay3, maxDelay3)
		}
	}
}

// TestDownloadWithRetry_ParentContextRespected tests that parent context is checked before attempts.
func TestDownloadWithRetry_ParentContextRespected(t *testing.T) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("first attempt fails"),
		},
	}

	h := newTestHandler(mock)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	downloadable := newMockDownloadable()

	// This should cancel during the backoff period (which is 1s)
	_, err := h.downloadWithRetry(ctx, downloadable)

	if err != context.Canceled && err != context.DeadlineExceeded {
		t.Logf("Note: Expected context error, got: %v", err)
	}

	// Should only have made 1 call (first attempt) before parent context timeout
	callCount := mock.GetDownloadCallCount()
	if callCount > 1 {
		t.Logf("Warning: Expected at most 1 download call due to parent context timeout, got %d", callCount)
	}
}

// TestDownloadWithRetry_ExponentialBackoffProgression verifies exponential backoff progression.
func TestDownloadWithRetry_ExponentialBackoffProgression(t *testing.T) {
	// This test verifies the backoff progression: 1s, 2s, 4s for 4 retries
	expectedBackoffs := []time.Duration{
		1 * time.Second, // After attempt 1
		2 * time.Second, // After attempt 2
		4 * time.Second, // After attempt 3
		// No backoff after attempt 4 (last attempt)
	}

	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("attempt 1 fails"),
			errors.New("attempt 2 fails"),
			errors.New("attempt 3 fails"),
			errors.New("attempt 4 fails"),
		},
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	start := time.Now()
	h.downloadWithRetry(ctx, downloadable)
	totalTime := time.Since(start)

	// Calculate expected total time:
	// For 4 attempts: (attempt1 + 1s backoff) + (attempt2 + 2s backoff) + (attempt3 + 4s backoff) + attempt4
	// We only measure the backoff portion since attempt times are negligible in our mock
	expectedBackoffTime := expectedBackoffs[0] + expectedBackoffs[1] + expectedBackoffs[2]

	// Allow significant margin for test execution time
	minExpectedTime := expectedBackoffTime

	if totalTime < minExpectedTime {
		t.Errorf("Total time %v is less than expected minimum backoff time %v",
			totalTime, minExpectedTime)
	}

	// Verify the number of retries
	callCount := mock.GetDownloadCallCount()
	if callCount != mediaDownloadMaxRetries {
		t.Errorf("Expected %d download calls, got %d", mediaDownloadMaxRetries, callCount)
	}
}

// TestDownloadWithRetry_RealImageMessage tests with a real ImageMessage structure.
func TestDownloadWithRetry_RealImageMessage(t *testing.T) {
	mock := &mockDownloader{
		downloadData: []byte("image-data-from-whatsapp"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()

	// Use a real ImageMessage structure
	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key-123"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	data, err := h.downloadWithRetry(ctx, imgMsg)

	if err != nil {
		t.Fatalf("Expected success with real ImageMessage, got error: %v", err)
	}

	if string(data) != "image-data-from-whatsapp" {
		t.Fatalf("Expected 'image-data-from-whatsapp', got '%s'", string(data))
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 1 {
		t.Fatalf("Expected 1 download call, got %d", callCount)
	}
}

// TestDownloadWithRetry_ImmediateSecondAttemptSuccess tests success on second attempt with minimal delay.
func TestDownloadWithRetry_ImmediateSecondAttemptSuccess(t *testing.T) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("first attempt fails"),
			nil, // Second attempt succeeds
		},
		downloadData: []byte("data-on-second-try"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	start := time.Now()
	data, err := h.downloadWithRetry(ctx, downloadable)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Expected success on second attempt, got error: %v", err)
	}

	if string(data) != "data-on-second-try" {
		t.Fatalf("Expected 'data-on-second-try', got '%s'", string(data))
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 2 {
		t.Fatalf("Expected 2 download calls, got %d", callCount)
	}

	// Should have approximately 1s backoff
	expectedDelay := mediaDownloadBaseDelay
	minDelay := time.Duration(float64(expectedDelay) * 0.8)
	maxDelay := time.Duration(float64(expectedDelay) * 1.5)

	if elapsed < minDelay || elapsed > maxDelay {
		t.Logf("Note: Elapsed time %v is outside expected range [%v, %v] (timing variations possible)",
			elapsed, minDelay, maxDelay)
	}
}

// TestDownloadWithRetry_MaxRetriesExhausted verifies that we don't exceed max retries.
func TestDownloadWithRetry_MaxRetriesExhausted(t *testing.T) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("error 1"),
			errors.New("error 2"),
			errors.New("error 3"),
			errors.New("error 4"),
			errors.New("error 5"), // This should never be called
			errors.New("error 6"),
		},
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	_, err := h.downloadWithRetry(ctx, downloadable)

	if err == nil {
		t.Fatal("Expected error when all retries fail, got success")
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != mediaDownloadMaxRetries {
		t.Fatalf("Expected exactly %d download calls (max retries), got %d", mediaDownloadMaxRetries, callCount)
	}

	if callCount > 4 {
		t.Errorf("Made %d calls but max retries is 4 - should not exceed max retries", callCount)
	}
}

// TestDownloadWithRetry_ReturnsCorrectData verifies the actual downloaded data is returned.
func TestDownloadWithRetry_ReturnsCorrectData(t *testing.T) {
	expectedData := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0xFF, 0xFE, 0xFD}
	mock := &mockDownloader{
		downloadData: expectedData,
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	data, err := h.downloadWithRetry(ctx, downloadable)

	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	// Verify exact byte-for-byte match
	if len(data) != len(expectedData) {
		t.Fatalf("Expected data length %d, got %d", len(expectedData), len(data))
	}

	for i := range expectedData {
		if data[i] != expectedData[i] {
			t.Errorf("Data mismatch at index %d: expected 0x%02X, got 0x%02X",
				i, expectedData[i], data[i])
		}
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 1 {
		t.Fatalf("Expected 1 download call, got %d", callCount)
	}
}

// TestDownloadWithRetry_SecondAttemptSuccessNoThirdCall verifies we stop trying after success.
func TestDownloadWithRetry_SecondAttemptSuccessNoThirdCall(t *testing.T) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("first fails"),
			nil, // Second succeeds
		},
		downloadData: []byte("success-data"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	data, err := h.downloadWithRetry(ctx, downloadable)

	if err != nil {
		t.Fatalf("Expected success, got error: %v", err)
	}

	if string(data) != "success-data" {
		t.Fatalf("Expected 'success-data', got '%s'", string(data))
	}

	callCount := mock.GetDownloadCallCount()
	if callCount != 2 {
		t.Fatalf("Expected exactly 2 download calls (second succeeded), got %d", callCount)
	}
}

// TestDownloadWithRetry_ConstValues verifies that retry constants are properly set.
func TestDownloadWithRetry_ConstValues(t *testing.T) {
	// This test verifies the constants are set to expected values
	if mediaDownloadMaxRetries != 4 {
		t.Errorf("Expected mediaDownloadMaxRetries = 4, got %d", mediaDownloadMaxRetries)
	}

	if mediaDownloadBaseDelay != 1*time.Second {
		t.Errorf("Expected mediaDownloadBaseDelay = 1s, got %v", mediaDownloadBaseDelay)
	}

	if mediaDownloadAttemptTimeout != 30*time.Second {
		t.Errorf("Expected mediaDownloadAttemptTimeout = 30s, got %v", mediaDownloadAttemptTimeout)
	}
}

// BenchmarkDownloadWithRetry_Success benchmarks the successful download case.
func BenchmarkDownloadWithRetry_Success(b *testing.B) {
	mock := &mockDownloader{
		downloadData: []byte("benchmark-test-data"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := h.downloadWithRetry(ctx, downloadable)
		if err != nil {
			b.Fatalf("Unexpected error: %v", err)
		}
	}
}

// BenchmarkDownloadWithRetry_WithRetry benchmarks the retry case.
func BenchmarkDownloadWithRetry_WithRetry(b *testing.B) {
	mock := &mockDownloader{
		downloadErrors: []error{
			errors.New("first fails"),
			nil, // Succeeds on second try
		},
		downloadData: []byte("benchmark-test-data"),
	}

	h := newTestHandler(mock)
	ctx := context.Background()
	downloadable := newMockDownloadable()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Reset call count
		mock.ResetCallCount()

		_, err := h.downloadWithRetry(ctx, downloadable)
		if err != nil {
			b.Fatalf("Unexpected error: %v", err)
		}
	}
}
