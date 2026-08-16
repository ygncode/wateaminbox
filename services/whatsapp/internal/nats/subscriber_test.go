package nats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

// mockMessageSender is a mock implementation of MessageSender for testing.
type mockMessageSender struct {
	sendMessageFunc      func(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error)
	sendMediaMessageFunc func(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error)
	sendReactionFunc     func(ctx context.Context, chatJID string, messageID string, emoji string, targetSenderJID string, fromMe bool) (types.SendResponse, error)
}

func (m *mockMessageSender) SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error) {
	if m.sendMessageFunc != nil {
		return m.sendMessageFunc(ctx, jid, text, replyTo, replyToSender)
	}
	return types.SendResponse{}, nil
}

func (m *mockMessageSender) SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error) {
	if m.sendMediaMessageFunc != nil {
		return m.sendMediaMessageFunc(ctx, jid, mediaType, data, caption, fileName, mimeType, replyTo, replyToSender)
	}
	return types.SendResponse{}, nil
}

func (m *mockMessageSender) SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, targetSenderJID string, fromMe bool) (types.SendResponse, error) {
	if m.sendReactionFunc != nil {
		return m.sendReactionFunc(ctx, chatJID, messageID, emoji, targetSenderJID, fromMe)
	}
	return types.SendResponse{}, nil
}

type mockCommandExecutor struct {
	groupAction  string
	groupJID     string
	participants []string
	createName   string
	createCalls  int
	// participantResults is WhatsApp's per-member verdict on the last request.
	participantResults []types.GroupParticipantResult
	settings           types.GroupSettingsUpdate
	inviteReset        bool
	leftJID            string
	requestDecision    string
	snapshotCalls      int
	statusType         string
	historyJID         string
	historyID          string
	historyFromMe      bool
	historyTimestamp   time.Time
	historyCount       int
	// err, when set, fails every group operation.
	err error
	// settingsErr fails ONLY the settings write, modelling WhatsApp applying
	// some settings and refusing others - reading the group back still works.
	settingsErr    error
	settingsCalls  int
	leaveCalls     int
	inviteCalls    int
	decisionCalls  int
	updateCalls    int
	joinFetchCalls int
}

func (m *mockCommandExecutor) PostStatus(_ context.Context, statusType, _, _ string) (types.SendResponse, error) {
	m.statusType = statusType
	return types.SendResponse{}, nil
}
func (m *mockCommandExecutor) CreateGroup(_ context.Context, name string, participantJIDs []string) (types.GroupSnapshot, error) {
	m.createCalls++
	m.createName, m.participants = name, participantJIDs
	if m.err != nil {
		return types.GroupSnapshot{}, m.err
	}
	return types.GroupSnapshot{JID: "created@g.us"}, nil
}
func (m *mockCommandExecutor) UpdateGroupParticipants(_ context.Context, groupJID string, participantJIDs []string, action string) ([]types.GroupParticipantResult, error) {
	m.updateCalls++
	m.groupJID, m.participants, m.groupAction = groupJID, participantJIDs, action
	if m.err != nil {
		return nil, m.err
	}
	return m.participantResults, nil
}
func (m *mockCommandExecutor) UpdateGroupSettings(_ context.Context, groupJID string, update types.GroupSettingsUpdate) error {
	m.settingsCalls++
	m.groupJID, m.settings = groupJID, update
	if m.settingsErr != nil {
		return m.settingsErr
	}
	return m.err
}
func (m *mockCommandExecutor) LeaveGroup(_ context.Context, groupJID string) error {
	m.leaveCalls++
	m.leftJID = groupJID
	return m.err
}
func (m *mockCommandExecutor) GetGroupInviteLink(_ context.Context, groupJID string, reset bool) (string, error) {
	m.inviteCalls++
	m.groupJID, m.inviteReset = groupJID, reset
	if m.err != nil {
		return "", m.err
	}
	// A reset mints a NEW link each time, which is exactly why re-running it is
	// destructive: any link handed out by an earlier attempt is already dead.
	return fmt.Sprintf("https://chat.whatsapp.com/CODE-%d", m.inviteCalls), nil
}
func (m *mockCommandExecutor) GetGroupJoinRequests(_ context.Context, groupJID string) ([]types.GroupJoinRequest, error) {
	m.joinFetchCalls++
	m.groupJID = groupJID
	if m.err != nil {
		return nil, m.err
	}
	return []types.GroupJoinRequest{{JID: "9@s.whatsapp.net"}}, nil
}
func (m *mockCommandExecutor) UpdateGroupJoinRequests(_ context.Context, groupJID string, participantJIDs []string, action string) ([]types.GroupParticipantResult, error) {
	m.decisionCalls++
	m.groupJID, m.participants, m.requestDecision = groupJID, participantJIDs, action
	if m.err != nil {
		return nil, m.err
	}
	// WhatsApp answers a second decision on an already-decided request with a
	// per-participant error, which is what makes a naive retry look like a
	// failure of an approval that already landed.
	if m.decisionCalls > 1 {
		return []types.GroupParticipantResult{
			{JID: "9@s.whatsapp.net", Code: 409, Applied: false},
		}, nil
	}
	return m.participantResults, nil
}
func (m *mockCommandExecutor) GetGroupSnapshot(_ context.Context, groupJID string) (types.GroupSnapshot, error) {
	m.snapshotCalls++
	if m.err != nil {
		return types.GroupSnapshot{}, m.err
	}
	return types.GroupSnapshot{JID: groupJID}, nil
}
func (m *mockCommandExecutor) SyncLabels(context.Context) ([]types.WhatsAppLabel, error) {
	return nil, nil
}
func (m *mockCommandExecutor) ApplyLabel(context.Context, string, string, bool) error {
	return nil
}
func (m *mockCommandExecutor) SyncCatalog(context.Context, string) (types.Catalog, error) {
	return types.Catalog{}, nil
}
func (m *mockCommandExecutor) RequestHistory(_ context.Context, jid, id string, fromMe bool, timestamp time.Time, count int) error {
	m.historyJID = jid
	m.historyID = id
	m.historyFromMe = fromMe
	m.historyTimestamp = timestamp
	m.historyCount = count
	return nil
}

// mockGroupPublisher records the group events a command produced. Only the
// group methods carry behaviour; the rest satisfy CommandEventPublisher.
type mockGroupPublisher struct {
	snapshots    []types.GroupSnapshot
	actions      []string
	left         []string
	inviteLinks  []string
	joinRequests [][]types.GroupJoinRequest
	commandIDs   []string
	results      []string
	errors       []string
	// failSnapshot simulates the event transport being down at the exact moment
	// a command's outcome has to be reported.
	failSnapshot     bool
	snapshotAttempts int
	// failInviteLink simulates the transport dropping an invite-link result.
	failInviteLink bool
	// failCommandResult simulates the transport dropping the terminal outcome.
	failCommandResult bool
	resultAttempts    int
	outcomes          []string
}

