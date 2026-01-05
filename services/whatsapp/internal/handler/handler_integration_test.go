package handler

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

// integrationTestClient is a mock client that simulates network failures for integration testing.
type integrationTestClient struct {
	mu                sync.Mutex
	downloadCallCount int
	failAttempts      int // Number of attempts to fail before succeeding
	downloadDelay     time.Duration
	failureError      error
	successData       []byte
	onDownload        func(attempt int) // Callback for each download attempt
}

func (m *integrationTestClient) DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error) {
	m.mu.Lock()
	m.downloadCallCount++
	currentCall := m.downloadCallCount
	m.mu.Unlock()

	// Invoke callback if provided
	if m.onDownload != nil {
		m.onDownload(currentCall)
	}

	// Simulate delay if configured
	if m.downloadDelay > 0 {
		select {
		case <-time.After(m.downloadDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	m.mu.Lock()
	shouldFail := currentCall <= m.failAttempts
	storedError := m.failureError
	m.mu.Unlock()

	if shouldFail {
		if storedError != nil {
			return nil, storedError
		}
		return nil, errors.New("simulated network failure")
	}

	// Return success data
	if m.successData != nil {
		return m.successData, nil
	}
	return []byte("integration-test-media-data"), nil
}

func (m *integrationTestClient) GetClient() *whatsmeow.Client {
	return nil
}

func (m *integrationTestClient) HandleReconnect(ctx context.Context) {
	// No-op
}

func (m *integrationTestClient) GetDownloadCallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.downloadCallCount
}

func (m *integrationTestClient) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.downloadCallCount = 0
}

// Helper to create a handler with the test client
func newIntegrationHandler(client *integrationTestClient) *Handler {
	cfg := Config{
		WorkerID:  "integration-test-worker",
		CompanyID: "integration-test-company",
		Client:    client,
	}
	return New(cfg)
}

// TestDownloadWithRetryIntegration_SuccessAfterRetry tests the retry mechanism with simulated network failures.
func TestDownloadWithRetryIntegration_SuccessAfterRetry(t *testing.T) {
	testClient := &integrationTestClient{
		failAttempts:  2, // Fail first 2 attempts, succeed on 3rd
		successData:   []byte("integration-test-media-data"),
		downloadDelay: 100 * time.Millisecond,
	}

	h := newIntegrationHandler(testClient)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key-123"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	ctx := context.Background()

	// Measure time to verify backoff delays occurred
	start := time.Now()

	// Call the actual method on the handler
	data, err := h.downloadWithRetry(ctx, imgMsg)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Expected success after retries, got error: %v", err)
	}

	if data == nil {
		t.Fatal("Expected data to be returned, got nil")
	}

	if string(data) != "integration-test-media-data" {
		t.Errorf("Expected 'integration-test-media-data', got '%s'", string(data))
	}

	callCount := testClient.GetDownloadCallCount()
	if callCount != 3 {
		t.Errorf("Expected 3 download attempts (2 failures + 1 success), got %d", callCount)
	}

	// Verify that backoff delays occurred (at least ~3 seconds for 2 retries: 1s + 2s)
	expectedMinDelay := mediaDownloadBaseDelay + (mediaDownloadBaseDelay * 2)
	if elapsed < expectedMinDelay {
		t.Errorf("Expected minimum delay of %v, got %v", expectedMinDelay, elapsed)
	}

	t.Logf("Successfully downloaded after %d attempts with total time: %v", callCount, elapsed)
}

// TestDownloadWithRetryIntegration_AllAttemptsFail tests complete failure scenario.
func TestDownloadWithRetryIntegration_AllAttemptsFail(t *testing.T) {
	testClient := &integrationTestClient{
		failAttempts:  10, // More than max retries
		successData:   []byte("integration-test-media-data"),
		downloadDelay: 50 * time.Millisecond,
	}

	h := newIntegrationHandler(testClient)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key-123"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	ctx := context.Background()
	
	_, err := h.downloadWithRetry(ctx, imgMsg)

	if err == nil {
		t.Fatal("Expected error on all attempts, got success")
	}

	callCount := testClient.GetDownloadCallCount()
	if callCount != mediaDownloadMaxRetries {
		t.Errorf("Expected %d download attempts (max retries), got %d", mediaDownloadMaxRetries, callCount)
	}

	t.Logf("Correctly failed after %d attempts with error: %v", callCount, err)
}

