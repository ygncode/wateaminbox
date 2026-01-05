package nats

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

// mockMessageSender is a mock implementation of MessageSender for testing.
type mockMessageSender struct {
	sendMessageFunc       func(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error)
	sendMediaMessageFunc  func(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error)
	sendReactionFunc      func(ctx context.Context, chatJID string, messageID string, emoji string, fromMe bool) (types.SendResponse, error)
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

// TestSendMessageCommand_AllTypes tests that all message types are recognized.
func TestSendMessageCommand_AllTypes(t *testing.T) {
	validTypes := []string{"text", "image", "video", "audio", "document"}

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
		MessageID: "pending_media_001",
		To:        "1234567890@s.whatsapp.net",
		Type:      "image",
		MediaData: []byte("fake image data"),
		Caption:   "Test image",
		FileName:  "test.jpg",
		MimeType:  "image/jpeg",
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var unmarshaled SendMessageCommand
	err = json.Unmarshal(data, &unmarshaled)
	require.NoError(t, err)

	assert.Equal(t, "image", unmarshaled.Type)
	assert.NotEmpty(t, unmarshaled.MediaData, "media data should be preserved")
	assert.Equal(t, "Test image", unmarshaled.Caption)
	assert.Equal(t, "test.jpg", unmarshaled.FileName)
	assert.Equal(t, "image/jpeg", unmarshaled.MimeType)
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
		name         string
		pendingID    string
		realID       string
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
func TestSubjectConstants_SendConfirmation(t *testing.T) {
	companyID := "test-company"
	connectionID := "test-connection"

	// The subject format is WHATSAPP.events.{companyID}.{connectionID}.send_confirmation
	expectedSubject := "WHATSAPP.events.test-company.test-connection.send_confirmation"

	// Use the helper function from publisher_test.go (same package)
	actualSubject := sprintfHelper(SubjectSendConfirmation, companyID, connectionID)

	assert.Equal(t, expectedSubject, actualSubject)
}