func (m *mockGroupPublisher) PublishGroupSnapshot(commandID, action string, snapshot types.GroupSnapshot) error {
	m.snapshotAttempts++
	if m.failSnapshot {
		return errors.New("event transport unavailable")
	}
	m.commandIDs = append(m.commandIDs, commandID)
	m.actions = append(m.actions, action)
	m.snapshots = append(m.snapshots, snapshot)
	return nil
}
func (m *mockGroupPublisher) PublishGroupLeft(_, groupJID string) error {
	m.left = append(m.left, groupJID)
	return nil
}
func (m *mockGroupPublisher) PublishGroupInviteLink(_, _, inviteLink string) error {
	if m.failInviteLink {
		return errors.New("event transport unavailable")
	}
	m.inviteLinks = append(m.inviteLinks, inviteLink)
	return nil
}
func (m *mockGroupPublisher) PublishGroupJoinRequests(_, _ string, requests []types.GroupJoinRequest) error {
	m.joinRequests = append(m.joinRequests, requests)
	return nil
}
func (m *mockGroupPublisher) PublishSendConfirmation(string, string, time.Time, string) error {
	return nil
}
func (m *mockGroupPublisher) PublishSendFailed(string, string, string) error { return nil }
func (m *mockGroupPublisher) PublishCommandResult(_, commandType string, success bool, outcome, detail string) error {
	m.resultAttempts++
	if m.failCommandResult {
		return errors.New("result transport unavailable")
	}
	if !success {
		m.results = append(m.results, commandType)
		m.outcomes = append(m.outcomes, outcome)
		m.errors = append(m.errors, detail)
	}
	return nil
}
func (m *mockGroupPublisher) PublishProfilePicture(string, string, bool, time.Time) error {
	return nil
}
func (m *mockGroupPublisher) PublishLabels([]types.WhatsAppLabel) error { return nil }
func (m *mockGroupPublisher) PublishCatalog(types.Catalog) error        { return nil }

func newGroupSubscriber() (*Subscriber, *mockCommandExecutor, *mockGroupPublisher) {
	executor := &mockCommandExecutor{}
	publisher := &mockGroupPublisher{}
	return &Subscriber{ctx: context.Background(), executor: executor, publisher: publisher}, executor, publisher
}

func TestCommandHandlersInvokeExecutor(t *testing.T) {
	subscriber, executor, publisher := newGroupSubscriber()

	subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(`{"type":"group_promote_admin","group_jid":"1@g.us","participant_jid":"2@s.whatsapp.net"}`)}, "group_promote_admin")
	assert.Equal(t, "promote", executor.groupAction)
	assert.Equal(t, "1@g.us", executor.groupJID)
	assert.Equal(t, []string{"2@s.whatsapp.net"}, executor.participants)
	// The participant list the API sees must come from WhatsApp, never from the
	// command, so every participant change re-reads the group.
	assert.Equal(t, []string{"snapshot"}, publisher.actions)

	subscriber.handlePostStatusCommand(&natsgo.Msg{Data: []byte(`{"type":"post_status","status_type":"text","content":"hello"}`)})
	assert.Equal(t, "text", executor.statusType)

	subscriber.handleRequestHistoryCommand(&natsgo.Msg{Data: []byte(
		`{"type":"request_history","chat_jid":"1@s.whatsapp.net","oldest_message_id":"ABC","oldest_from_me":true,"oldest_timestamp":"2026-01-02T03:04:05Z","count":50}`,
	)})
	assert.Equal(t, "1@s.whatsapp.net", executor.historyJID)
	assert.Equal(t, "ABC", executor.historyID)
	assert.True(t, executor.historyFromMe)
	assert.Equal(t, 50, executor.historyCount)
	assert.Equal(t, time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), executor.historyTimestamp)
}

func TestGroupCommandsPublishWhatsAppConfirmedState(t *testing.T) {
	t.Run("create publishes the created group", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_create","name":"Launch","participant_jids":["2@s.whatsapp.net","3@s.whatsapp.net"]}`,
		)}, "group_create")
		assert.Equal(t, "Launch", executor.createName)
		assert.Equal(t, []string{"2@s.whatsapp.net", "3@s.whatsapp.net"}, executor.participants)
		require.Equal(t, []string{"created"}, publisher.actions)
		assert.Equal(t, "created@g.us", publisher.snapshots[0].JID)
	})

	t.Run("bulk add re-reads the group", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_add_participants","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net","3@s.whatsapp.net"]}`,
		)}, "group_add_participants")
		assert.Equal(t, "add", executor.groupAction)
		assert.Len(t, executor.participants, 2)
		assert.Equal(t, 1, executor.snapshotCalls)
		assert.Equal(t, []string{"snapshot"}, publisher.actions)
	})

	t.Run("settings carry every permission flag", func(t *testing.T) {
		subscriber, executor, _ := newGroupSubscriber()
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_update_settings","group_jid":"1@g.us","name":"Ops","description":"team","is_announce":true,"is_locked":false,"is_join_approval_required":true,"member_add_mode":"admin_add"}`,
		)}, "group_update_settings")
		require.NotNil(t, executor.settings.Name)
		assert.Equal(t, "Ops", *executor.settings.Name)
		require.NotNil(t, executor.settings.Description)
		assert.Equal(t, "team", *executor.settings.Description)
		require.NotNil(t, executor.settings.IsAnnounce)
		assert.True(t, *executor.settings.IsAnnounce)
		require.NotNil(t, executor.settings.IsLocked)
		assert.False(t, *executor.settings.IsLocked)
		require.NotNil(t, executor.settings.IsJoinApprovalRequired)
		assert.True(t, *executor.settings.IsJoinApprovalRequired)
		require.NotNil(t, executor.settings.MemberAddMode)
		assert.Equal(t, "admin_add", *executor.settings.MemberAddMode)
	})

	t.Run("leave reports a membership end, not a deletion", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_leave","group_jid":"1@g.us"}`,
		)}, "group_leave")
		assert.Equal(t, "1@g.us", executor.leftJID)
		assert.Equal(t, []string{"1@g.us"}, publisher.left)
		// Leaving must never emit a snapshot claiming the group is gone.
		assert.Empty(t, publisher.actions)
	})

	t.Run("invite link reset is forwarded", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_invite_link","group_jid":"1@g.us","reset":true}`,
		)}, "group_invite_link")
		assert.True(t, executor.inviteReset)
		assert.Equal(t, []string{"https://chat.whatsapp.com/CODE-1"}, publisher.inviteLinks)
	})

	t.Run("approving a join request refreshes requests and members", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_join_requests_update","group_jid":"1@g.us","participant_jids":["9@s.whatsapp.net"],"decision":"approve"}`,
		)}, "group_join_requests_update")
		assert.Equal(t, "approve", executor.requestDecision)
		assert.Len(t, publisher.joinRequests, 1)
		assert.Equal(t, []string{"snapshot"}, publisher.actions)
	})
}

