package client

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	waTypes "go.mau.fi/whatsmeow/types"
)

// The blocklist is addressed by link-ID. The whatsmeow module this service
// builds against predates upstream 8d023aa ("user: switch UpdateBlocklist to use
// LIDs") and sends its argument verbatim, so these tests pin the resolution the
// compatibility shim has to perform before UpdateBlocklist is called.

// cachedLIDs stands in for Store.LIDs.GetLIDForPN. Like the real store it
// reports a miss as an empty JID with no error, and it records what it was asked
// so the tests can assert the device suffix never reaches it.
type cachedLIDs struct {
	mapping map[string]waTypes.JID
	asked   []waTypes.JID
}

func (c *cachedLIDs) lookup(_ context.Context, pn waTypes.JID) (waTypes.JID, error) {
	c.asked = append(c.asked, pn)
	return c.mapping[pn.User], nil
}

// serverLIDs stands in for Client.GetUserInfo, which upstream uses to fill the
// cache when the mapping is not known locally.
type serverLIDs struct {
	mapping map[string]waTypes.JID
	err     error
	calls   int
}

func (s *serverLIDs) lookup(_ context.Context, jids []waTypes.JID) (map[waTypes.JID]waTypes.UserInfo, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	info := make(map[waTypes.JID]waTypes.UserInfo, len(jids))
	for _, jid := range jids {
		if lid, ok := s.mapping[jid.User]; ok {
			info[jid] = waTypes.UserInfo{LID: lid}
		}
	}
	return info, nil
}

func neverCalledUserInfo(t *testing.T) userInfoLookup {
	return func(context.Context, []waTypes.JID) (map[waTypes.JID]waTypes.UserInfo, error) {
		t.Helper()
		t.Fatal("GetUserInfo must not be called when the mapping is already cached")
		return nil, nil
	}
}

// The reported failure: a contact row holds the phone-number JID (which is what
// handler.resolvePreferredJID normally stores), that JID went out as
// `<item jid="...@s.whatsapp.net" action="unblock">`, and WhatsApp answered
// `400 bad-request`. The cached mapping has to be applied first.
func TestUnblockTargetResolvesPhoneNumberToLidFromCache(t *testing.T) {
	cache := &cachedLIDs{mapping: map[string]waTypes.JID{"15550000001": lidJID("111111")}}

	target, err := unblockTargetJID(context.Background(), "15550000001@s.whatsapp.net",
		cache.lookup, neverCalledUserInfo(t))

	require.NoError(t, err)
	assert.Equal(t, "111111@lid", target.String())
	assert.Equal(t, waTypes.HiddenUserServer, target.Server)
}

// Upstream falls back to a usync query when nothing is cached; GetUserInfo both
// answers and persists the mapping for next time.
func TestUnblockTargetFallsBackToServerOnCacheMiss(t *testing.T) {
	cache := &cachedLIDs{}
	server := &serverLIDs{mapping: map[string]waTypes.JID{"15550000001": lidJID("111111")}}

	target, err := unblockTargetJID(context.Background(), "15550000001@s.whatsapp.net",
		cache.lookup, server.lookup)

	require.NoError(t, err)
	assert.Equal(t, "111111@lid", target.String())
	assert.Equal(t, 1, server.calls)
}

