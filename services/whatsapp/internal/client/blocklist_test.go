package client

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow"
	waStore "go.mau.fi/whatsmeow/store"
	waTypes "go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// WhatsApp's blocklist is addressed by link-ID. Resolving a phone number to one
// belongs to whatsmeow as of upstream 8d023aa ("user: switch UpdateBlocklist to
// use LIDs"), which this service builds against - the earlier local shim that
// reproduced that resolution is gone. What these tests pin is the argument
// hygiene UpdateBlocklist assumes of its caller, and which the reported
// `400 bad-request` came from getting wrong.

// A blocklist entry names a person, not one of their devices. Store.LIDs keeps
// the device number of whatever it is asked about, so a device-qualified
// argument would be resolved into a device-qualified `jid` attribute.
func TestBlocklistTargetDropsDeviceAndAgent(t *testing.T) {
	for _, stored := range []string{
		"15550000001:12@s.whatsapp.net",
		"111111:5@lid",
	} {
		t.Run(stored, func(t *testing.T) {
			target, err := blocklistTargetJID(stored)
			require.NoError(t, err)
			assert.Zero(t, target.Device)
			assert.Zero(t, target.RawAgent)
		})
	}

	target, err := blocklistTargetJID("15550000001:12@s.whatsapp.net")
	require.NoError(t, err)
	assert.Equal(t, "15550000001@s.whatsapp.net", target.String())
}

// The two address forms UpdateBlocklist branches on reach it unchanged: a phone
// number for it to resolve, and a types.HiddenUserServer LID it can already use.
func TestBlocklistTargetPassesBothAddressFormsThrough(t *testing.T) {
	for _, stored := range []string{
		"15550000001@s.whatsapp.net",
		"111111@lid",
	} {
		t.Run(stored, func(t *testing.T) {
			target, err := blocklistTargetJID(stored)
			require.NoError(t, err)
			assert.Equal(t, stored, target.String())
		})
	}
}

// UpdateBlocklist branches on exactly two servers and has no else, so anything
// it does not name leaves its `lidJID` at the zero value and goes out as
// `jid=""` - the same opaque 400 this change is fixing.
//
// hosted.lid is the one that has to be spelled out. It is a link-ID address, so
// a check written as "is this a LID?" lets it through, but upstream tests for
// types.HiddenUserServer specifically and never for types.HostedLIDServer. What
// it would take to make one acceptable to upstream is not ours to invent, so it
// fails here with a reason instead of on the wire without one.
func TestBlocklistTargetRejectsHostedLIDsUpstreamCannotResolve(t *testing.T) {
	require.NotEqual(t, waTypes.HiddenUserServer, waTypes.HostedLIDServer,
		"the whole point of this test is that these are different servers")
	require.True(t, isLIDServer(waTypes.HostedLIDServer),
		"hosted.lid is a link-ID address, which is exactly why it needs its own rejection")

	_, err := blocklistTargetJID("222222@" + waTypes.HostedLIDServer)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not an individual contact")
	assert.Contains(t, err.Error(), waTypes.HostedLIDServer)
}

// The rest of the addresses upstream does not branch on. The API already
// refuses these, but a command queued before that check must fail here rather
// than on the wire.
func TestBlocklistTargetRejectsAddressesWithoutABlocklist(t *testing.T) {
	for _, stored := range []string{
		"120363000000000001@g.us",
		"status@broadcast",
		"120363000000000002@newsletter",
	} {
		_, err := blocklistTargetJID(stored)
		require.Error(t, err, stored)
		assert.Contains(t, err.Error(), "not an individual contact")
	}

	// ParseJID accepts a bare server, so an address with nothing in front of the
	// @ - or no @ at all - arrives here as a JID with an empty user rather than
	// as a parse error.
	for _, stored := range []string{"s.whatsapp.net", "@s.whatsapp.net", ""} {
		_, err := blocklistTargetJID(stored)
		require.Error(t, err, stored)
		assert.Contains(t, err.Error(), "no user part")
	}
}

// UpdateBlocklist dereferences Store.LIDs without a nil check, so the cases that
// reach it have to be known: every phone number, and a block of a LID (which
// needs the reverse mapping for the `pn_jid` attribute). Only unblocking a LID
// needs no lookup.
func TestBlocklistLIDStoreRequirementMatchesUpstream(t *testing.T) {
	pn := waTypes.JID{User: "15550000001", Server: waTypes.DefaultUserServer}
	lid := lidJID("111111")

	assert.True(t, blocklistNeedsLIDStore(pn, events.BlocklistChangeActionBlock))
	assert.True(t, blocklistNeedsLIDStore(pn, events.BlocklistChangeActionUnblock))
	assert.True(t, blocklistNeedsLIDStore(lid, events.BlocklistChangeActionBlock))
	assert.False(t, blocklistNeedsLIDStore(lid, events.BlocklistChangeActionUnblock))
}

// The guard has to fail the command rather than panic inside the NATS command
// goroutine, and it has to do so before anything is sent.
func TestUpdateBlocklistFailsClosedWithoutALIDStore(t *testing.T) {
	c := &Client{client: whatsmeow.NewClient(&waStore.Device{}, nil)}
	require.Nil(t, c.client.Store.LIDs, "the guard is only meaningful while the store is unset")

	for _, action := range []string{"block", "unblock"} {
		err := c.updateBlocklistWithRetry(context.Background(), "15550000001@s.whatsapp.net", action)
		require.Error(t, err, action)
		assert.Contains(t, err.Error(), "no LID store available")
	}

	// Unblocking a LID needs no lookup, so the guard must not stand in its way.
	// Without a connection it fails further along instead.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := c.updateBlocklistWithRetry(ctx, "111111@lid", "unblock")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "no LID store available")
}

// An unroutable action must never be turned into a blocklist stanza.
func TestUpdateBlocklistRejectsUnknownAction(t *testing.T) {
	c := &Client{client: whatsmeow.NewClient(&waStore.Device{}, nil)}
	err := c.updateBlocklistWithRetry(context.Background(), "15550000001@s.whatsapp.net", "mute")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown blocklist action")
}

// A malformed or unblockable address is rejected before the action is even
// dispatched, for both directions.
func TestUpdateBlocklistRejectsUnblockableAddressesForBothActions(t *testing.T) {
	c := &Client{client: whatsmeow.NewClient(&waStore.Device{}, nil)}
	for _, stored := range []string{
		"120363000000000001@g.us",
		"222222@" + waTypes.HostedLIDServer,
	} {
		for _, action := range []string{"block", "unblock"} {
			err := c.updateBlocklistWithRetry(context.Background(), stored, action)
			require.Error(t, err, "%s %s", action, stored)
			assert.Contains(t, err.Error(), "not an individual contact")
		}
	}
}
