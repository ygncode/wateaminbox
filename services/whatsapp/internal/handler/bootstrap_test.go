package handler

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

func bootstrapTestHandler(t *testing.T) (*Handler, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	h := New(Config{Ctx: ctx})
	h.bootstrap.repairCooldown = time.Hour
	h.bootstrap.retryInterval = 20 * time.Millisecond
	t.Cleanup(func() {
		cancel()
		waitBootstrapIdle(t, h)
	})
	return h, cancel
}

func waitBootstrapIdle(t *testing.T, h *Handler) {
	t.Helper()
	require.Eventually(t, func() bool {
		h.bootstrap.mu.Lock()
		defer h.bootstrap.mu.Unlock()
		for _, job := range h.bootstrap.jobs {
			if job.running || job.pending != nil {
				return false
			}
		}
		return true
	}, 2*time.Second, time.Millisecond)
}

type bootstrapCall struct {
	kind bootstrapKind
	ctx  context.Context
}

func nextBootstrapCall(t *testing.T, calls <-chan bootstrapCall) bootstrapCall {
	t.Helper()
	select {
	case call := <-calls:
		return call
	case <-time.After(2 * time.Second):
		t.Fatal("bootstrap did not run")
		return bootstrapCall{}
	}
}

func TestBootstrapDuplicateConnectedDoesNotRepeatRepairs(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	var calls [bootstrapJobCount]atomic.Int32
	client := &bootstrapClient{}
	h.config.Client = client
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		calls[kind].Add(1)
		return nil
	}

	h.HandleEvent(&events.Connected{})
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() { h.HandleEvent(&events.Connected{}) })
	}
	wg.Wait()
	require.EqualValues(t, 1, client.available.Load())
	require.Eventually(t, func() bool {
		return calls[bootstrapContacts].Load() == 1 && calls[bootstrapGroups].Load() == 1
	}, time.Second, time.Millisecond)
	for range 2 {
		h.HandleEvent(&events.Disconnected{})
		waitBootstrapIdle(t, h)
		h.HandleEvent(&events.Connected{})
	}
	require.EqualValues(t, 1, calls[bootstrapContacts].Load())
	require.EqualValues(t, 1, calls[bootstrapGroups].Load())
	require.EqualValues(t, 3, client.available.Load())
}

func TestBootstrapCancellationPaths(t *testing.T) {
	for _, terminal := range []struct {
		name  string
		event any
	}{
		{"disconnect", &events.Disconnected{}},
		{"logout", &events.LoggedOut{}},
		{"stream-replaced", &events.StreamReplaced{}},
		{"temporary-ban", &events.TemporaryBan{}},
		{"client-outdated", &events.ClientOutdated{}},
		{"connect-failure", &events.ConnectFailure{}},
		{"cat-refresh-error", &events.CATRefreshError{}},
		{"parent-shutdown", nil},
	} {
		t.Run(terminal.name, func(t *testing.T) {
			h, cancel := bootstrapTestHandler(t)
			calls := make(chan bootstrapCall, bootstrapJobCount)
			h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
				calls <- bootstrapCall{kind, ctx}
				<-ctx.Done()
				return ctx.Err()
			}
			h.HandleEvent(&events.Connected{})
			var active []bootstrapCall
			for range bootstrapJobCount {
				active = append(active, nextBootstrapCall(t, calls))
			}
			if terminal.event == nil {
				cancel()
			} else {
				h.HandleEvent(terminal.event)
				require.NoError(t, h.config.Ctx.Err(), "terminal event must not cancel the worker parent")
			}
			waitBootstrapIdle(t, h)
			for _, call := range active {
				require.ErrorIs(t, call.ctx.Err(), context.Canceled)
			}
			if terminal.event == nil {
				h.HandleEvent(&events.Connected{})
				waitBootstrapIdle(t, h)
				require.Empty(t, calls)
			}
		})
	}
}

func TestBootstrapRapidReconnectDoesNotOverlapOrCreditCancelledWork(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	calls := make(chan bootstrapCall, 10)
	release := make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		calls <- bootstrapCall{kind, ctx}
		<-release  // model bounded I/O that is slow to observe cancellation
		return nil // cancelled success must NOT enter the cooldown
	}
	h.HandleEvent(&events.Connected{})
	for range bootstrapJobCount {
		nextBootstrapCall(t, calls)
	}
	for range 100 {
		h.HandleEvent(&events.Disconnected{})
		h.HandleEvent(&events.Connected{})
	}
	require.Empty(t, calls, "no replacement may overlap an old lane")
	once.Do(func() { close(release) })
	seen := make(map[bootstrapKind]bool)
	for range bootstrapJobCount {
		call := nextBootstrapCall(t, calls)
		require.NoError(t, call.ctx.Err())
		require.False(t, seen[call.kind])
		seen[call.kind] = true
	}
	waitBootstrapIdle(t, h)
	require.Empty(t, calls, "intermediate sessions must be coalesced")
}