func TestGroupCommandFailurePublishesNoGroupState(t *testing.T) {
	cases := []struct {
		name    string
		payload string
	}{
		{"remove", `{"type":"group_remove_participants","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"]}`},
		{"settings", `{"type":"group_update_settings","group_jid":"1@g.us","name":"Ops"}`},
		{"leave", `{"type":"group_leave","group_jid":"1@g.us"}`},
		{"invite link", `{"type":"group_invite_link","group_jid":"1@g.us"}`},
		{"create", `{"type":"group_create","name":"Launch","participant_jids":["2@s.whatsapp.net"]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			subscriber, executor, publisher := newGroupSubscriber()
			executor.err = errors.New("not authorized")

			var ct commandType
			require.NoError(t, json.Unmarshal([]byte(tc.payload), &ct))
			subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(tc.payload)}, ct.Type)

			// A command WhatsApp rejected must leave the workspace showing the
			// state it had before, so nothing may be published.
			assert.Empty(t, publisher.snapshots)
			assert.Empty(t, publisher.left)
			assert.Empty(t, publisher.inviteLinks)
			assert.Empty(t, publisher.joinRequests)
		})
	}
}

// Creating a group is the one group operation that cannot be repeated: running
// it twice leaves the workspace with two groups. These pin the ledger guard.
func TestGroupCreateIsExecutedAtMostOncePerCommand(t *testing.T) {
	const payload = `{"type":"group_create","name":"Launch","participant_jids":["2@s.whatsapp.net"],"command_id":"cmd-create-1"}`

	t.Run("redelivery replays the stored group instead of creating another", func(t *testing.T) {
		executor := &mockCommandExecutor{}
		publisher := &mockGroupPublisher{}
		ledger := &memoryCommandLedger{results: make(map[string][]byte)}
		subscriber := &Subscriber{
			ctx: context.Background(), executor: executor, publisher: publisher, ledger: ledger,
		}

		for range 3 {
			subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(payload)}, "group_create")
		}

		assert.Equal(t, 1, executor.createCalls, "WhatsApp must be asked for exactly one group")
		// Once the outcome has been delivered the ledger records that, so later
		// deliveries are acknowledged rather than republished - the API must not
		// receive the same group creation three times.
		require.Equal(t, []string{"created"}, publisher.actions)
		assert.Equal(t, "created@g.us", publisher.snapshots[0].JID)
	})

	t.Run("a failed publish still prevents a second group", func(t *testing.T) {
		executor := &mockCommandExecutor{}
		publisher := &mockGroupPublisher{failSnapshot: true}
		ledger := &memoryCommandLedger{results: make(map[string][]byte)}
		subscriber := &Subscriber{
			ctx: context.Background(), executor: executor, publisher: publisher, ledger: ledger,
		}

		// First delivery: the group is created but its event never lands.
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(payload)}, "group_create")
		assert.Equal(t, 1, executor.createCalls)
		assert.Empty(t, publisher.actions)

		// Transport recovers; the redelivery must replay, not re-create.
		publisher.failSnapshot = false
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(payload)}, "group_create")
		assert.Equal(t, 1, executor.createCalls, "the group must not be created twice")
		require.Equal(t, []string{"created"}, publisher.actions)
		assert.Equal(t, "created@g.us", publisher.snapshots[0].JID)
	})

	t.Run("a failed creation records nothing and stays retryable", func(t *testing.T) {
		executor := &mockCommandExecutor{err: errors.New("not authorized")}
		publisher := &mockGroupPublisher{}
		ledger := &memoryCommandLedger{results: make(map[string][]byte)}
		subscriber := &Subscriber{
			ctx: context.Background(), executor: executor, publisher: publisher, ledger: ledger,
		}

		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(payload)}, "group_create")

		assert.Equal(t, 0, ledger.saves, "a group that was never created must not be recorded as created")
		assert.Empty(t, publisher.snapshots)
	})
}

// WhatsApp answers a participant update member by member. A batch it refused
// entirely produces no visible change, so it has to be reported rather than
// acknowledged as a success the user then cannot find.
func TestWhollyRejectedParticipantBatchIsReportedAsAFailure(t *testing.T) {
	t.Run("nothing applied is reported to the API", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		executor.participantResults = []types.GroupParticipantResult{
			{JID: "2@s.whatsapp.net", Code: 403, Applied: false},
			{JID: "3@s.whatsapp.net", Code: 408, Applied: false},
		}

		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_add_participants","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net","3@s.whatsapp.net"],"command_id":"cmd-add-1"}`,
		)}, "group_add_participants")

		// The group's real state is still published - it is simply unchanged.
		assert.Equal(t, []string{"snapshot"}, publisher.actions)
		require.Len(t, publisher.results, 1)
		assert.Equal(t, "group_add_participants", publisher.results[0])
	})

	t.Run("a partially applied batch is a success", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		executor.participantResults = []types.GroupParticipantResult{
			{JID: "2@s.whatsapp.net", Code: 0, Applied: true},
			{JID: "3@s.whatsapp.net", Code: 403, Applied: false},
		}

		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_add_participants","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net","3@s.whatsapp.net"]}`,
		)}, "group_add_participants")

		// The snapshot shows exactly who is in the group, so the partial
		// outcome is already visible without an error toast.
		assert.Equal(t, []string{"snapshot"}, publisher.actions)
		assert.Empty(t, publisher.results)
	})

	t.Run("a silent response is not treated as a rejection", func(t *testing.T) {
		subscriber, executor, publisher := newGroupSubscriber()
		executor.participantResults = nil

		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_promote_admin","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"]}`,
		)}, "group_promote_admin")

		assert.Equal(t, []string{"snapshot"}, publisher.actions)
		assert.Empty(t, publisher.results)
	})
}

func TestGroupSnapshotIsNotPublishedWhenTheRefreshFails(t *testing.T) {
	// The participant change itself succeeded, but reading the group back did
	// not. Publishing anything here would guess at the new member list.
	subscriber, executor, publisher := newGroupSubscriber()
	executor.err = errors.New("timeout")

	subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
		`{"type":"group_demote_admin","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"]}`,
	)}, "group_demote_admin")

	assert.Empty(t, publisher.snapshots)
}

// TestSendMessageCommand_AllTypes tests that all message types are recognized.
func TestSendMessageCommand_AllTypes(t *testing.T) {
	validTypes := []string{"text", "image", "video", "audio", "document", "sticker"}

	for _, msgType := range validTypes {
		t.Run(msgType, func(t *testing.T) {
			cmd := SendMessageCommand{
				MessageID: "pending_test_001",
				To:        "1234567890@s.whatsapp.net",
				Type:      msgType,
			}

			// Marshal and unmarshal to verify structure
			data, err := json.Marshal(cmd)
			require.NoError(t, err, "should marshal successfully")

			var unmarshaled SendMessageCommand
			err = json.Unmarshal(data, &unmarshaled)
			require.NoError(t, err, "should unmarshal successfully")

			assert.Equal(t, msgType, unmarshaled.Type)
			assert.Equal(t, "pending_test_001", unmarshaled.MessageID)
			assert.Equal(t, "1234567890@s.whatsapp.net", unmarshaled.To)
		})
	}
}

// TestSendMessageCommand_InvalidType tests that invalid types are handled.
func TestSendMessageCommand_InvalidType(t *testing.T) {
	cmd := SendMessageCommand{
		MessageID: "pending_test_001",
		To:        "1234567890@s.whatsapp.net",
		Type:      "unknown_type",
	}

	// Marshal and unmarshal
	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var unmarshaled SendMessageCommand
	err = json.Unmarshal(data, &unmarshaled)
	require.NoError(t, err)

	assert.Equal(t, "unknown_type", unmarshaled.Type)
}