// Every way the resolution can come up short must return before any info query
// is sent, so the failure names a cause instead of another opaque 400.
func TestUnblockTargetFailsClosedWhenNoLidCanBeFound(t *testing.T) {
	pn := "15550000001@s.whatsapp.net"

	t.Run("cache read fails", func(t *testing.T) {
		_, err := unblockTargetJID(context.Background(), pn,
			func(context.Context, waTypes.JID) (waTypes.JID, error) {
				return waTypes.EmptyJID, errors.New("store unavailable")
			},
			neverCalledUserInfo(t))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get LID for PN")
	})

	t.Run("server query fails", func(t *testing.T) {
		server := &serverLIDs{err: errors.New("usync timeout")}
		_, err := unblockTargetJID(context.Background(), pn, (&cachedLIDs{}).lookup, server.lookup)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "fill LID cache")
	})

	t.Run("server knows no LID", func(t *testing.T) {
		server := &serverLIDs{mapping: map[string]waTypes.JID{}}
		_, err := unblockTargetJID(context.Background(), pn, (&cachedLIDs{}).lookup, server.lookup)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no LID found")
	})

	t.Run("no stores wired", func(t *testing.T) {
		_, err := unblockTargetJID(context.Background(), pn, nil, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no LID store available")

		_, err = unblockTargetJID(context.Background(), pn, (&cachedLIDs{}).lookup, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no way to ask the server")
	})
}

// A mapping can exist and still be unusable. JID.IsEmpty only tests the server,
// so a row with an empty user - or a phone number stored in the LID column -
// passes every earlier check and would be sent as a stanza the server rejects
// for a reason nothing in the logs would explain.
func TestUnblockTargetRejectsUnusableLidMappings(t *testing.T) {
	pn := "15550000001@s.whatsapp.net"

	unusable := map[string]waTypes.JID{
		"empty user with a lid server": {Server: waTypes.HiddenUserServer},
		"a phone number in the LID column": {
			User: "15550000001", Server: waTypes.DefaultUserServer,
		},
		"a group address": {User: "120363000000000001", Server: waTypes.GroupServer},
	}

	for name, mapped := range unusable {
		t.Run("cached: "+name, func(t *testing.T) {
			cache := &cachedLIDs{mapping: map[string]waTypes.JID{"15550000001": mapped}}
			_, err := unblockTargetJID(context.Background(), pn, cache.lookup, neverCalledUserInfo(t))
			require.Error(t, err)
			assert.Contains(t, err.Error(), "not a usable link-ID address")
		})

		t.Run("from server: "+name, func(t *testing.T) {
			server := &serverLIDs{mapping: map[string]waTypes.JID{"15550000001": mapped}}
			_, err := unblockTargetJID(context.Background(), pn, (&cachedLIDs{}).lookup, server.lookup)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "not a usable link-ID address")
		})
	}
}

// A row that already holds a link-ID is already addressed the way the blocklist
// wants; nothing should be looked up or rewritten.
func TestUnblockTargetPassesLidsThrough(t *testing.T) {
	for _, stored := range []string{"111111@lid", "222222@" + waTypes.HostedLIDServer} {
		t.Run(stored, func(t *testing.T) {
			target, err := unblockTargetJID(context.Background(), stored,
				func(context.Context, waTypes.JID) (waTypes.JID, error) {
					t.Fatal("a LID needs no phone-number lookup")
					return waTypes.EmptyJID, nil
				},
				neverCalledUserInfo(t))
			require.NoError(t, err)
			assert.Equal(t, stored, target.String())
		})
	}
}

// A blocklist entry names a person, not one of their devices, and the LID
// mappings are stored per identity - so the device suffix has to be gone before
// the lookup, not just before the info query.
func TestUnblockTargetNormalizesDeviceAndAgent(t *testing.T) {
	cache := &cachedLIDs{mapping: map[string]waTypes.JID{"15550000001": lidJID("111111")}}

	target, err := unblockTargetJID(context.Background(), "15550000001:12@s.whatsapp.net",
		cache.lookup, neverCalledUserInfo(t))

	require.NoError(t, err)
	assert.Equal(t, "111111@lid", target.String())
	require.Len(t, cache.asked, 1)
	assert.Equal(t, "15550000001@s.whatsapp.net", cache.asked[0].String(),
		"the mapping is keyed by identity, so the device suffix must be stripped first")

	// A device-qualified mapping collapses to its identity too.
	cache = &cachedLIDs{mapping: map[string]waTypes.JID{
		"15550000001": {User: "111111", Device: 5, Server: waTypes.HiddenUserServer},
	}}
	target, err = unblockTargetJID(context.Background(), "15550000001@s.whatsapp.net",
		cache.lookup, neverCalledUserInfo(t))
	require.NoError(t, err)
	assert.Equal(t, "111111@lid", target.String())
	assert.Zero(t, target.Device)

	// As does a device-qualified LID supplied directly.
	target, err = unblockTargetJID(context.Background(), "111111:5@lid", nil, nil)
	require.NoError(t, err)
	assert.Equal(t, "111111@lid", target.String())
	assert.Zero(t, target.Device)
	assert.Zero(t, target.RawAgent)
}

// Nothing else has a blocklist. The API already refuses groups, but a command
// queued before that check must fail here rather than on the wire.
func TestUnblockTargetRejectsAddressesWithoutABlocklist(t *testing.T) {
	for _, stored := range []string{
		"120363000000000001@g.us",
		"status@broadcast",
		"120363000000000002@newsletter",
	} {
		_, err := unblockTargetJID(context.Background(), stored, nil, nil)
		require.Error(t, err, stored)
		assert.Contains(t, err.Error(), "not an individual contact")
	}

	_, err := unblockTargetJID(context.Background(), "s.whatsapp.net", nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no user part")
}