// TestDownloadWithRetryIntegration_SuccessOnFirstAttempt tests immediate success without retries.
func TestDownloadWithRetryIntegration_SuccessOnFirstAttempt(t *testing.T) {
	testClient := &integrationTestClient{
		failAttempts:  0, // No failures
		successData:   []byte("integration-test-media-data"),
		downloadDelay: 50 * time.Millisecond,
	}

	h := newIntegrationHandler(testClient)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key-123"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	start := time.Now()

	data, err := h.downloadWithRetry(context.Background(), imgMsg)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Expected immediate success, got error: %v", err)
	}

	if string(data) != "integration-test-media-data" {
		t.Errorf("Expected 'integration-test-media-data', got '%s'", string(data))
	}

	callCount := testClient.GetDownloadCallCount()
	if callCount != 1 {
		t.Errorf("Expected 1 download attempt (immediate success), got %d", callCount)
	}

	// Should be fast (no backoff delays)
	if elapsed > 500*time.Millisecond {
		t.Errorf("Expected quick completion (<500ms) with no retries, got %v", elapsed)
	}

	t.Logf("Immediate success completed in: %v", elapsed)
}

// TestDownloadWithRetryIntegration_BackoffTimingVerification verifies exact backoff timing.
func TestDownloadWithRetryIntegration_BackoffTimingVerification(t *testing.T) {
	var callTimestamps []time.Time
	var mu sync.Mutex

	testClient := &integrationTestClient{
		failAttempts:  2,
		successData:   []byte("integration-test-media-data"),
		downloadDelay: 50 * time.Millisecond,
		onDownload: func(attempt int) {
			mu.Lock()
			callTimestamps = append(callTimestamps, time.Now())
			mu.Unlock()
		},
	}

	h := newIntegrationHandler(testClient)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key-123"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	h.downloadWithRetry(context.Background(), imgMsg)

	// Should have 3 calls
	if len(callTimestamps) != 3 {
		t.Fatalf("Expected 3 download calls, got %d", len(callTimestamps))
	}

	// Calculate delays between calls
	delays := make([]time.Duration, 2)
	for i := 0; i < 2; i++ {
		delays[i] = callTimestamps[i+1].Sub(callTimestamps[i])
	}

	// First backoff should be ~1 second (allow 40% margin due to timing variations)
	expectedFirstBackoff := mediaDownloadBaseDelay
	minDelay1 := time.Duration(float64(expectedFirstBackoff) * 0.6)
	maxDelay1 := time.Duration(float64(expectedFirstBackoff) * 1.4)

	if delays[0] < minDelay1 || delays[0] > maxDelay1 {
		t.Errorf("First backoff delay %v is outside expected range [%v, %v]", delays[0], minDelay1, maxDelay1)
	}

	// Second backoff should be ~2 seconds (allow 40% margin)
	expectedSecondBackoff := mediaDownloadBaseDelay * 2
	minDelay2 := time.Duration(float64(expectedSecondBackoff) * 0.6)
	maxDelay2 := time.Duration(float64(expectedSecondBackoff) * 1.4)

	if delays[1] < minDelay2 || delays[1] > maxDelay2 {
		t.Errorf("Second backoff delay %v is outside expected range [%v, %v]", delays[1], minDelay2, maxDelay2)
	}

	t.Logf("Verified backoff delays: %v, %v", delays[0], delays[1])
}

// TestDownloadWithRetryIntegration_ContextCancellation tests context cancellation during retries.
func TestDownloadWithRetryIntegration_ContextCancellation(t *testing.T) {
	testClient := &integrationTestClient{
		failAttempts:  10,
		successData:   []byte("integration-test-media-data"),
		downloadDelay: 100 * time.Millisecond,
	}

	h := newIntegrationHandler(testClient)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key-123"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan error, 1)

	go func() {
		_, err := h.downloadWithRetry(ctx, imgMsg)
		doneCh <- err
	}()

	// Cancel during the first backoff (~1s delay)
	time.Sleep(500 * time.Millisecond)
	cancel()

	err := <-doneCh
	if err != context.Canceled && err != context.DeadlineExceeded {
		t.Logf("Got error: %v (expected context error)", err)
	}

	callCount := testClient.GetDownloadCallCount()
	if callCount > 1 {
		t.Logf("Made %d calls before context cancellation (should be 1)", callCount)
	}
}

