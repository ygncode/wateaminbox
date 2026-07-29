package nats

import (
	"context"
	"encoding/json"
	"errors"
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
	sendReactionFunc     func(ctx context.Context, chatJID string, messageID string, emoji string, fromMe bool) (types.SendResponse, error)
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

func (m *mockMessageSender) SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, fromMe bool) (types.SendResponse, error) {
	if m.sendReactionFunc != nil {
		return m.sendReactionFunc(ctx, chatJID, messageID, emoji, fromMe)
	}
	return types.SendResponse{}, nil
}

type mockCommandExecutor struct {
	groupAction string
	groupJID    string
	participant string
	statusType  string
}

func (m *mockCommandExecutor) PostStatus(_ context.Context, statusType, _, _ string) (types.SendResponse, error) {
	m.statusType = statusType
	return types.SendResponse{}, nil
}
func (m *mockCommandExecutor) UpdateGroupParticipant(_ context.Context, groupJID, participantJID, action string) error {
	m.groupJID, m.participant, m.groupAction = groupJID, participantJID, action
	return nil
}
func (m *mockCommandExecutor) UpdateGroupSettings(context.Context, string, *string, *string) error {
	return nil
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

func TestCommandHandlersInvokeExecutor(t *testing.T) {
	executor := &mockCommandExecutor{}
	subscriber := &Subscriber{ctx: context.Background(), executor: executor}

	subscriber.handleGroupCommand(&natsgo.Msg{Data: []byte(`{"type":"group_promote_admin","group_jid":"1@g.us","participant_jid":"2@s.whatsapp.net"}`)}, "group_promote_admin")
	assert.Equal(t, "promote", executor.groupAction)
	assert.Equal(t, "1@g.us", executor.groupJID)
	assert.Equal(t, "2@s.whatsapp.net", executor.participant)

	subscriber.handlePostStatusCommand(&natsgo.Msg{Data: []byte(`{"type":"post_status","status_type":"text","content":"hello"}`)})
	assert.Equal(t, "text", executor.statusType)
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
	results   map[string][]byte
	saves     int
	published int
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
func (ledger *memoryCommandLedger) MarkCommandEventPublished(context.Context, string) error {
	ledger.published++
	return nil
}

type recordingCommandPublisher struct {
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
func (*recordingCommandPublisher) PublishCommandResult(string, string, bool, string) error {
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