// TestSendMessageCommand_WithReply tests that reply fields are preserved.
func TestSendMessageCommand_WithReply(t *testing.T) {
	cmd := SendMessageCommand{
		MessageID:     "pending_reply_001",
		To:            "1234567890@s.whatsapp.net",
		Type:          "text",
		Content:       "This is a reply",
		ReplyTo:       "3EB0ORIGINAL123@s.whatsapp.net",
		ReplyToSender: "9876543210@s.whatsapp.net",
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var unmarshaled SendMessageCommand
	err = json.Unmarshal(data, &unmarshaled)
	require.NoError(t, err)

	assert.Equal(t, "3EB0ORIGINAL123@s.whatsapp.net", unmarshaled.ReplyTo)
	assert.Equal(t, "9876543210@s.whatsapp.net", unmarshaled.ReplyToSender)
}

// TestSendMessageCommand_WithMedia tests media message fields.
func TestSendMessageCommand_WithMedia(t *testing.T) {
	cmd := SendMessageCommand{
		MessageID:      "pending_media_001",
		To:             "1234567890@s.whatsapp.net",
		Type:           "image",
		MediaObjectKey: "media/company-1/test.jpg",
		MediaSize:      1024,
		MediaChecksum:  "abc123",
		Caption:        "Test image",
		FileName:       "test.jpg",
		MimeType:       "image/jpeg",
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var unmarshaled SendMessageCommand
	err = json.Unmarshal(data, &unmarshaled)
	require.NoError(t, err)

	assert.Equal(t, "image", unmarshaled.Type)
	assert.Equal(t, "media/company-1/test.jpg", unmarshaled.MediaObjectKey)
	assert.Equal(t, int64(1024), unmarshaled.MediaSize)
	assert.Equal(t, "abc123", unmarshaled.MediaChecksum)
	assert.Equal(t, "Test image", unmarshaled.Caption)
	assert.Equal(t, "test.jpg", unmarshaled.FileName)
	assert.Equal(t, "image/jpeg", unmarshaled.MimeType)
}

func TestMediaCommandPayloadStaysBelowDefaultNATSLimit(t *testing.T) {
	cmd := SendMessageCommand{
		MessageID:      "pending-realistic-document",
		To:             "123@s.whatsapp.net",
		Type:           "document",
		MediaObjectKey: "media/company-1/large.pdf",
		MediaSize:      maxSendMediaBytes,
		MediaChecksum:  "0123456789abcdef",
		FileName:       "large.pdf",
		MimeType:       "application/pdf",
	}
	data, err := json.Marshal(cmd)
	require.NoError(t, err)
	assert.Less(t, len(data), 1024)
	assert.NotContains(t, string(data), "media_data")
}

// TestSendResponse_Structure tests the SendResponse structure.
func TestSendResponse_Structure(t *testing.T) {
	resp := types.SendResponse{
		ID:        "3EB0TEST123@s.whatsapp.net",
		Timestamp: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC),
	}

	assert.Equal(t, "3EB0TEST123@s.whatsapp.net", resp.ID)
	assert.False(t, resp.Timestamp.IsZero())
}

// TestMessageSender_InterfaceImplementation tests that mockMessageSender implements the interface.
func TestMessageSender_InterfaceImplementation(t *testing.T) {
	// This test verifies that mockMessageSender correctly implements MessageSender
	var sender MessageSender = &mockMessageSender{}

	ctx := context.Background()

	// Should not panic - verifies the interface is correctly implemented
	assert.NotPanics(t, func() {
		sender.SendMessage(ctx, "jid", "text", "", "")
		sender.SendMediaMessage(ctx, "jid", "image", []byte("data"), "caption", "file.jpg", "image/jpeg", "", "")
	})
}

// TestMessageSender_SendMessage_Success tests successful message sending.
func TestMessageSender_SendMessage_Success(t *testing.T) {
	expectedResp := types.SendResponse{
		ID:        "3EB0TEST456@s.whatsapp.net",
		Timestamp: time.Date(2026, 1, 5, 12, 30, 0, 0, time.UTC),
	}

	mockSender := &mockMessageSender{
		sendMessageFunc: func(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error) {
			assert.Equal(t, "1234567890@s.whatsapp.net", jid)
			assert.Equal(t, "Hello, World!", text)
			return expectedResp, nil
		},
	}

	ctx := context.Background()
	resp, err := mockSender.SendMessage(ctx, "1234567890@s.whatsapp.net", "Hello, World!", "", "")

	assert.NoError(t, err)
	assert.Equal(t, expectedResp.ID, resp.ID)
	assert.Equal(t, expectedResp.Timestamp, resp.Timestamp)
}

// TestMessageSender_SendMessage_Error tests error handling.
func TestMessageSender_SendMessage_Error(t *testing.T) {
	mockSender := &mockMessageSender{
		sendMessageFunc: func(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error) {
			return types.SendResponse{}, errors.New("connection failed")
		},
	}

	ctx := context.Background()
	resp, err := mockSender.SendMessage(ctx, "1234567890@s.whatsapp.net", "Hello", "", "")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "connection failed")
	assert.Empty(t, resp.ID)
	assert.True(t, resp.Timestamp.IsZero())
}

// TestMessageSender_SendMediaMessage_AllTypes tests all media types.
func TestMessageSender_SendMediaMessage_AllTypes(t *testing.T) {
	mediaTypes := []struct {
		mediaType string
		mimeType  string
	}{
		{"image", "image/jpeg"},
		{"video", "video/mp4"},
		{"audio", "audio/ogg; codecs=opus"},
		{"document", "application/pdf"},
		{"sticker", "image/webp"},
	}

	for _, mt := range mediaTypes {
		t.Run(mt.mediaType, func(t *testing.T) {
			var receivedType string

			mockSender := &mockMessageSender{
				sendMediaMessageFunc: func(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error) {
					receivedType = mediaType
					return types.SendResponse{
						ID:        "3EB0MEDIA123@s.whatsapp.net",
						Timestamp: time.Now(),
					}, nil
				},
			}

			ctx := context.Background()
			resp, err := mockSender.SendMediaMessage(ctx, "1234567890@s.whatsapp.net", mt.mediaType, []byte("data"), "caption", "file", mt.mimeType, "", "")

			assert.NoError(t, err)
			assert.Equal(t, mt.mediaType, receivedType)
			assert.NotEmpty(t, resp.ID)
		})
	}
}

func TestBusinessCommandContracts(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		target  interface{}
	}{
		{"post status", `{"type":"post_status","status_type":"text","content":"hello"}`, &PostStatusCommand{}},
		{"promote group member", `{"type":"group_promote_admin","group_jid":"1@g.us","participant_jid":"2@s.whatsapp.net"}`, &GroupCommand{}},
		{"create group", `{"type":"group_create","name":"Launch","participant_jids":["2@s.whatsapp.net"]}`, &GroupCommand{}},
		{"group permissions", `{"type":"group_update_settings","group_jid":"1@g.us","is_announce":true,"member_add_mode":"admin_add"}`, &GroupCommand{}},
		{"group invite link", `{"type":"group_invite_link","group_jid":"1@g.us","reset":true}`, &GroupCommand{}},
		{"group join requests", `{"type":"group_join_requests_update","group_jid":"1@g.us","decision":"reject","participant_jids":["9@s.whatsapp.net"]}`, &GroupCommand{}},
		{"sync labels", `{"type":"sync_labels"}`, &LabelCommand{}},
		{"apply label", `{"type":"apply_label","label_id":"7","contact_jid":"2@s.whatsapp.net"}`, &LabelCommand{}},
		{"sync catalog", `{"type":"sync_catalog_products","catalog_id":"catalog-1"}`, &CatalogCommand{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NoError(t, json.Unmarshal([]byte(tt.payload), tt.target))
		})
	}
}

