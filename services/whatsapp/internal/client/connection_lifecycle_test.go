package client

import (
	"context"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

func TestLifecycleObservationCancelsBlockedBootstrapBeforeDelivery(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, _ := recoveryFixture()
		defer c.StopReconnect()
		entered := make(chan context.Context)
		finished := make(chan struct{})
		terminal := false
		c.RegisterDurableEventHandler(func(evt interface{}) bool {
			switch evt.(type) {
			case *events.Connected:
				ctx := c.ConnectionSessionContext()
				entered <- ctx
				<-ctx.Done() // initial availability is still in flight
			case *events.LoggedOut:
				terminal = true
			default:
				return false // model an unpersisted message
			}
			return true
		})
		generation, _ := c.recordConnectionEvent(&events.Connected{})
		go func() {
			c.dispatchPreparedEvent(&events.Connected{}, generation, true)
			close(finished)
		}()
		session := <-entered
		// Live messages and their persistence/ACK contract are independent of
		// a slow lifecycle handler, not serialized behind available presence.
		require.False(t, c.internalEventHandlerWithSuccessStatus("message"))
		terminalGeneration, _ := c.recordConnectionEvent(&events.LoggedOut{})
		require.ErrorIs(t, session.Err(), context.Canceled)
		require.NoError(t, c.ctx.Err(), "vendor credential cleanup must remain possible")
		c.dispatchPreparedEvent(&events.LoggedOut{}, terminalGeneration, true)
		<-finished
		require.True(t, terminal)
	})
}

func TestLifecycleSkipsPreparedConnectedAfterTerminalEvent(t *testing.T) {
	c, _ := recoveryFixture()
	defer c.StopReconnect()
	connected := 0
	c.RegisterDurableEventHandler(func(evt interface{}) bool {
		if _, ok := evt.(*events.Connected); ok {
			connected++
		}
		return true
	})
	old, _ := c.recordConnectionEvent(&events.Connected{})
	terminal, _ := c.recordConnectionEvent(&events.StreamReplaced{})
	c.dispatchPreparedEvent(&events.StreamReplaced{}, terminal, true)
	c.dispatchPreparedEvent(&events.Connected{}, old, true)
	require.Zero(t, connected)
	require.Nil(t, c.ConnectionSessionContext())
}

func TestLifecycleOldDisconnectedCannotCancelNewSession(t *testing.T) {
	c, _ := recoveryFixture()
	defer c.StopReconnect()
	c.recordConnectionEvent(&events.Connected{})
	oldSession := c.ConnectionSessionContext()
	old, _ := c.recordConnectionEvent(&events.Disconnected{})
	current, _ := c.recordConnectionEvent(&events.Connected{})
	newSession := c.ConnectionSessionContext()
	disconnected := 0
	c.RegisterDurableEventHandler(func(evt interface{}) bool {
		if _, ok := evt.(*events.Disconnected); ok {
			disconnected++
		}
		return true
	})
	c.dispatchPreparedEvent(&events.Connected{}, current, true)
	c.dispatchPreparedEvent(&events.Disconnected{}, old, true)
	require.ErrorIs(t, oldSession.Err(), context.Canceled)
	require.NoError(t, newSession.Err())
	require.Zero(t, disconnected)
}

func TestLifecycleNonCancellablePublishFinishesBeforeNewerStatus(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, _ := recoveryFixture()
		defer c.StopReconnect()
		entered, release := make(chan struct{}), make(chan struct{})
		statuses := make(chan string, 2)
		c.RegisterDurableEventHandler(func(evt interface{}) bool {
			switch evt.(type) {
			case *events.Connected:
				close(entered)
				<-release // an already-started publisher ignores cancellation
				statuses <- "connected"
			case *events.LoggedOut:
				statuses <- "logged_out"
			}
			return true
		})
		generation, _ := c.recordConnectionEvent(&events.Connected{})
		go c.dispatchPreparedEvent(&events.Connected{}, generation, true)
		<-entered
		terminal, _ := c.recordConnectionEvent(&events.LoggedOut{})
		go c.dispatchPreparedEvent(&events.LoggedOut{}, terminal, true)
		close(release)
		require.Equal(t, "connected", <-statuses)
		require.Equal(t, "logged_out", <-statuses)
	})
}

func TestKeepAliveRecoversSocketStillAwaitingAuthentication(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c, calls := recoveryFixture()
		defer c.StopReconnect()
		c.dialReconnect = func(context.Context) error {
			c.mu.Lock()
			c.socketStartedAt = time.Now()
			c.mu.Unlock()
			calls <- time.Now()
			return nil
		}
		c.resetSocket = func() { loseSession(c) }
		loseSession(c)
		opened := <-calls
		// No authenticated Connected event ever arrives. The vendor keepalive
		// still runs, and its sustained failure must not leave recovery stuck.
		time.Sleep(whatsmeow.KeepAliveMaxFailTime + time.Second)
		at := time.Now()
		c.recoverKeepAlive(&events.KeepAliveTimeout{LastSuccess: opened})
		assertDelay(t, (<-calls).Sub(at), 4*time.Second)
		c.mu.RLock()
		require.False(t, c.connected)
		require.Equal(t, 2, c.reconnectAttemptNum)
		c.mu.RUnlock()
	})
}

func TestQueuedRecoveryRevalidatesTerminalStateBeforeDial(t *testing.T) {
	c, calls := recoveryFixture()
	defer c.StopReconnect()
	c.reconnectMu.Lock() // model an initial connection/reset holding the dial lane
	loseSession(c)
	// This intentionally uses real time: sync.Mutex waits are not durably
	// blocked in synctest. Let the maximum initial jittered delay expire.
	time.Sleep(2300 * time.Millisecond)
	c.recordConnectionEvent(&events.LoggedOut{})
	c.reconnectMu.Unlock()
	require.Eventually(t, func() bool {
		c.mu.RLock()
		defer c.mu.RUnlock()
		return !c.reconnecting
	}, time.Second, time.Millisecond)
	require.Empty(t, calls, "terminal state must be checked after acquiring the dial lane")
}
