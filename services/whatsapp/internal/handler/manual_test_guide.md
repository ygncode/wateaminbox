# Manual Testing Guide: Media Download Retry with Exponential Backoff

This guide provides instructions for manually testing the media download retry mechanism
implemented in the WhatsApp handler.

## Testing Prerequisites

1. Ensure the WhatsApp service is running:
   ```bash
   cd services/whatsapp && go run main.go
   ```

2. Ensure dependencies are running (PostgreSQL, NATS, MinIO):
   ```bash
   docker-compose up -d
   ```

3. Have a test WhatsApp account available for sending media messages.

## Test Scenarios

### 1. Normal Operation (No Network Issues)

**Objective:** Verify that normal media downloads work without any issues.

**Steps:**
1. Send an image message to the connected WhatsApp number.
2. Send a video message.
3. Send a document (PDF) message.
4. Send an audio message (voice note).
5. Send a sticker message.

**Expected Results:**
- All media types download successfully on the first attempt.
- No retry log messages appear.
- Logs show: "Downloaded media: X bytes, type: [mimetype]"
- Logs show: "Media uploaded successfully: [URL]"

**Checklist:**
- [ ] Image messages download and upload successfully
- [ ] Video messages download and upload successfully
- [ ] Document messages download and upload successfully
- [ ] Audio messages download and upload successfully
- [ ] Sticker messages download and upload successfully
- [ ] No retry-related log messages for successful downloads

---

### 2. Transient Network Failure (Recovers After 1-2 Retries)

**Objective:** Verify retry mechanism recovers from temporary network issues.

**Method A: Using Network Simulation Tools**

If you have `tc` (traffic control) available on Linux:
```bash
# Simulate 50% packet loss for 10 seconds
sudo tc qdisc add dev eth0 root netem loss 50%
sleep 10
sudo tc qdisc del dev eth0 root netem

# During the 10-second window, send a media message
```

**Method B: Firewall Block (Temporary)**

```bash
# Block outbound HTTPS temporarily (5 seconds)
sudo pfctl -d  # Disable firewall (macOS)
# Send media message during this window
sudo pfctl -e  # Re-enable
```

**Method C: Proxy Interruption**

If using a proxy, temporarily interrupt the proxy connection for 2-3 seconds while sending media.

**Expected Results:**
- First attempt fails (logged: "Media download attempt 1 failed: [error]")
- Retry occurs after ~1 second backoff
- Second or third attempt succeeds
- Log shows: "Media download succeeded on attempt 2 after retries" or "attempt 3"
- Final result: Media uploaded successfully

**Checklist:**
- [ ] Retry logs appear showing failed attempts
- [ ] Backoff delay is observed (~1 second between attempts)
- [ ] Media eventually downloads and uploads successfully
- [ ] Success log indicates which attempt succeeded

---

### 3. Slow Network (Per-Attempt Timeout)

**Objective:** Verify per-attempt timeout (30s) triggers retry.

**Method: Using Traffic Control to Slow Down Network**

```bash
# Limit download speed to 1KB/s (will trigger timeout)
sudo tc qdisc add dev eth0 root netem rate 1kbit
# Send a large image/video
# Wait for timeout + retry behavior
sudo tc qdisc del dev eth0 root netem
```

**Expected Results:**
- First attempt times out after ~30 seconds
- Retry occurs with 1s backoff
- If network is still slow, additional retries occur
- After 3 failed attempts, final error is logged

**Checklist:**
- [ ] Each attempt times out after ~30 seconds
- [ ] Retries occur with exponential backoff (1s, 2s, 4s)
- [ ] After 4 attempts, "no more retries" message appears
- [ ] Total time is approximately: 30s + 1s + 30s + 2s + 30s + 4s + 30s ≈ 127 seconds

---

### 4. Complete Network Failure (All Retries Exhausted)

**Objective:** Verify graceful handling of permanent failures.

**Method: Block Network Completely**

```bash
# Block all outbound traffic during test
# macOS:
sudo pfctl -e
# Add block rule, send media, observe logs
# Remove block rule
```