// TestSubscriberConfig_HasPublisherField tests that SubscriberConfig has Publisher field.
func TestSubscriberConfig_HasPublisherField(t *testing.T) {
	mockSender := &mockMessageSender{}
	mockPub := &Publisher{} // Can't create a real Publisher without NATS, but we can test the struct

	cfg := SubscriberConfig{
		NATSURL:      "nats://localhost:4222",
		CompanyID:    "test-company",
		ConnectionID: "test-connection",
		Sender:       mockSender,
		Publisher:    mockPub,
	}

	assert.NotNil(t, cfg.Sender, "Sender field should be set")
	assert.NotNil(t, cfg.Publisher, "Publisher field should be set")
	assert.Equal(t, "test-company", cfg.CompanyID)
	assert.Equal(t, "test-connection", cfg.ConnectionID)
}

// TestSubscriber_HasPublisherField tests that Subscriber has a publisher field.
func TestSubscriber_HasPublisherField(t *testing.T) {
	mockSender := &mockMessageSender{}
	mockPub := &Publisher{}

	subscriber := &Subscriber{
		sender:    mockSender,
		publisher: mockPub,
		companyID: "test-company",
		ctx:       context.Background(),
	}

	assert.NotNil(t, subscriber.sender, "sender should be set")
	assert.NotNil(t, subscriber.publisher, "publisher should be set")
	assert.Equal(t, "test-company", subscriber.companyID)
}

// TestSendConfirmationIDMapping tests the ID mapping that happens during send confirmation.
func TestSendConfirmationIDMapping(t *testing.T) {
	tests := []struct {
		name      string
		pendingID string
		realID    string
	}{
		{
			name:      "Standard mapping",
			pendingID: "pending_550e8400-e29b-41d4-a716-446655440000",
			realID:    "3EB0FFFF@s.whatsapp.net",
		},
		{
			name:      "Short IDs",
			pendingID: "pending_abc",
			realID:    "3EB01234@s.whatsapp.net",
		},
		{
			name:      "Newsletter server",
			pendingID: "pending_xyz",
			realID:    "3EB0FFFF@newsletter.whatsapp.net",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create the payload that would be sent
			payload := SendConfirmationPayload{
				PendingMessageID: tt.pendingID,
				MessageID:        tt.realID,
				Timestamp:        time.Now().Format(time.RFC3339),
			}

			// Verify the mapping
			assert.Equal(t, tt.pendingID, payload.PendingMessageID)
			assert.Equal(t, tt.realID, payload.MessageID)

			// Verify pending ID has the expected prefix
			assert.Contains(t, payload.PendingMessageID, "pending_")
		})
	}
}

// TestHandleSendCommand_PublishConfirmationFlow tests the flow of publishing confirmation after send.
func TestHandleSendCommand_PublishConfirmationFlow(t *testing.T) {
	// Track the calls
	var sentMessage bool
	var publishedConfirmation bool

	mockSender := &mockMessageSender{
		sendMessageFunc: func(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error) {
			sentMessage = true
			return types.SendResponse{
				ID:        "3EB0TEST789@s.whatsapp.net",
				Timestamp: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC),
			}, nil
		},
	}

	// Create a confirmation payload that would be published
	// In the real implementation, this happens inside handleSendCommand
	expectedPayload := SendConfirmationPayload{
		PendingMessageID: "pending_flow_test",
		MessageID:        "3EB0TEST789@s.whatsapp.net",
		Timestamp:        time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC).Format(time.RFC3339),
	}

	ctx := context.Background()
	resp, err := mockSender.SendMessage(ctx, "1234567890@s.whatsapp.net", "Test flow", "", "")

	assert.NoError(t, err)
	assert.True(t, sentMessage, "message should be sent")

	// Verify the response has the data needed for confirmation
	assert.Equal(t, expectedPayload.MessageID, resp.ID)
	assert.Equal(t, "2026-01-05T12:00:00Z", resp.Timestamp.Format(time.RFC3339))

	// In the real flow, the confirmation would be published with:
	// - pending ID from command.MessageID
	// - real ID from resp.ID
	// - timestamp from resp.Timestamp
	publishedConfirmation = (resp.ID == expectedPayload.MessageID)
	assert.True(t, publishedConfirmation, "confirmation data should match")
}

// TestSubjectConstants_SendConfirmation tests the send confirmation subject format.
type memoryCommandLedger struct {
	results          map[string][]byte
	publishedIDs     map[string]bool
	saves            int
	published        int
	scrubbed         int
	pruned           int
	pruneDelivered   time.Duration
	pruneUndelivered time.Duration
}

func (ledger *memoryCommandLedger) GetProcessedCommand(_ context.Context, commandID string) ([]byte, bool, error) {
	result, found := ledger.results[commandID]
	return result, found, nil
}
func (ledger *memoryCommandLedger) SaveProcessedCommand(_ context.Context, commandID, _ string, result []byte) error {
	ledger.saves++
	ledger.results[commandID] = result
	return nil
}
func (ledger *memoryCommandLedger) MarkCommandEventPublished(_ context.Context, commandID string) error {
	ledger.published++
	if ledger.publishedIDs == nil {
		ledger.publishedIDs = make(map[string]bool)
	}
	ledger.publishedIDs[commandID] = true
	return nil
}

func (ledger *memoryCommandLedger) GetProcessedCommandState(
	_ context.Context,
	commandID string,
) ([]byte, bool, bool, error) {
	result, found := ledger.results[commandID]
	return result, ledger.publishedIDs[commandID], found, nil
}

func (ledger *memoryCommandLedger) ScrubProcessedCommandResult(_ context.Context, commandID string) error {
	if !ledger.publishedIDs[commandID] {
		return nil
	}
	ledger.scrubbed++
	ledger.results[commandID] = []byte(`{}`)
	return nil
}

func (ledger *memoryCommandLedger) PruneProcessedCommands(
	_ context.Context,
	deliveredOlderThan time.Duration,
	undeliveredOlderThan time.Duration,
) (int64, error) {
	ledger.pruned++
	ledger.pruneDelivered = deliveredOlderThan
	ledger.pruneUndelivered = undeliveredOlderThan
	return 0, nil
}

// noopGroupPublisher satisfies the group half of CommandEventPublisher for
// tests that only exercise the send path.
type noopGroupPublisher struct{}

func (noopGroupPublisher) PublishGroupSnapshot(string, string, types.GroupSnapshot) error {
	return nil
}
func (noopGroupPublisher) PublishGroupLeft(string, string) error               { return nil }
func (noopGroupPublisher) PublishGroupInviteLink(string, string, string) error { return nil }
func (noopGroupPublisher) PublishGroupJoinRequests(string, string, []types.GroupJoinRequest) error {
	return nil
}

type recordingCommandPublisher struct {
	noopGroupPublisher
	confirmationAttempts int
	failConfirmation     bool
	failureAttempts      int
	failFailure          bool
}