func TestBootstrapRepairFailureRetriesAndSuccessCooldownEventuallyExpires(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	h.bootstrap.repairCooldown = 120 * time.Millisecond
	var calls [bootstrapJobCount]atomic.Int32
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		n := calls[kind].Add(1)
		if n == 1 {
			return errors.New("repair failed")
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 2, calls[bootstrapContacts].Load())
	require.EqualValues(t, 2, calls[bootstrapGroups].Load())
	h.HandleEvent(&events.Disconnected{})
	h.HandleEvent(&events.Connected{})
	time.Sleep(20 * time.Millisecond)
	require.EqualValues(t, 2, calls[bootstrapContacts].Load())
	require.EqualValues(t, 2, calls[bootstrapGroups].Load())
	// Group repair is delayed, not discarded. The successful durable contact
	// cache scan is not repeated merely because the transport reconnected.
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 2, calls[bootstrapContacts].Load())
	require.EqualValues(t, 3, calls[bootstrapGroups].Load())
}

func TestBootstrapReconnectDoesNotReplaySuccessfulNamesAfterCooldown(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	h.bootstrap.repairCooldown = 10 * time.Millisecond
	var names atomic.Int32
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		if kind == bootstrapContacts {
			names.Add(1)
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	waitBootstrapIdle(t, h)
	for range 3 {
		h.HandleEvent(&events.Disconnected{})
		h.HandleEvent(&events.Connected{})
		waitBootstrapIdle(t, h)
	}
	require.EqualValues(t, 1, names.Load())
	h.HandleEvent(&events.AppStateSyncComplete{Name: appstate.WAPatchCriticalUnblockLow})
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 2, names.Load(), "actual cache updates still request repair")
}

func TestBootstrapRateLimitCooldownSurvivesReconnect(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	h.bootstrap.repairCooldown = 150 * time.Millisecond
	var groups atomic.Int32
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		if kind == bootstrapGroups && groups.Add(1) == 1 {
			return whatsmeow.ErrIQRateOverLimit
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	require.Eventually(t, func() bool {
		h.bootstrap.mu.Lock()
		defer h.bootstrap.mu.Unlock()
		return !h.bootstrap.jobs[bootstrapGroups].retryNotBefore.IsZero()
	}, time.Second, time.Millisecond)
	h.HandleEvent(&events.Disconnected{})
	h.HandleEvent(&events.Connected{})
	time.Sleep(30 * time.Millisecond)
	require.EqualValues(t, 1, groups.Load(), "reconnect must not bypass provider cooldown")
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 2, groups.Load())
}

func TestBootstrapAppStateInterruptsCooldownAndCoalescesInFlightRequests(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	var names atomic.Int32
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		if kind == bootstrapContacts && names.Add(1) == 2 {
			close(entered)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-release:
			}
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	waitBootstrapIdle(t, h)
	h.HandleEvent(&events.Disconnected{})
	h.HandleEvent(&events.Connected{})
	h.HandleEvent(&events.AppStateSyncComplete{Name: appstate.WAPatchCriticalUnblockLow})
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("app-state repair was held behind reconnect cooldown")
	}
	for range 100 {
		h.HandleEvent(&events.AppStateSyncComplete{Name: appstate.WAPatchCriticalUnblockLow})
	}
	once.Do(func() { close(release) })
	require.Eventually(t, func() bool { return names.Load() == 3 }, time.Second, time.Millisecond)
	h.HandleEvent(&events.Disconnected{})
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 3, names.Load())
}

func TestBootstrapDelayedHistoryRepairIsCancelled(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	var names atomic.Int32
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		if kind == bootstrapContacts {
			names.Add(1)
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	waitBootstrapIdle(t, h)
	// Exercise the real history path (including its persistence grace period).
	for range 10 {
		h.HandleEvent(&events.HistorySync{Data: &waHistorySync.HistorySync{
			SyncType:  waHistorySync.HistorySync_PUSH_NAME.Enum(),
			Pushnames: []*waHistorySync.Pushname{{ID: proto.String("100@s.whatsapp.net"), Pushname: proto.String("Name")}},
		}})
	}
	h.HandleEvent(&events.Disconnected{})
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 1, names.Load())
}