**Expected Results:**
- All 4 attempts fail
- Each failure is logged with attempt number
- Final log: "Media download attempt 4 failed: [error] (no more retries)"
- Final log: "Failed to download media after retry exhaustion: [error]"
- No crash or panic - service continues running

**Checklist:**
- [ ] All 4 attempts are logged
- [ ] "no more retries" message appears on final attempt
- [ ] Error message clearly indicates retry exhaustion
- [ ] Service continues running after failure
- [ ] Other messages can still be processed

---

### 5. Context Cancellation During Retry

**Objective:** Verify graceful shutdown during retry backoff.

**Method: Send Media and Immediately Stop Service**

1. Send a media message that will fail (block network first)
2. Immediately stop the service: `Ctrl+C`
3. Observe logs during shutdown

**Expected Results:**
- If backoff is in progress, cancellation is detected
- Service stops promptly (doesn't wait full backoff)
- No goroutine leaks

**Checklist:**
- [ ] Service stops promptly when interrupted during retry
- [ ] No "context canceled" errors that cause crashes
- [ ] Clean shutdown message appears

---

### 6. History Sync Media Download

**Objective:** Verify retry works for history sync media.

**Method:**
1. Disconnect and reconnect WhatsApp (triggers history sync)
2. Ensure some conversations have media in history
3. Block network temporarily during sync (2-3 seconds)
4. Observe history sync logs

**Expected Results:**
- History sync completes
- Failed media downloads trigger retries
- Retry logs appear for history media
- Rate limiting (100ms delay) is observed between media downloads
- Final log shows media counts: "History sync complete: X messages, Y media downloaded, Z media failed"

**Checklist:**
- [ ] History sync media uses retry logic
- [ ] Failed history media is retried
- [ ] Rate limiting (100ms) is still applied
- [ ] Final stats accurately reflect successes/failures
- [ ] Error message says "Failed to download history media after retry exhaustion"

---

## Log Patterns to Observe

### Successful First Attempt:
```
Downloaded media: 12345 bytes, type: image/jpeg
Media uploaded successfully: https://...
```

### Successful After Retry:
```
Media download attempt 1 failed: dial tcp: connection refused (retrying in 1s)
Media download succeeded on attempt 2 after retries
Downloaded media: 12345 bytes, type: image/jpeg
```

### All Retries Exhausted:
```
Media download attempt 1 failed: dial tcp: connection refused (retrying in 1s)
Media download attempt 2 failed: dial tcp: connection refused (retrying in 2s)
Media download attempt 3 failed: dial tcp: connection refused (retrying in 4s)
Media download attempt 4 failed: dial tcp: connection refused (no more retries)
Failed to download media after retry exhaustion: dial tcp: connection refused
```

## Automated Verification

Run the existing unit and integration tests:

```bash
cd services/whatsapp

# Run unit tests
go test -v ./internal/handler -run TestDownloadWithRetry

# Run integration tests
go test -v ./internal/handler -run TestDownloadWithRetryIntegration

# Run all handler tests
go test -v ./internal/handler
```

## Configuration Constants

Verify constants match expected values:

```go
mediaDownloadMaxRetries = 4
mediaDownloadBaseDelay = 1 * time.Second
mediaDownloadAttemptTimeout = 30 * time.Second
```

## Testing Checklist Summary

| Test Scenario | Status | Notes |
|--------------|--------|-------|
| Normal operation - all media types | [ ] | |
| Transient failure - recovers | [ ] | |
| Slow network - timeout handling | [ ] | |
| Complete failure - all retries | [ ] | |
| Context cancellation | [ ] | |
| History sync media retry | [ ] | |
| Log messages are clear | [ ] | |
| Service remains stable | [ ] | |

## Notes

- The retry mechanism adds up to ~7 seconds of delay in worst case (1s + 2s + 4s)
- Per-attempt timeout is 30 seconds
- Real-time media has 135s total timeout (includes retry delays)
- History sync media has 75s total timeout
- Rate limiting of 100ms between history media downloads remains in effect
