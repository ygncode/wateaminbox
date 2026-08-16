package client

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	waTypes "go.mau.fi/whatsmeow/types"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

func userJID(user string) waTypes.JID {
	return waTypes.JID{User: user, Server: waTypes.DefaultUserServer}
}

func lidJID(user string) waTypes.JID {
	return waTypes.JID{User: user, Server: waTypes.HiddenUserServer}
}

func hostedLidJID(user string) waTypes.JID {
	return waTypes.JID{User: user, Server: waTypes.HostedLIDServer}
}

// A group can be addressed by LID or by phone number, and whatsmeow reports
// whichever the group uses. The workspace resolves membership - and therefore
// admin rights - by phone JID, so every path that builds a snapshot has to
// agree on that form. Two paths storing two different addresses for the same
// person would make them delete and reinsert each other's rows forever, and
// would lock the connected account out of its own admin rights.
func TestSnapshotAlwaysAddressesMembersByPhoneNumber(t *testing.T) {
	info := &waTypes.GroupInfo{
		JID: waTypes.JID{User: "120363000000000001", Server: waTypes.GroupServer},
		// The group is LID-addressed: `JID` carries the LID for every member.
		Participants: []waTypes.GroupParticipant{
			{JID: lidJID("111111"), PhoneNumber: userJID("15550000001"), IsAdmin: true},
			{JID: lidJID("222222"), PhoneNumber: userJID("15550000002")},
			// A member WhatsApp only knows by phone number.
			{JID: userJID("15550000003"), PhoneNumber: userJID("15550000003")},
		},
		OwnerJID: lidJID("111111"),
		OwnerPN:  userJID("15550000001"),
	}

	t.Run("without a resolver", func(t *testing.T) {
		snapshot := snapshotFromGroupInfo(info, nil)
		assert.Equal(t, []string{
			"15550000001@s.whatsapp.net",
			"15550000002@s.whatsapp.net",
			"15550000003@s.whatsapp.net",
		}, participantJIDsOf(snapshot))
		assert.Equal(t, "15550000001@s.whatsapp.net", snapshot.OwnerJID)
	})

	t.Run("with a resolver", func(t *testing.T) {
		// A resolver that insists on the LID must not be able to reintroduce it.
		snapshot := snapshotFromGroupInfo(info, func(primary, _ waTypes.JID) waTypes.JID {
			if primary.User == "15550000001" {
				return lidJID("111111")
			}
			return primary
		})
		assert.Equal(t, []string{
			"15550000001@s.whatsapp.net",
			"15550000002@s.whatsapp.net",
			"15550000003@s.whatsapp.net",
		}, participantJIDsOf(snapshot))
	})

	t.Run("command and event paths agree", func(t *testing.T) {
		// The command path passes no resolver; the connection path passes one.
		// They must produce byte-identical membership.
		fromCommand := snapshotFromGroupInfo(info, nil)
		fromEvent := SnapshotFromGroupInfo(info, func(primary, _ waTypes.JID) waTypes.JID {
			return primary
		})
		assert.Equal(t, participantJIDsOf(fromCommand), participantJIDsOf(fromEvent))
		assert.Equal(t, fromCommand.OwnerJID, fromEvent.OwnerJID)
	})
}

// A LID-only member has no phone number to fall back to, so the LID is the only
// address there is and must be kept rather than dropped.
func TestSnapshotKeepsLidWhenNoPhoneNumberIsKnown(t *testing.T) {
	snapshot := snapshotFromGroupInfo(&waTypes.GroupInfo{
		JID: waTypes.JID{User: "120363000000000002", Server: waTypes.GroupServer},
		Participants: []waTypes.GroupParticipant{
			{JID: lidJID("999999"), IsAdmin: true},
		},
	}, nil)

	require.Len(t, snapshot.Participants, 1)
	assert.Equal(t, "999999@lid", snapshot.Participants[0].JID)
	assert.True(t, snapshot.Participants[0].IsAdmin)
}