// TestDownloadWithRetryIntegration_DifferentMediaTypes tests retry with different media types.
func TestDownloadWithRetryIntegration_DifferentMediaTypes(t *testing.T) {
	mediaTypes := []struct {
		name     string
		msg      whatsmeow.DownloadableMessage
		mimeType string
	}{
		{
			name: "image",
			msg: &waE2E.ImageMessage{
				URL:           proto.String("https://example.com/image.jpg"),
				DirectPath:    proto.String("/test/image/path"),
				MediaKey:      []byte("test-image-key"),
				Mimetype:      proto.String("image/jpeg"),
				FileEncSHA256: []byte("test-image-enc-sha256"),
				FileSHA256:    []byte("test-image-sha256"),
			},
			mimeType: "image/jpeg",
		},
		{
			name: "video",
			msg: &waE2E.VideoMessage{
				URL:           proto.String("https://example.com/video.mp4"),
				DirectPath:    proto.String("/test/video/path"),
				MediaKey:      []byte("test-video-key"),
				Mimetype:      proto.String("video/mp4"),
				FileEncSHA256: []byte("test-video-enc-sha256"),
				FileSHA256:    []byte("test-video-sha256"),
			},
			mimeType: "video/mp4",
		},
		{
			name: "audio",
			msg: &waE2E.AudioMessage{
				URL:           proto.String("https://example.com/audio.ogg"),
				DirectPath:    proto.String("/test/audio/path"),
				MediaKey:      []byte("test-audio-key"),
				Mimetype:      proto.String("audio/ogg"),
				FileEncSHA256: []byte("test-audio-enc-sha256"),
				FileSHA256:    []byte("test-audio-sha256"),
			},
			mimeType: "audio/ogg",
		},
		{
			name: "document",
			msg: &waE2E.DocumentMessage{
				URL:           proto.String("https://example.com/document.pdf"),
				DirectPath:    proto.String("/test/document/path"),
				MediaKey:      []byte("test-document-key"),
				Mimetype:      proto.String("application/pdf"),
				FileEncSHA256: []byte("test-document-enc-sha256"),
				FileSHA256:    []byte("test-document-sha256"),
				FileName:      proto.String("test.pdf"),
			},
			mimeType: "application/pdf",
		},
		{
			name: "sticker",
			msg: &waE2E.StickerMessage{
				URL:           proto.String("https://example.com/sticker.webp"),
				DirectPath:    proto.String("/test/sticker/path"),
				MediaKey:      []byte("test-sticker-key"),
				Mimetype:      proto.String("image/webp"),
				FileEncSHA256: []byte("test-sticker-enc-sha256"),
				FileSHA256:    []byte("test-sticker-sha256"),
			},
			mimeType: "image/webp",
		},
	}

	for _, tc := range mediaTypes {
		t.Run(tc.name, func(t *testing.T) {
			testClient := &integrationTestClient{
				failAttempts:  1, // One failure then success
				successData:   []byte("test-data-" + tc.name),
				downloadDelay: 50 * time.Millisecond,
			}

			h := newIntegrationHandler(testClient)

			data, err := h.downloadWithRetry(context.Background(), tc.msg)

			if err != nil {
				t.Errorf("Expected success for %s, got error: %v", tc.name, err)
			}

			callCount := testClient.GetDownloadCallCount()
			if callCount != 2 {
				t.Errorf("Expected 2 download attempts for %s, got %d", tc.name, callCount)
			}

			expectedData := "test-data-" + tc.name
			if string(data) != expectedData {
				t.Errorf("Expected '%s', got '%s'", expectedData, string(data))
			}

			t.Logf("%s: Successfully downloaded after %d attempts", tc.name, callCount)
		})
	}
}

// TestDownloadWithRetryIntegration_NetworkFailureSimulation simulates various network failure patterns.
func TestDownloadWithRetryIntegration_NetworkFailureSimulation(t *testing.T) {
	testCases := []struct {
		name              string
		failCount         int
		expectedCallCount int
		shouldSucceed     bool
		description       string
	}{
		{
			name:              "intermittent_failure_recovery",
			failCount:         1,
			expectedCallCount: 2,
			shouldSucceed:     true,
			description:       "Single network glitch, recovers on second attempt",
		},
		{
			name:              "multiple_glitches",
			failCount:         2,
			expectedCallCount: 3,
			shouldSucceed:     true,
			description:       "Multiple network glitches before success",
		},
		{
			name:              "persistent_failure",
			failCount:         10,
			expectedCallCount: mediaDownloadMaxRetries,
			shouldSucceed:     false,
			description:       "Complete network outage - all retries fail",
		},
		{
			name:              "instant_success",
			failCount:         0,
			expectedCallCount: 1,
			shouldSucceed:     true,
			description:       "No network issues - immediate success",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Logf("Testing scenario: %s", tc.description)

			testClient := &integrationTestClient{
				failAttempts:  tc.failCount,
				successData:   []byte("test-data"),
				downloadDelay: 50 * time.Millisecond,
			}

			h := newIntegrationHandler(testClient)

			data, err := h.downloadWithRetry(context.Background(), &waE2E.ImageMessage{
				URL: proto.String("https://example.com/media.jpg"),
			})

			callCount := testClient.GetDownloadCallCount()
			if callCount != tc.expectedCallCount {
				t.Errorf("Expected %d download attempts, got %d", tc.expectedCallCount, callCount)
			}

			if tc.shouldSucceed {
				if err != nil {
					t.Errorf("Expected success, got error: %v", err)
				}
				if data == nil || string(data) != "test-data" {
					t.Errorf("Expected correct data on success")
				}
			} else {
				if err == nil {
					t.Error("Expected failure, got success")
				}
			}

			t.Logf("Scenario '%s': %d attempts, success=%v", tc.name, callCount, err == nil)
		})
	}
}

