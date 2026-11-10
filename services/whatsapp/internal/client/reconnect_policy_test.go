package client

import (
	"context"
	"errors"
	"math"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

func recoveryFixture() (*Client, chan time.Time) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := make(chan time.Time, 100)
	c := &Client{ctx: ctx, cancelReconnect: cancel}
	c.dialReconnect = func(context.Context) error {
		calls <- time.Now()
		return nil
	}
	return c, calls
}

func loseSession(c *Client) time.Time {
	at := time.Now()
	c.recordConnectionEvent(&events.Disconnected{})
	c.HandleReconnect(c.ctx)
	return at
}

func assertDelay(t *testing.T, elapsed, nominal time.Duration) {
	t.Helper()
	require.GreaterOrEqual(t, elapsed, nominal*9/10)
	require.LessOrEqual(t, elapsed, nominal*11/10)
}

func TestReconnectRetainsBackoffAcrossShortAuthenticatedSessions(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		for _, nominal := range []time.Duration{2, 4, 8, 16, 30} {
			lost := loseSession(c)
			assertDelay(t, (<-calls).Sub(lost), nominal*time.Second)
			c.recordConnectionEvent(&events.Connected{})
			synctest.Wait()
			time.Sleep(45 * time.Second)
		}
		c.mu.RLock()
		require.Equal(t, 5, c.reconnectAttemptNum)
		c.mu.RUnlock()
		// After five minutes of repeated failures, use the persistent delay,
		// even though each individual connection successfully authenticated.
		time.Sleep(2 * time.Minute)
		lost := loseSession(c)
		assertDelay(t, (<-calls).Sub(lost), persistentBackoff)
	})
}

func TestReconnectResetsOnlyAfterStableAuthentication(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		for range 3 {
			loseSession(c)
			<-calls
			c.recordConnectionEvent(&events.Connected{})
			synctest.Wait()
			time.Sleep(45 * time.Second)
		}
		time.Sleep(stableConnectionDuration)
		lost := loseSession(c)
		assertDelay(t, (<-calls).Sub(lost), initialBackoff)
		c.mu.RLock()
		require.Equal(t, 1, c.reconnectAttemptNum)
		c.mu.RUnlock()
	})
}

func TestDuplicateConnectedDoesNotPostponeStableReset(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		loseSession(c)
		<-calls
		c.recordConnectionEvent(&events.Connected{})
		synctest.Wait()
		time.Sleep(4 * time.Minute)
		c.recordConnectionEvent(&events.Connected{})
		time.Sleep(time.Minute)
		lost := loseSession(c)
		assertDelay(t, (<-calls).Sub(lost), initialBackoff)
	})
}

func TestSocketOpenDoesNotProveReadinessOrResetBackoff(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		loseSession(c)
		<-calls // A successful dial, but no Connected event.
		time.Sleep(10 * time.Minute)
		synctest.Wait()
		c.mu.RLock()
		require.False(t, c.connected)
		require.True(t, c.connectedAt.IsZero())
		require.Equal(t, 1, c.reconnectAttemptNum)
		c.mu.RUnlock()
		require.Empty(t, calls)
		lost := loseSession(c)
		assertDelay(t, (<-calls).Sub(lost), persistentBackoff)
	})
}

func TestFastDisconnectDuringDialIsNotLost(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		attempts := 0
		c.dialReconnect = func(context.Context) error {
			attempts++
			calls <- time.Now()
			c.recordConnectionEvent(&events.Connected{})
			if attempts == 1 {
				c.recordConnectionEvent(&events.Disconnected{})
				c.HandleReconnect(c.ctx)
			}
			return nil
		}
		lost := loseSession(c)
		first := <-calls
		assertDelay(t, first.Sub(lost), initialBackoff)
		second := <-calls
		assertDelay(t, second.Sub(first), 4*time.Second)
		synctest.Wait()
		c.mu.RLock()
		require.True(t, c.connected)
		require.False(t, c.reconnecting)
		c.mu.RUnlock()
	})
}

func TestDuplicateRequestsCoalesceWithoutResettingDelay(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		lost := loseSession(c)
		synctest.Wait()
		time.Sleep(time.Second)
		for range 100 {
			go c.HandleReconnect(c.ctx)
		}
		synctest.Wait()
		assertDelay(t, (<-calls).Sub(lost), initialBackoff)
		c.recordConnectionEvent(&events.Connected{})
		synctest.Wait()
		time.Sleep(time.Minute)
		require.Empty(t, calls)
	})
}

func TestFailedDialsUseSamePersistentBudget(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		c.dialReconnect = func(context.Context) error {
			calls <- time.Now()
			return errors.New("synthetic dial failure")
		}
		previous := loseSession(c)
		for _, nominal := range []time.Duration{2, 4, 8, 16, 30, 30} {
			at := <-calls
			assertDelay(t, at.Sub(previous), nominal*time.Second)
			previous = at
		}
	})
}

