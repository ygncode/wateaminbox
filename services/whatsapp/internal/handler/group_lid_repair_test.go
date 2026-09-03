package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type fakeGroupLIDDirectory struct {
	known        map[types.JID]types.JID
	resolvable   map[types.JID]types.JID
	batches      [][]types.JID
	failCalls    map[int]bool
	afterResolve func(int)
}

func (directory *fakeGroupLIDDirectory) KnownLIDs(
	_ context.Context,
	phoneJIDs []types.JID,
) (map[types.JID]types.JID, error) {
	known := make(map[types.JID]types.JID)
	for _, phoneJID := range phoneJIDs {
		if lid, exists := directory.known[phoneJID]; exists {
			known[phoneJID] = lid
		}
	}
	return known, nil
}

func (directory *fakeGroupLIDDirectory) ResolveLIDs(
	_ context.Context,
	phoneJIDs []types.JID,
) error {
	batch := append([]types.JID(nil), phoneJIDs...)
	directory.batches = append(directory.batches, batch)
	if directory.failCalls[len(directory.batches)] {
		return errors.New("lookup failed")
	}
	for _, phoneJID := range phoneJIDs {
		if lid, exists := directory.resolvable[phoneJID]; exists {
			directory.known[phoneJID] = lid
		}
	}
	if directory.afterResolve != nil {
		directory.afterResolve(len(directory.batches))
	}
	return nil
}

func phoneJID(user string) types.JID {
	return types.JID{User: user, Server: types.DefaultUserServer}
}

func hiddenJID(user string) types.JID {
	return types.JID{User: user, Server: types.HiddenUserServer}
}

func phoneDeviceJID(user string, device uint16) types.JID {
	return types.JID{User: user, Device: device, Server: types.DefaultUserServer}
}

func groupWithParticipants(phoneJIDs ...types.JID) []*types.GroupInfo {
	participants := make([]types.GroupParticipant, len(phoneJIDs))
	for index, jid := range phoneJIDs {
		participants[index] = types.GroupParticipant{JID: jid}
	}
	return []*types.GroupInfo{{Participants: participants}}
}

func TestLIDMappingsFromDirectoryResponsesIncludesOrdinaryAndHostedLIDs(t *testing.T) {
	phoneA := phoneJID("100")
	phoneB := phoneJID("200")
	ordinary := hiddenJID("lid-100")
	hosted := types.JID{User: "lid-200", Server: types.HostedLIDServer}

	mappings := lidMappingsFromDirectoryResponses([]types.IsOnWhatsAppResponse{
		{JID: ordinary, PhoneNumber: phoneA},
		{JID: hosted, PhoneNumber: phoneB},
		{JID: phoneJID("300"), PhoneNumber: phoneJID("300")},
		{JID: hiddenJID("no-phone")},
	})

	require.Len(t, mappings, 2)
	assert.Equal(t, ordinary, mappings[0].LID)
	assert.Equal(t, phoneA, mappings[0].PN)
	assert.Equal(t, hosted, mappings[1].LID)
	assert.Equal(t, phoneB, mappings[1].PN)
}

func TestGroupParticipantPhoneJIDsAreUniqueAndDeterministic(t *testing.T) {
	groups := []*types.GroupInfo{
		nil,
		{
			OwnerPN: phoneDeviceJID("300", 4),
			Participants: []types.GroupParticipant{
				{JID: hiddenJID("lid-100"), PhoneNumber: phoneDeviceJID("100", 2)},
				{JID: phoneJID("200")},
				{JID: hiddenJID("lid-only")},
				{JID: phoneJID("100")},
			},
		},
	}

	assert.Equal(t, []types.JID{
		phoneJID("100"),
		phoneJID("200"),
		phoneJID("300"),
	}, groupParticipantPhoneJIDs(groups))
}

func TestRepairMissingGroupLIDsQueriesOnlyUnknownParticipantsInBatches(t *testing.T) {
	knownPhone := phoneJID("100")
	missingA := phoneJID("200")
	missingB := phoneJID("300")
	missingC := phoneJID("400")
	directory := &fakeGroupLIDDirectory{
		known: map[types.JID]types.JID{
			knownPhone: hiddenJID("lid-100"),
		},
		resolvable: map[types.JID]types.JID{
			missingA: hiddenJID("lid-200"),
			missingB: hiddenJID("lid-300"),
			missingC: hiddenJID("lid-400"),
		},
	}

	stats, err := repairMissingGroupLIDs(
		context.Background(),
		directory,
		groupWithParticipants(knownPhone, missingA, missingB, missingC),
		0,
		2,
		0,
	)
	require.NoError(t, err)
	assert.Equal(t, groupLIDRepairStats{
		Candidates: 4,
		Missing:    3,
		Attempted:  3,
		Resolved:   3,
	}, stats)
	assert.Equal(t, [][]types.JID{
		{missingA, missingB},
		{missingC},
	}, directory.batches)
}

func TestRepairMissingGroupLIDsRetriesTransientBatchFailure(t *testing.T) {
	first := phoneJID("100")
	second := phoneJID("200")
	directory := &fakeGroupLIDDirectory{
		known: map[types.JID]types.JID{},
		resolvable: map[types.JID]types.JID{
			first:  hiddenJID("lid-100"),
			second: hiddenJID("lid-200"),
		},
		failCalls: map[int]bool{1: true},
	}

	stats, err := repairMissingGroupLIDs(
		context.Background(),
		directory,
		groupWithParticipants(first, second),
		0,
		1,
		0,
	)
	require.NoError(t, err)
	assert.Equal(t, 2, stats.Resolved)
	assert.Zero(t, stats.Unresolved)
	assert.Zero(t, stats.FailedBatches)
	assert.Len(t, directory.batches, 3)
}