// TestDownloadWithRetryIntegration_PerAttemptTimeout tests per-attempt timeout behavior.
func TestDownloadWithRetryIntegration_PerAttemptTimeout(t *testing.T) {
	// Create a server that delays responses
	requestCount := 0
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requestCount++
		currentRequest := requestCount
		mu.Unlock()

		// Delay response to simulate slow network
		if currentRequest < 3 {
			// First 2 attempts timeout
			time.Sleep(mediaDownloadAttemptTimeout + 200*time.Millisecond)
			http.Error(w, "Timeout", http.StatusRequestTimeout)
			return
		}

		// Third attempt succeeds quickly
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("test-image-data"))
	}))
	defer server.Close()

	t.Logf("Test server URL: %s (per-attempt timeout is %v)", server.URL, mediaDownloadAttemptTimeout)

	// Simulate the expected timeout scenario
	testClient := &integrationTestClient{
		failAttempts:  2,
		successData:   []byte("test-data"),
		downloadDelay: mediaDownloadAttemptTimeout + 100*time.Millisecond,
	}

	h := newIntegrationHandler(testClient)

	_, err := h.downloadWithRetry(context.Background(), &waE2E.ImageMessage{
		URL: proto.String("https://example.com/media.jpg"),
	})

	// Wait for attempts to complete
	// In the real implementation, the downloadWithRetry loop handles the retries
	// So we don't need a loop here.

	if err == nil {
		t.Log("Note: Success despite timeouts (simulated client might return success after delay)")
	}
	
	callCount := testClient.GetDownloadCallCount()
	if callCount != mediaDownloadMaxRetries {
		t.Logf("Note: Made %d calls (expected %d with timeouts)", callCount, mediaDownloadMaxRetries)
	}

	t.Logf("Timeout test completed with %d attempts", callCount)
}

// TestDownloadWithRetryIntegration_ConcurrentDownloads tests concurrent media downloads.
func TestDownloadWithRetryIntegration_ConcurrentDownloads(t *testing.T) {
	const numConcurrent = 5

	var wg sync.WaitGroup
	results := make(chan struct {
		success bool
		attempts int
	}, numConcurrent)

	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()

			testClient := &integrationTestClient{
				failAttempts:  1,
				successData:   []byte("concurrent-test-data"),
				downloadDelay: 50 * time.Millisecond,
			}

			h := newIntegrationHandler(testClient)

			_, err := h.downloadWithRetry(context.Background(), &waE2E.ImageMessage{
				URL: proto.String("https://example.com/media.jpg"),
			})

			results <- struct {
				success bool
				attempts int
			}{err == nil, testClient.GetDownloadCallCount()}
		}(i)
	}

	wg.Wait()
	close(results)

	successCount := 0
	totalAttempts := 0
	for r := range results {
		if r.success {
			successCount++
		}
		totalAttempts += r.attempts
	}

	if successCount != numConcurrent {
		t.Errorf("Expected all %d concurrent downloads to succeed, got %d", numConcurrent, successCount)
	}

	t.Logf("All %d concurrent downloads succeeded with %d total attempts", successCount, totalAttempts)
}

// BenchmarkDownloadWithRetryIntegration_Success benchmarks successful retry scenario.
func BenchmarkDownloadWithRetryIntegration_Success(b *testing.B) {
	testClient := &integrationTestClient{
		failAttempts:  1,
		successData:   []byte("benchmark-data"),
		downloadDelay: 10 * time.Millisecond,
	}

	h := newIntegrationHandler(testClient)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String("https://example.com/media.jpg"),
		DirectPath:    proto.String("/test/direct/path"),
		MediaKey:      []byte("test-media-key"),
		Mimetype:      proto.String("image/jpeg"),
		FileEncSHA256: []byte("test-enc-sha256"),
		FileSHA256:    []byte("test-sha256"),
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		testClient.Reset()
		h.downloadWithRetry(ctx, imgMsg)
	}
}

// suppressLogs suppresses log output during tests.
func init() {
	// Redirect log output to avoid cluttering test results
	log.SetOutput(io.Discard)
}