func (publisher *recordingCommandPublisher) PublishSendConfirmation(string, string, time.Time, string) error {
	publisher.confirmationAttempts++
	if publisher.failConfirmation {
		return errors.New("confirmation transport unavailable")
	}
	return nil
}
func (publisher *recordingCommandPublisher) PublishSendFailed(string, string, string) error {
	publisher.failureAttempts++
	if publisher.failFailure {
		return errors.New("failure transport unavailable")
	}
	return nil
}
func (*recordingCommandPublisher) PublishCommandResult(string, string, bool, string, string) error {
	return nil
}
func (*recordingCommandPublisher) PublishProfilePicture(string, string, bool, time.Time) error {
	return nil
}
func (*recordingCommandPublisher) PublishLabels([]types.WhatsAppLabel) error { return nil }
func (*recordingCommandPublisher) PublishCatalog(types.Catalog) error        { return nil }

func TestSendResultReplayPreventsDuplicateSideEffect(t *testing.T) {
	sendCalls := 0
	sender := &mockMessageSender{sendMessageFunc: func(context.Context, string, string, string, string) (types.SendResponse, error) {
		sendCalls++
		return types.SendResponse{ID: "wa-real-id", Timestamp: time.Now()}, nil
	}}
	ledger := &memoryCommandLedger{results: make(map[string][]byte)}
	publisher := &recordingCommandPublisher{failConfirmation: true}
	subscriber := &Subscriber{
		ctx: context.Background(), sender: sender, ledger: ledger, publisher: publisher,
	}
	command := []byte(`{"type":"text","command_id":"command-1","message_id":"pending-1","to":"1@s.whatsapp.net","content":"hello"}`)

	// WhatsApp accepts the send and the ledger commits, but publication fails.
	subscriber.handleSendCommand(&natsgo.Msg{Data: command})
	require.Equal(t, 1, sendCalls)
	require.Equal(t, 1, ledger.saves)
	require.Equal(t, 1, publisher.confirmationAttempts)

	// Redelivery after publication failure (or a worker crash before ACK) replays
	// the ledger result and never executes the external side effect again.
	publisher.failConfirmation = false
	subscriber.handleSendCommand(&natsgo.Msg{Data: command})
	assert.Equal(t, 1, sendCalls)
	assert.Equal(t, 1, ledger.saves)
	assert.Equal(t, 2, publisher.confirmationAttempts)
	assert.Equal(t, 1, ledger.published)
}

func TestFailedSendResultReplayPreventsExtraWhatsAppAttempts(t *testing.T) {
	sendCalls := 0
	sender := &mockMessageSender{sendMessageFunc: func(context.Context, string, string, string, string) (types.SendResponse, error) {
		sendCalls++
		return types.SendResponse{}, errors.New("whatsapp unavailable")
	}}
	ledger := &memoryCommandLedger{results: make(map[string][]byte)}
	publisher := &recordingCommandPublisher{failFailure: true}
	subscriber := &Subscriber{
		ctx: context.Background(), sender: sender, ledger: ledger, publisher: publisher,
	}
	command := []byte(`{"type":"text","command_id":"command-failed","message_id":"pending-failed","to":"1@s.whatsapp.net","content":"hello"}`)
	cmd := SendMessageCommand{
		Type:      "text",
		CommandID: "command-failed",
		MessageID: "pending-failed",
		To:        "1@s.whatsapp.net",
	}

	// The final WhatsApp attempt fails. Its durable result is saved, while the
	// unavailable result transport prevents ACK.
	subscriber.finishFailedSend(
		&natsgo.Msg{Data: command},
		cmd,
		"whatsapp unavailable",
	)
	require.Equal(t, 0, sendCalls)
	require.Equal(t, 1, ledger.saves)
	require.Equal(t, 1, publisher.failureAttempts)

	var stored storedCommandResult
	require.NoError(t, json.Unmarshal(ledger.results["command-failed"], &stored))
	require.True(t, stored.Failed)
	require.Equal(t, "whatsapp unavailable", stored.ErrorMessage)

	// Redelivery replays send_failed from the ledger without calling WhatsApp.
	publisher.failFailure = false
	subscriber.handleSendCommand(&natsgo.Msg{Data: command})
	assert.Equal(t, 0, sendCalls)
	assert.Equal(t, 1, ledger.saves)
	assert.Equal(t, 2, publisher.failureAttempts)
	assert.Equal(t, 1, ledger.published)
}

func TestSubjectConstants_SendConfirmation(t *testing.T) {
	companyID := "test-company"
	connectionID := "test-connection"

	// The subject format is WHATSAPP.events.{companyID}.{connectionID}.send_confirmation
	expectedSubject := "WHATSAPP.events.test-company.test-connection.send_confirmation"

	// Use the helper function from publisher_test.go (same package)
	actualSubject := sprintfHelper(SubjectSendConfirmation, companyID, connectionID)

	assert.Equal(t, expectedSubject, actualSubject)
}

// newLedgeredGroupSubscriber wires the durable command ledger, which is what
// makes a redelivery replay an outcome instead of repeating the work.
// deliveredMsg carries real JetStream delivery metadata.
//
// A bare `&nats.Msg{}` reports NumDelivered=1 forever, so a test that loops
// three times over one never reaches `retryCommand`'s terminal branch and
// cannot observe the failure it claims to assert.
func deliveredMsg(payload string, delivery int) *natsgo.Msg {
	return &natsgo.Msg{
		Sub: &natsgo.Subscription{},
		Reply: fmt.Sprintf(
			"$JS.ACK.WHATSAPP_COMMANDS.consumer.%d.10.20.1700000000000000000.0",
			delivery,
		),
		Data: []byte(payload),
	}
}

func newLedgeredGroupSubscriber() (*Subscriber, *mockCommandExecutor, *mockGroupPublisher, *memoryCommandLedger) {
	executor := &mockCommandExecutor{}
	publisher := &mockGroupPublisher{}
	ledger := &memoryCommandLedger{results: make(map[string][]byte)}
	return &Subscriber{
		ctx: context.Background(), executor: executor, publisher: publisher, ledger: ledger,
	}, executor, publisher, ledger
}

// WhatsApp applies group settings one request at a time with no transaction
// across them, so a rejection half-way leaves the earlier ones applied. Telling
// the user it failed while quietly keeping the old name on screen is the worst
// of both worlds.
func TestPartiallyAppliedSettingsStillPublishTheRealGroupState(t *testing.T) {
	subscriber, executor, publisher := newGroupSubscriber()
	// The name landed; the announce flag was refused. Reading the group back
	// still works - only the write failed.
	executor.settingsErr = errors.New("403 not authorized")

	subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
		`{"type":"group_update_settings","group_jid":"1@g.us","name":"Ops","is_announce":true}`,
	)}, "group_update_settings")

	require.Equal(t, []string{"snapshot"}, publisher.actions,
		"the workspace must be told what the group actually looks like now")
	assert.Equal(t, 1, executor.snapshotCalls)
}

func TestSettingsFailureIsStillReportedAfterPublishingTheSnapshot(t *testing.T) {
	subscriber, executor, publisher := newGroupSubscriber()
	executor.settingsErr = errors.New("403 not authorized")
	const payload = `{"type":"group_update_settings","group_jid":"1@g.us","name":"Ops","command_id":"cmd-settings-1"}`

	// Real delivery counts, so the third attempt actually reaches the terminal
	// branch instead of Nak-ing forever.
	for delivery := 1; delivery <= 3; delivery++ {
		subscriber.handleGroupCommand(deliveredMsg(payload, delivery), "group_update_settings")
	}

	assert.Len(t, publisher.actions, 3, "each attempt republishes the true state")
	require.Equal(t, []string{"group_update_settings"}, publisher.results,
		"retry exhaustion must report the failure exactly once")
	assert.Contains(t, publisher.errors[0], "403 not authorized")
}