func TestBootstrapCoalescingPreservesHistoryPersistenceDelay(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	var names atomic.Int32
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		if kind == bootstrapContacts {
			names.Add(1)
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	waitBootstrapIdle(t, h)
	h.requestContactRepair(80 * time.Millisecond)
	// Immediate notifications must not discard a pending history re-read's
	// grace period, whether the lane has already taken the request or not.
	for range 10 {
		h.HandleEvent(&events.AppStateSyncComplete{Name: appstate.WAPatchCriticalUnblockLow})
		time.Sleep(time.Millisecond)
	}
	require.EqualValues(t, 1, names.Load())
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 2, names.Load())
}

func TestBootstrapRetainsEventRepairAcrossSessions(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	var names atomic.Int32
	h.bootstrap.run = func(ctx context.Context, kind bootstrapKind) error {
		if kind == bootstrapContacts {
			names.Add(1)
		}
		return nil
	}
	// History can arrive around pairing before Connected. Keep its grace
	// period instead of reading the not-yet-persisted store immediately.
	h.requestContactRepair(80 * time.Millisecond)
	h.HandleEvent(&events.Connected{})
	time.Sleep(10 * time.Millisecond)
	require.Zero(t, names.Load())
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 1, names.Load())

	h.requestContactRepair(80 * time.Millisecond)
	h.HandleEvent(&events.Disconnected{})
	h.HandleEvent(&events.Connected{})
	require.Eventually(t, func() bool { return names.Load() == 2 }, time.Second, time.Millisecond,
		"cancelled event repair must bypass the prior success cooldown")
	h.HandleEvent(&events.Disconnected{})
	waitBootstrapIdle(t, h)
}

func TestBootstrapDoesNotBlockLiveMessageAckOrSenderPresence(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	h.bootstrap.run = func(context.Context, bootstrapKind) error { return nil }
	subscribed := make(chan types.JID, 2)
	h.config.Client = &bootstrapClient{subscribe: func(ctx context.Context, jid types.JID) error {
		subscribed <- jid
		return nil
	}}
	attempts := 0
	h.publishMessage = func(event natsClient.MessageEvent) error {
		attempts++
		if attempts == 1 {
			return errors.New("persistence unavailable")
		}
		return nil
	}
	h.HandleEvent(&events.Connected{})
	msg := &events.Message{
		Info: types.MessageInfo{ID: "during-bootstrap", MessageSource: types.MessageSource{
			Sender: phoneJID("100"), Chat: phoneJID("100"),
		}},
		Message: &waE2E.Message{Conversation: proto.String("hello")},
	}
	require.False(t, h.HandleEventWithSuccessStatus(msg))
	require.True(t, h.HandleEventWithSuccessStatus(msg))
	for range 2 {
		select {
		case jid := <-subscribed:
			require.Equal(t, phoneJID("100"), jid)
		case <-time.After(time.Second):
			t.Fatal("sender presence was held behind broad bootstrap")
		}
	}
}

type bootstrapClient struct {
	mockDownloader
	available atomic.Int32
	send      func(context.Context) error
	subscribe func(context.Context, types.JID) error
}

func (c *bootstrapClient) SendPresence(ctx context.Context, state types.Presence) error {
	c.available.Add(1)
	if c.send != nil {
		return c.send(ctx)
	}
	return nil
}

func (c *bootstrapClient) SubscribePresence(ctx context.Context, jid types.JID) error {
	return c.subscribe(ctx, jid)
}

type bootstrapContactsStore struct {
	store.ContactStore
	get func(context.Context) (map[types.JID]types.ContactInfo, error)
}

func (s bootstrapContactsStore) GetAllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error) {
	return s.get(ctx)
}

func (s bootstrapContactsStore) GetContact(ctx context.Context, jid types.JID) (types.ContactInfo, error) {
	contacts, err := s.get(ctx)
	return contacts[jid], err
}

func TestBootstrapInitialAvailabilityIsSessionCancelled(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	entered := make(chan context.Context, 1)
	client := &bootstrapClient{send: func(ctx context.Context) error {
		entered <- ctx
		<-ctx.Done()
		return ctx.Err()
	}}
	h.config.Client = client
	done := make(chan struct{})
	go func() { h.HandleEvent(&events.Connected{}); close(done) }()
	var ctx context.Context
	select {
	case ctx = <-entered:
	case <-time.After(time.Second):
		t.Fatal("initial available presence not sent")
	}
	h.HandleEvent(&events.Connected{}) // duplicate while initial I/O is in flight
	h.HandleEvent(&events.StreamReplaced{})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("initial presence did not cancel")
	}
	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.EqualValues(t, 1, client.available.Load())
	waitBootstrapIdle(t, h)
}