func TestRepairMissingGroupLIDsReportsPermanentFailureAndContinues(t *testing.T) {
	first := phoneJID("100")
	second := phoneJID("200")
	directory := &fakeGroupLIDDirectory{
		known: map[types.JID]types.JID{},
		resolvable: map[types.JID]types.JID{
			first:  hiddenJID("lid-100"),
			second: hiddenJID("lid-200"),
		},
		failCalls: map[int]bool{1: true, 2: true},
	}

	stats, err := repairMissingGroupLIDs(
		context.Background(),
		directory,
		groupWithParticipants(first, second),
		0,
		1,
		0,
	)
	require.Error(t, err)
	assert.Equal(t, 1, stats.Resolved)
	assert.Equal(t, 1, stats.Unresolved)
	assert.Equal(t, 1, stats.FailedBatches)
	assert.Len(t, directory.batches, 3)
}

func TestRepairMissingGroupLIDsCapsEachWorkerLifetimeAttempt(t *testing.T) {
	first := phoneJID("100")
	second := phoneJID("200")
	third := phoneJID("300")
	directory := &fakeGroupLIDDirectory{
		known: map[types.JID]types.JID{},
		resolvable: map[types.JID]types.JID{
			first:  hiddenJID("lid-100"),
			second: hiddenJID("lid-200"),
			third:  hiddenJID("lid-300"),
		},
	}

	stats, err := repairMissingGroupLIDs(
		context.Background(),
		directory,
		groupWithParticipants(first, second, third),
		2,
		2,
		0,
	)
	require.NoError(t, err)
	assert.Equal(t, 3, stats.Missing)
	assert.Equal(t, 2, stats.Attempted)
	assert.Equal(t, 2, stats.Resolved)
	assert.Equal(t, 1, stats.Skipped)
	assert.Equal(t, [][]types.JID{{first, second}}, directory.batches)
}

func TestRepairMissingGroupLIDsReportsProgressBeforeCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	first := phoneJID("100")
	second := phoneJID("200")
	directory := &fakeGroupLIDDirectory{
		known: map[types.JID]types.JID{},
		resolvable: map[types.JID]types.JID{
			first:  hiddenJID("lid-100"),
			second: hiddenJID("lid-200"),
		},
		afterResolve: func(call int) {
			if call == 1 {
				cancel()
			}
		},
	}

	stats, err := repairMissingGroupLIDs(
		ctx,
		directory,
		groupWithParticipants(first, second),
		0,
		1,
		time.Hour,
	)
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 1, stats.Attempted)
	assert.Equal(t, 1, stats.Resolved)
	assert.Zero(t, stats.Unresolved)
	assert.Len(t, directory.batches, 1)
}

func TestRepairMissingGroupLIDsHonorsCancellationBeforeLookup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	first := phoneJID("100")
	second := phoneJID("200")
	directory := &fakeGroupLIDDirectory{
		known: map[types.JID]types.JID{},
		resolvable: map[types.JID]types.JID{
			first:  hiddenJID("lid-100"),
			second: hiddenJID("lid-200"),
		},
	}
	cancel()

	stats, err := repairMissingGroupLIDs(
		ctx,
		directory,
		groupWithParticipants(first, second),
		0,
		1,
		time.Hour,
	)
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 2, stats.Missing)
	assert.Zero(t, stats.Attempted)
	assert.Zero(t, stats.Unresolved)
	assert.Empty(t, directory.batches)
}

func TestBeginGroupLIDRepairAllowsOnlyOneWorkerLifetimeAttempt(t *testing.T) {
	handler := New(Config{Ctx: context.Background()})
	ctx, finish, started := handler.beginGroupLIDRepair(context.Background())
	require.True(t, started)
	require.NotNil(t, ctx)

	_, _, overlapping := handler.beginGroupLIDRepair(context.Background())
	assert.False(t, overlapping)
	finish()

	_, _, repeated := handler.beginGroupLIDRepair(context.Background())
	assert.False(t, repeated)
}

func TestTerminalConnectionEventsCancelJoinedGroupSync(t *testing.T) {
	handler := New(Config{})
	assertCanceled := func(handle func()) {
		ctx, cancel := context.WithCancel(context.Background())
		handler.groupSyncMu.Lock()
		handler.groupSyncCancel = cancel
		handler.groupSyncMu.Unlock()
		handle()
		require.Eventually(t, func() bool {
			return errors.Is(ctx.Err(), context.Canceled)
		}, time.Second, time.Millisecond)
	}

	assertCanceled(func() { handler.handleDisconnected(&events.Disconnected{}) })
	assertCanceled(func() { handler.handleLoggedOut(&events.LoggedOut{}) })
	assertCanceled(func() { handler.handleStreamReplaced(&events.StreamReplaced{}) })
}

func TestBeginGroupLIDRepairUsesConnectionContext(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	handler := New(Config{Ctx: parent})
	ctx, finish, started := handler.beginGroupLIDRepair(parent)
	require.True(t, started)
	defer finish()

	cancel()
	require.Eventually(t, func() bool {
		return errors.Is(ctx.Err(), context.Canceled)
	}, time.Second, time.Millisecond)
}