func TestReconnectCancellationAndTerminalEvents(t *testing.T) {
	for name, stop := range map[string]func(*Client){
		"shutdown":        (*Client).StopReconnect,
		"logged_out":      func(c *Client) { c.recordConnectionEvent(&events.LoggedOut{}) },
		"replaced":        func(c *Client) { c.recordConnectionEvent(&events.StreamReplaced{}) },
		"ban":             func(c *Client) { c.recordConnectionEvent(&events.TemporaryBan{}) },
		"outdated":        func(c *Client) { c.recordConnectionEvent(&events.ClientOutdated{}) },
		"connect_failure": func(c *Client) { c.recordConnectionEvent(&events.ConnectFailure{}) },
	} {
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				c, calls := recoveryFixture()
				defer c.StopReconnect()
				loseSession(c)
				synctest.Wait()
				stop(c)
				c.HandleReconnect(context.Background())
				synctest.Wait()
				time.Sleep(10 * time.Minute)
				require.Empty(t, calls)
				c.mu.RLock()
				require.False(t, c.reconnecting)
				c.mu.RUnlock()
			})
		})
	}
}

func TestShutdownCancelsInFlightDialEvenWithDifferentCallerContext(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		c.dialReconnect = func(ctx context.Context) error {
			calls <- time.Now()
			<-ctx.Done()
			return ctx.Err()
		}
		c.recordConnectionEvent(&events.Disconnected{})
		c.HandleReconnect(context.Background())
		<-calls
		c.StopReconnect()
		synctest.Wait()
		c.mu.RLock()
		require.False(t, c.reconnecting)
		c.mu.RUnlock()
	})
}

func TestCallerCancellationStopsPendingRetry(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		ctx, cancel := context.WithCancel(context.Background())
		c.HandleReconnect(ctx)
		synctest.Wait()
		cancel()
		synctest.Wait()
		time.Sleep(time.Minute)
		require.Empty(t, calls)
		// A later valid request is not stranded by the cancelled caller.
		lost := time.Now()
		c.HandleReconnect(c.ctx)
		assertDelay(t, (<-calls).Sub(lost), initialBackoff)
	})
}

func TestReconnectConfigurationPreservesPairingHandshakeAndMessageRecovery(t *testing.T) {
	wa := &whatsmeow.Client{EnableAutoReconnect: true}
	configureMessageRecovery(wa)
	configureReconnect(wa)
	require.False(t, wa.EnableAutoReconnect)
	require.False(t, wa.DisableLoginAutoReconnect)
	require.True(t, wa.AutomaticMessageRerequestFromPhone)
	require.True(t, wa.SynchronousAck)
	require.True(t, wa.EnableDecryptedEventBuffer)
}

func TestStaleConnectedEventDoesNotReachBootstrapOrReadinessHandlers(t *testing.T) {
	c := &Client{client: &whatsmeow.Client{}}
	forwarded := false
	c.RegisterDurableEventHandler(func(interface{}) bool { forwarded = true; return true })
	require.True(t, c.internalEventHandlerWithSuccessStatus(&events.Connected{}))
	require.False(t, forwarded)
	require.False(t, c.connected)
}

func TestTerminalEventDoesNotCancelCredentialCleanupContext(t *testing.T) {
	c, _ := recoveryFixture()
	defer c.StopReconnect()
	c.recordConnectionEvent(&events.LoggedOut{})
	require.NoError(t, c.ctx.Err(), "the vendor's concurrent revoked-store deletion still needs this context")
	require.True(t, c.reconnectBlocked)
}

func TestKeepAliveFailureUsesNormalRecoveryAndRejectsPreviousSocketEvents(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		started := time.Now()
		c.socketStartedAt = started
		c.recordConnectionEvent(&events.Connected{})
		resets := 0
		c.resetSocket = func() {
			resets++
			// ResetConnection's forced Disconnected event uses the same path
			// as a remote socket close, including the handler's recovery request.
			c.recordConnectionEvent(&events.Disconnected{})
			c.HandleReconnect(c.ctx)
		}
		c.recoverKeepAlive(&events.KeepAliveTimeout{LastSuccess: started})
		require.Zero(t, resets, "a transient missed keepalive must not reset a session")
		time.Sleep(whatsmeow.KeepAliveMaxFailTime + time.Second)
		at := time.Now()
		c.recoverKeepAlive(&events.KeepAliveTimeout{LastSuccess: started})
		require.Equal(t, 1, resets)
		assertDelay(t, (<-calls).Sub(at), initialBackoff)
		c.mu.Lock()
		c.socketStartedAt = time.Now()
		c.mu.Unlock()
		c.recordConnectionEvent(&events.Connected{})
		synctest.Wait()
		time.Sleep(whatsmeow.KeepAliveMaxFailTime + time.Second)
		c.recoverKeepAlive(&events.KeepAliveTimeout{LastSuccess: started})
		require.Equal(t, 1, resets, "a delayed timeout from an older socket must not close the new one")
	})
}

func TestRetainedBackoffCannotOverflow(t *testing.T) {
	for _, attempt := range []int{31, 63, 64, 1_000_000, math.MaxInt} {
		c := &Client{reconnectStartTime: time.Now(), reconnectAttemptNum: attempt}
		assert.InDelta(t, maxTransientBackoff, c.calculateBackoff(), float64(3*time.Second))
	}
}