func TestBootstrapAndHistoryNeverSubscribeCachedContacts(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	h.bootstrap.repairCooldown = time.Millisecond
	var subscriptions atomic.Int32
	client := &bootstrapClient{}
	client.client = &whatsmeow.Client{Store: &store.Device{Contacts: bootstrapContactsStore{
		get: func(ctx context.Context) (map[types.JID]types.ContactInfo, error) {
			return map[types.JID]types.ContactInfo{phoneJID("100"): {}, phoneJID("200"): {}}, ctx.Err()
		},
	}}}
	client.subscribe = func(ctx context.Context, jid types.JID) error {
		subscriptions.Add(1)
		return nil
	}
	h.config.Client = client
	// No publisher means contact repair is unavailable, but presence must not
	// be a bootstrap lane regardless of that prerequisite or reconnects.
	h.bootstrap.run = func(context.Context, bootstrapKind) error { return nil }
	for range 3 {
		h.HandleEvent(&events.Connected{})
		waitBootstrapIdle(t, h)
		h.HandleEvent(&events.Disconnected{})
	}
	// History import is another bulk path: neither initial nor deferred-media
	// imports should establish presence subscriptions for old conversations.
	for _, deferMedia := range []bool{false, true} {
		h.processHistorySyncConversation(&waHistorySync.Conversation{ID: proto.String("100@s.whatsapp.net")}, deferMedia)
	}
	require.Zero(t, subscriptions.Load(), "only live-message demand may subscribe presence")
}

type bootstrapSessionClient struct {
	bootstrapClient
	session context.Context
}

func (c *bootstrapSessionClient) ConnectionSessionContext() context.Context { return c.session }

func TestBootstrapClientObservationCancelsAndSupersedesSession(t *testing.T) {
	h, _ := bootstrapTestHandler(t)
	h.bootstrap.run = func(context.Context, bootstrapKind) error { return nil }
	session, cancel := context.WithCancel(h.config.Ctx)
	defer cancel()
	entered := make(chan struct{})
	client := &bootstrapSessionClient{session: session}
	client.send = func(ctx context.Context) error {
		close(entered)
		<-ctx.Done()
		return ctx.Err()
	}
	h.config.Client = client
	done := make(chan struct{})
	go func() { h.HandleEvent(&events.Connected{}); close(done) }()
	<-entered
	// The client has observed Disconnected but its lifecycle delivery is
	// still queued behind this Connected handler. Cancellation must be prompt.
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("client observation did not cancel initial availability")
	}
	require.NoError(t, h.config.Ctx.Err())
	// The client can suppress obsolete Disconnected delivery if it has
	// already observed a new Connected. Replace the cancelled bootstrap.
	client.session = h.config.Ctx
	client.send = nil
	h.HandleEvent(&events.Connected{})
	waitBootstrapIdle(t, h)
	require.EqualValues(t, 2, client.available.Load())
	h.HandleEvent(&events.Disconnected{})
	client.session = nil
	h.HandleEvent(&events.Connected{})
	require.EqualValues(t, 2, client.available.Load(), "no active client session means no bootstrap")
}

func TestBootstrapContactStoreErrorsAndCancellationPropagate(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		t.Run(map[bool]string{false: "failure", true: "cancelled"}[cancelled], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			storeErr := errors.New("cache unavailable")
			client := &bootstrapClient{}
			client.client = &whatsmeow.Client{Store: &store.Device{Contacts: bootstrapContactsStore{
				get: func(queryCtx context.Context) (map[types.JID]types.ContactInfo, error) {
					if cancelled {
						cancel()
						require.ErrorIs(t, queryCtx.Err(), context.Canceled)
						return map[types.JID]types.ContactInfo{phoneJID("100"): {FullName: "Name"}}, nil
					}
					return nil, storeErr
				},
			}}}
			h := New(Config{Client: client, Publisher: &natsClient.Publisher{}})
			err := h.syncKnownContactNames(ctx)
			if cancelled {
				require.ErrorIs(t, err, context.Canceled)
			} else {
				require.ErrorIs(t, err, storeErr)
			}
		})
	}
}