// A settings write is not ledgered - each attempt genuinely re-applies it - so
// exhaustion here is a real failure and must be reported as one.
func TestSettingsExhaustionIsReportedAsAPlainFailure(t *testing.T) {
	subscriber, executor, publisher := newGroupSubscriber()
	executor.settingsErr = errors.New("403 not authorized")
	const payload = `{"type":"group_update_settings","group_jid":"1@g.us","name":"Ops","command_id":"cmd-settings-2"}`

	for delivery := 1; delivery <= 3; delivery++ {
		subscriber.handleGroupCommand(deliveredMsg(payload, delivery), "group_update_settings")
	}

	require.Len(t, publisher.errors, 1)
	assert.NotContains(t, publisher.errors[0], "was applied on WhatsApp",
		"a change WhatsApp refused must not be described as applied")
}

// The opposite case: the change landed and only the refresh failed. Telling the
// user it failed would invite them to redo something that already happened.
func TestAppliedChangeThatCannotSyncIsReportedAsApplied(t *testing.T) {
	subscriber, executor, publisher, ledger := newLedgeredGroupSubscriber()
	executor.participantResults = []types.GroupParticipantResult{
		{JID: "2@s.whatsapp.net", Code: 0, Applied: true},
	}
	// The promote succeeds; reading the group back never does.
	publisher.failSnapshot = true
	const payload = `{"type":"group_promote_admin","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"],"command_id":"cmd-promote-sync"}`

	for delivery := 1; delivery <= 3; delivery++ {
		subscriber.handleGroupCommand(deliveredMsg(payload, delivery), "group_promote_admin")
	}

	assert.Equal(t, 1, executor.updateCalls,
		"the ledger must stop the promote from being re-sent on every retry")
	assert.Equal(t, 1, ledger.saves)
	require.Len(t, publisher.errors, 1, "exhaustion reports exactly once")
	assert.Contains(t, publisher.errors[0], "applied on WhatsApp")
	assert.Contains(t, publisher.errors[0], "no need to repeat the action")
}

// Once the outcome has been delivered, a later redelivery is simply acked - no
// second event, no second mutation.
func TestDeliveredCommandIsNotRepublishedOnRedelivery(t *testing.T) {
	subscriber, executor, publisher, ledger := newLedgeredGroupSubscriber()
	const payload = `{"type":"group_leave","group_jid":"1@g.us","command_id":"cmd-leave-published"}`

	subscriber.handleGroupCommand(deliveredMsg(payload, 1), "group_leave")
	require.Equal(t, []string{"1@g.us"}, publisher.left)
	require.Equal(t, 1, ledger.published)

	subscriber.handleGroupCommand(deliveredMsg(payload, 2), "group_leave")
	assert.Equal(t, 1, executor.leaveCalls, "the leave must not be repeated")
	assert.Equal(t, []string{"1@g.us"}, publisher.left,
		"a delivered outcome must not be published twice")
}

// An invite link is a credential; the worker's copy has no purpose once the API
// has it.
func TestDeliveredInviteLinkIsScrubbedFromTheLedger(t *testing.T) {
	subscriber, _, _, ledger := newLedgeredGroupSubscriber()

	subscriber.handleGroupCommand(deliveredMsg(
		`{"type":"group_invite_link","group_jid":"1@g.us","reset":true,"command_id":"cmd-scrub-1"}`, 1,
	), "group_invite_link")

	assert.Equal(t, 1, ledger.scrubbed, "the stored link must be dropped after delivery")
	assert.NotContains(t, string(ledger.results["cmd-scrub-1"]), "chat.whatsapp.com")
}

// A ledger row written by a different command family must never be replayed as
// this command's result.
func TestLedgerRejectsAMismatchedCommandType(t *testing.T) {
	subscriber, executor, publisher, ledger := newLedgeredGroupSubscriber()
	ledger.results["cmd-mismatch"] = []byte(`{"command_type":"group_create","invite_link":""}`)

	subscriber.handleGroupCommand(deliveredMsg(
		`{"type":"group_invite_link","group_jid":"1@g.us","reset":true,"command_id":"cmd-mismatch"}`, 1,
	), "group_invite_link")

	assert.Equal(t, 0, executor.inviteCalls)
	assert.Empty(t, publisher.inviteLinks, "a mismatched record must not replay as an empty link")
}

// Rotating an invite link revokes the previous one. Re-running it on redelivery
// kills the link the earlier attempt already handed to the user.
func TestInviteLinkResetIsAppliedAtMostOncePerCommand(t *testing.T) {
	subscriber, executor, publisher, _ := newLedgeredGroupSubscriber()

	for range 3 {
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_invite_link","group_jid":"1@g.us","reset":true,"command_id":"cmd-reset-1"}`,
		)}, "group_invite_link")
	}

	assert.Equal(t, 1, executor.inviteCalls, "the link must be rotated exactly once")
	assert.Equal(t, []string{"https://chat.whatsapp.com/CODE-1"}, publisher.inviteLinks,
		"the link is reported once; later deliveries are acknowledged, not repeated")
}

func TestInviteLinkResetSurvivesAFailedPublish(t *testing.T) {
	subscriber, executor, publisher, _ := newLedgeredGroupSubscriber()
	publisher.failInviteLink = true

	subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
		`{"type":"group_invite_link","group_jid":"1@g.us","reset":true,"command_id":"cmd-reset-2"}`,
	)}, "group_invite_link")
	assert.Equal(t, 1, executor.inviteCalls)
	assert.Empty(t, publisher.inviteLinks)

	publisher.failInviteLink = false
	subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
		`{"type":"group_invite_link","group_jid":"1@g.us","reset":true,"command_id":"cmd-reset-2"}`,
	)}, "group_invite_link")
	assert.Equal(t, 1, executor.inviteCalls, "the link must not be rotated a second time")
	assert.Equal(t, []string{"https://chat.whatsapp.com/CODE-1"}, publisher.inviteLinks)
}

// A plain read has no side effect, so it should stay fresh rather than replay.
func TestInviteLinkFetchIsNotLedgered(t *testing.T) {
	subscriber, executor, publisher, ledger := newLedgeredGroupSubscriber()

	for range 2 {
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_invite_link","group_jid":"1@g.us","reset":false,"command_id":"cmd-fetch-1"}`,
		)}, "group_invite_link")
	}

	assert.Equal(t, 2, executor.inviteCalls)
	assert.Equal(t, 0, ledger.saves)
	assert.Len(t, publisher.inviteLinks, 2)
}

// Leaving twice makes WhatsApp reject the second attempt, which without the
// ledger is reported as "leaving failed" after it actually succeeded.
func TestLeaveIsAppliedAtMostOncePerCommand(t *testing.T) {
	subscriber, executor, publisher, _ := newLedgeredGroupSubscriber()

	for range 3 {
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_leave","group_jid":"1@g.us","command_id":"cmd-leave-1"}`,
		)}, "group_leave")
	}

	assert.Equal(t, 1, executor.leaveCalls)
	assert.Equal(t, []string{"1@g.us"}, publisher.left,
		"the departure is reported once, then replays are acknowledged")
	assert.Empty(t, publisher.results, "a successful departure is never reported as a failure")
}