func TestSnapshotOwnerFallsBackToTheOnlyKnownAddress(t *testing.T) {
	snapshot := snapshotFromGroupInfo(&waTypes.GroupInfo{
		JID:      waTypes.JID{User: "120363000000000003", Server: waTypes.GroupServer},
		OwnerJID: lidJID("777777"),
	}, nil)
	assert.Equal(t, "777777@lid", snapshot.OwnerJID)
}

func TestParseGroupJIDRejectsNonGroups(t *testing.T) {
	_, err := parseGroupJID("15550000001@s.whatsapp.net")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a group")

	group, err := parseGroupJID("120363000000000001@g.us")
	require.NoError(t, err)
	assert.Equal(t, "120363000000000001@g.us", group.String())
}

func participantJIDsOf(snapshot types.GroupSnapshot) []string {
	jids := make([]string, 0, len(snapshot.Participants))
	for _, participant := range snapshot.Participants {
		jids = append(jids, participant.JID)
	}
	return jids
}

// WhatsApp omits `phone_number` for anonymous members of announcement groups
// (whatsmeow collects those as RedactedPhoneEntry). `preferPhoneJID` alone
// cannot collapse them, so the command path must consult the stored LID mapping
// exactly like the event path does - otherwise the two paths write two different
// addresses for one member and delete each other's rows forever.
func TestSnapshotResolvesLidsWhenWhatsAppOmitsThePhoneNumber(t *testing.T) {
	info := &waTypes.GroupInfo{
		JID: waTypes.JID{User: "120363000000000004", Server: waTypes.GroupServer},
		Participants: []waTypes.GroupParticipant{
			// Redacted: WhatsApp gave us a LID and no phone number.
			{JID: lidJID("111111"), IsAdmin: true},
			{JID: hostedLidJID("222222")},
		},
		OwnerJID: lidJID("111111"),
	}

	// Stands in for Store.LIDs.GetPNForLID: the mapping exists even though this
	// particular response omitted it.
	mapping := map[string]string{"111111": "15550000001", "222222": "15550000002"}
	resolver := func(primary, phoneNumber waTypes.JID) waTypes.JID {
		collapsed := preferPhoneJID(primary, phoneNumber)
		if !isLIDServer(collapsed.Server) {
			return collapsed
		}
		if user, ok := mapping[collapsed.User]; ok {
			return userJID(user)
		}
		return collapsed
	}

	// Without a resolver the command path can only keep the LIDs.
	unresolved := snapshotFromGroupInfo(info, nil)
	assert.Equal(t,
		[]string{"111111@lid", "222222@" + waTypes.HostedLIDServer},
		participantJIDsOf(unresolved))

	// With one - which is what the client now always supplies - both paths agree.
	resolved := snapshotFromGroupInfo(info, resolver)
	assert.Equal(t, []string{
		"15550000001@s.whatsapp.net",
		"15550000002@s.whatsapp.net",
	}, participantJIDsOf(resolved))
	assert.Equal(t, "15550000001@s.whatsapp.net", resolved.OwnerJID)

	// The divergence this guards against: an event-path snapshot resolving the
	// mapping while a command-path snapshot does not would produce two different
	// membership sets for the same group.
	assert.NotEqual(t, participantJIDsOf(unresolved), participantJIDsOf(resolved),
		"if these ever match, the fixture no longer exercises the redacted-phone case")
}

// A hosted LID is the second address form WhatsApp uses; the handler's resolver
// has always treated it like an ordinary LID and the client must agree.
func TestHostedLidsAreCollapsedLikeOrdinaryLids(t *testing.T) {
	snapshot := snapshotFromGroupInfo(&waTypes.GroupInfo{
		JID: waTypes.JID{User: "120363000000000005", Server: waTypes.GroupServer},
		Participants: []waTypes.GroupParticipant{
			{JID: hostedLidJID("333333"), PhoneNumber: userJID("15550000003")},
		},
	}, nil)

	require.Len(t, snapshot.Participants, 1)
	assert.Equal(t, "15550000003@s.whatsapp.net", snapshot.Participants[0].JID)
	assert.True(t, isLIDServer(waTypes.HostedLIDServer))
	assert.True(t, isLIDServer(waTypes.HiddenUserServer))
	assert.False(t, isLIDServer(waTypes.DefaultUserServer))
}
