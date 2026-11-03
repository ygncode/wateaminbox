package client

import (
	"context"
	"log"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

// A socket that authenticates for only a few seconds is not a successful
// recovery. Keep the retry budget until an authenticated session lasts this long.
const stableConnectionDuration = 5 * time.Minute

func configureReconnect(client *whatsmeow.Client) {
	// Two independent reconnect loops bypass each other's cooldown. Keep the
	// mandatory post-pairing 515 handshake (DisableLoginAutoReconnect=false).
	client.EnableAutoReconnect = false
}

func (c *Client) connectSocket(ctx context.Context) error {
	return ensureSocketConnected(c.client.IsConnected, func() error {
		c.mu.Lock()
		c.socketStartedAt = time.Now()
		c.mu.Unlock()
		return c.client.ConnectContext(ctx)
	})
}

// Disabling the vendor retry loop also disables its keepalive reset policy.
// Preserve that recovery path, but feed it into the same bounded retry owner.
func (c *Client) recoverKeepAlive(evt *events.KeepAliveTimeout) {
	if evt.LastSuccess.IsZero() || time.Since(evt.LastSuccess) <= whatsmeow.KeepAliveMaxFailTime {
		return
	}
	c.reconnectMu.Lock()
	defer c.reconnectMu.Unlock()
	c.mu.RLock()
	eligible := !c.reconnectBlocked && !c.socketStartedAt.IsZero() &&
		!evt.LastSuccess.Before(c.socketStartedAt) &&
		time.Since(c.socketStartedAt) >= whatsmeow.KeepAliveMaxFailTime &&
		(c.connectedAt.IsZero() || time.Since(c.connectedAt) >= whatsmeow.KeepAliveMaxFailTime) &&
		(c.ctx == nil || c.ctx.Err() == nil)
	c.mu.RUnlock()
	if eligible && c.resetSocket != nil {
		// In pinned whatsmeow, ResetConnection force-emits Disconnected even
		// when automatic dialing is disabled. Unlike Disconnect, it therefore
		// cancels session bootstrap and schedules our usual reconnect path.
		log.Printf("Resetting stalled WhatsApp socket after sustained keepalive failure")
		c.resetSocket()
	}
}

// recordConnectionEvent runs before application handlers. The generation and
// wake channel prevent a fast disconnect during a dial/handshake from being lost
// when the existing recovery goroutine is about to finish.
func (c *Client) recordConnectionEvent(evt interface{}) (uint64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch evt.(type) {
	case *events.Connected:
		if c.reconnectBlocked || (c.ctx != nil && c.ctx.Err() != nil) {
			return 0, false
		}
		c.connected = true
		if c.connectedAt.IsZero() {
			c.connectedAt = time.Now()
			parent := c.ctx
			if parent == nil {
				parent = context.Background()
			}
			c.sessionCtx, c.cancelSession = context.WithCancel(parent)
		}
		c.reconnectPending = false
	case *events.Disconnected:
		if !c.connectedAt.IsZero() && time.Since(c.connectedAt) >= stableConnectionDuration {
			c.reconnectStartTime = time.Time{}
			c.reconnectAttemptNum = 0
		}
		c.connected = false
		c.connectedAt = time.Time{}
		c.cancelSessionLocked()
		c.reconnectPending = !c.reconnectBlocked
	case *events.LoggedOut, *events.StreamReplaced, *events.TemporaryBan,
		*events.ClientOutdated, *events.ConnectFailure, *events.CATRefreshError:
		// These require explicit operator/user action, not infinite reconnects.
		c.connected = false
		c.connectedAt = time.Time{}
		c.reconnectBlocked = true
		c.reconnectPending = false
		c.cancelSessionLocked()
		// Do not cancel the socket's context here. Whatsmeow deletes revoked
		// credentials using that same context concurrently with LoggedOut;
		// cancelling it could interrupt the required store cleanup.
	default:
		return 0, true // Non-lifecycle events never wait for lifecycle delivery.
	}
	c.reconnectGeneration++
	c.wakeReconnectLocked()
	return c.reconnectGeneration, true
}

// ConnectionSessionContext is cancelled at observation time, before potentially
// slow lifecycle delivery. It is separate from the vendor's credential context.
func (c *Client) ConnectionSessionContext() context.Context {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.sessionCtx
}

func (c *Client) cancelSessionLocked() {
	if c.cancelSession != nil {
		c.cancelSession()
	}
	c.sessionCtx, c.cancelSession = nil, nil
}

func (c *Client) wakeReconnectLocked() {
	if c.reconnectWake != nil {
		select {
		case c.reconnectWake <- struct{}{}:
		default:
		}
	}
}

// HandleReconnect coalesces recovery requests into a single goroutine. Ordinary
// whatsmeow auto-reconnect is disabled; its special post-pairing 515 exchange is
// intentionally retained. The worker context always cancels recovery, even when
// the caller supplied a different context. A cancelled caller drops its request.
func (c *Client) HandleReconnect(ctx context.Context) {
	if ctx == nil {
		ctx = c.ctx
	}
	if ctx == nil {
		ctx = context.Background()
	}
	c.mu.Lock()
	if ctx.Err() != nil || c.dialReconnect == nil || c.reconnectBlocked || c.connected || (c.ctx != nil && c.ctx.Err() != nil) {
		c.mu.Unlock()
		return
	}
	if c.reconnectWake == nil {
		c.reconnectWake = make(chan struct{}, 1)
	}
	c.reconnectPending = true
	c.reconnectRequestCtx = ctx
	if c.reconnecting {
		c.wakeReconnectLocked()
		c.mu.Unlock()
		return
	}
	c.reconnecting = true
	c.mu.Unlock()
	go c.runReconnect()
}

// reconnectWait returns false when the request is no longer eligible. Duplicate
// wakeups do not reset the timer, and no failed/ambiguous socket is called ready.
func (c *Client) reconnectWait(ctx context.Context, delay time.Duration, generation uint64, handshake bool) bool {
	var timer *time.Timer
	var elapsed <-chan time.Time
	if !handshake {
		timer = time.NewTimer(delay)
		defer timer.Stop()
		elapsed = timer.C
	}
	var workerDone <-chan struct{}
	if c.ctx != nil {
		workerDone = c.ctx.Done()
	}
	for {
		c.mu.RLock()
		eligible := c.reconnectPending && !c.reconnectBlocked
		changed := c.reconnectGeneration != generation
		c.mu.RUnlock()
		if !eligible {
			return false
		}
		if handshake && changed {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-workerDone:
			return false
		case <-elapsed:
			return true
		case <-c.reconnectWake:
		}
	}
}

func (c *Client) runReconnect() {
	for {
		c.mu.Lock()
		ctx := c.reconnectRequestCtx
		if c.reconnectBlocked || !c.reconnectPending || ctx.Err() != nil || (c.ctx != nil && c.ctx.Err() != nil) {
			// Clearing this flag under the same lock as HandleReconnect is
			// important: a new disconnect cannot fall through a TryLock gap.
			c.reconnecting = false
			c.mu.Unlock()
			return
		}
		if c.reconnectStartTime.IsZero() {
			c.reconnectStartTime = time.Now()
		}
		generation := c.reconnectGeneration
		delay := c.calculateBackoff()
		c.mu.Unlock()

		if !c.reconnectWait(ctx, delay, generation, false) {
			continue
		}
		// Revalidate after the serialized dial boundary: a terminal event
		// may have arrived while another dial/reset held this mutex.
		c.reconnectMu.Lock()
		c.mu.Lock()
		if !c.reconnectPending || c.reconnectBlocked || ctx.Err() != nil || (c.ctx != nil && c.ctx.Err() != nil) {
			c.mu.Unlock()
			c.reconnectMu.Unlock()
			continue
		}
		// Count only actual attempts, not duplicated Disconnected callbacks.
		if c.reconnectAttemptNum < 1_000_000 {
			c.reconnectAttemptNum++
		}
		attempt := c.reconnectAttemptNum
		generation = c.reconnectGeneration
		c.mu.Unlock()
		log.Printf("Reconnection attempt #%d after %v backoff; awaiting authentication", attempt, delay.Round(time.Millisecond))

		// Use the worker lifetime for the socket: cancelling a temporary
		// wait/dial context after success would close a healthy websocket.
		dialCtx := c.ctx
		if dialCtx == nil {
			dialCtx = ctx
		}
		err := c.dialReconnect(dialCtx)
		c.reconnectMu.Unlock()
		if err != nil {
			log.Printf("Reconnection attempt #%d failed: %v", attempt, err)
			continue
		}
		// Socket establishment does not reset attempts, set connected=true,
		// or publish readiness. Only the authenticated Connected event does.
		c.reconnectWait(ctx, 0, generation, true)
	}
}