// A redelivered participant change must not be re-sent: WhatsApp answers a
// repeat with a per-member error that would be reported as a false failure.
func TestRedeliveredParticipantChangeReplaysInsteadOfReapplying(t *testing.T) {
	subscriber, executor, publisher, _ := newLedgeredGroupSubscriber()
	executor.participantResults = []types.GroupParticipantResult{
		{JID: "2@s.whatsapp.net", Code: 0, Applied: true},
	}

	for range 3 {
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_add_participants","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"],"command_id":"cmd-add-2"}`,
		)}, "group_add_participants")
	}

	assert.Equal(t, 1, executor.updateCalls, "WhatsApp is asked to add the member once")
	assert.Len(t, publisher.actions, 1, "and its outcome is delivered exactly once")
	assert.Empty(t, publisher.results, "an applied change is never reported as a rejection")
}

func TestRedeliveredJoinRequestDecisionDoesNotBecomeAFalseFailure(t *testing.T) {
	subscriber, executor, publisher, _ := newLedgeredGroupSubscriber()
	executor.participantResults = []types.GroupParticipantResult{
		{JID: "9@s.whatsapp.net", Code: 0, Applied: true},
	}

	for range 3 {
		subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(
			`{"type":"group_join_requests_update","group_jid":"1@g.us","participant_jids":["9@s.whatsapp.net"],"decision":"approve","command_id":"cmd-approve-1"}`,
		)}, "group_join_requests_update")
	}

	assert.Equal(t, 1, executor.decisionCalls, "the request is approved once")
	assert.Empty(t, publisher.results,
		"a second delivery must not report the landed approval as rejected")
}

// A rejection is only "reported" once its command_result actually reaches the
// API. Recording delivery any earlier lets a transport blip turn a WhatsApp
// refusal into silence: the redelivery would be recognised as already reported
// and acknowledged, and the user would never learn their request was refused.
func TestRejectionIsNotMarkedDeliveredUntilItsResultIsPublished(t *testing.T) {
	subscriber, executor, publisher, ledger := newLedgeredGroupSubscriber()
	executor.participantResults = []types.GroupParticipantResult{
		{JID: "2@s.whatsapp.net", Code: 403, Applied: false},
	}
	const payload = `{"type":"group_add_participants","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"],"command_id":"cmd-reject-1"}`

	// The snapshot lands, WhatsApp's refusal is computed, but the result
	// publish fails.
	publisher.failCommandResult = true
	subscriber.handleGroupCommand(deliveredMsg(payload, 1), "group_add_participants")

	assert.Equal(t, 1, executor.updateCalls, "the mutation ran once")
	assert.Equal(t, []string{"snapshot"}, publisher.actions)
	assert.Empty(t, publisher.results, "the refusal never reached the API")
	assert.Equal(t, 0, ledger.published,
		"an undelivered refusal must not be recorded as reported")
	assert.False(t, ledger.publishedIDs["cmd-reject-1"])

	// Redelivery: the mutation must not repeat, and the refusal must now land.
	publisher.failCommandResult = false
	subscriber.handleGroupCommand(deliveredMsg(payload, 2), "group_add_participants")

	assert.Equal(t, 1, executor.updateCalls, "WhatsApp is not asked a second time")
	require.Equal(t, []string{"group_add_participants"}, publisher.results,
		"the refusal is delivered on the retry")
	assert.Equal(t, []string{"failed"}, publisher.outcomes)
	assert.True(t, ledger.publishedIDs["cmd-reject-1"],
		"only now is the command recorded as reported")
}

// The same guarantee for a rejected invite-link rotation, which additionally
// must not leave its link in the ledger once it is finally delivered.
func TestRejectedInviteLinkKeepsItsCredentialOutOfTheLedgerOnceDelivered(t *testing.T) {
	subscriber, _, publisher, ledger := newLedgeredGroupSubscriber()
	const payload = `{"type":"group_invite_link","group_jid":"1@g.us","reset":true,"command_id":"cmd-reject-2"}`

	publisher.failInviteLink = true
	subscriber.handleGroupCommand(deliveredMsg(payload, 1), "group_invite_link")
	assert.Equal(t, 0, ledger.published)
	assert.Contains(t, string(ledger.results["cmd-reject-2"]), "chat.whatsapp.com",
		"the link is still needed for the replay while undelivered")

	publisher.failInviteLink = false
	subscriber.handleGroupCommand(deliveredMsg(payload, 2), "group_invite_link")
	assert.True(t, ledger.publishedIDs["cmd-reject-2"])
	assert.NotContains(t, string(ledger.results["cmd-reject-2"]), "chat.whatsapp.com",
		"once delivered, the worker's copy of the credential is dropped")
}

// An applied-but-unsynced outcome is reported with its own type so the UI never
// has to guess from the message text, and the record is then prunable.
func TestAppliedButUnsyncedOutcomeIsTypedAndRecorded(t *testing.T) {
	subscriber, _, publisher, ledger := newLedgeredGroupSubscriber()
	publisher.failSnapshot = true
	const payload = `{"type":"group_promote_admin","group_jid":"1@g.us","participant_jids":["2@s.whatsapp.net"],"command_id":"cmd-sync-1"}`

	for delivery := 1; delivery <= 3; delivery++ {
		subscriber.handleGroupCommand(deliveredMsg(payload, delivery), "group_promote_admin")
	}

	require.Equal(t, []string{"applied_not_synced"}, publisher.outcomes,
		"the outcome must be typed, not inferred from wording")
	assert.True(t, ledger.publishedIDs["cmd-sync-1"],
		"a reported partial outcome leaves a prunable record, not a permanent one")
}

// A plain refusal and an applied-but-unsynced result must be distinguishable
// without reading their messages.
func TestOutcomesAreDistinguishableWithoutStringMatching(t *testing.T) {
	subscriber, executor, publisher, _ := newLedgeredGroupSubscriber()
	executor.settingsErr = errors.New("403 not authorized")

	for delivery := 1; delivery <= 3; delivery++ {
		subscriber.handleGroupCommand(deliveredMsg(
			`{"type":"group_update_settings","group_jid":"1@g.us","name":"Ops","command_id":"cmd-outcome-1"}`,
			delivery,
		), "group_update_settings")
	}

	require.Equal(t, []string{"failed"}, publisher.outcomes)
}

// Both retention classes are passed through, and the undelivered window is the
// conservative one - it is the guard against repeating a mutation.
func TestPruningBoundsBothRetentionClasses(t *testing.T) {
	ledger := &memoryCommandLedger{results: make(map[string][]byte)}
	removed, err := ledger.PruneProcessedCommands(
		context.Background(),
		processedCommandDeliveredRetention,
		processedCommandUndeliveredRetention,
	)
	require.NoError(t, err)
	assert.Zero(t, removed)
	assert.Equal(t, 24*time.Hour, ledger.pruneDelivered)
	assert.Equal(t, 7*24*time.Hour, ledger.pruneUndelivered)
	assert.Greater(t, ledger.pruneUndelivered, ledger.pruneDelivered,
		"an undelivered record must outlive a delivered one")
	// The commands stream caps a message at 24h, so nothing can be redelivered
	// after the undelivered window closes.
	assert.Greater(t, processedCommandUndeliveredRetention, 24*time.Hour,
		"undelivered retention must exceed the commands stream MaxAge")
}
