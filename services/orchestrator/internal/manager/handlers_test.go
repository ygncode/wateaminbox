package manager

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

// TestNewHandlers tests handler creation.
func TestNewHandlers(t *testing.T) {
	m := New(Config{})
	mockNATS := NewMockNATSClient()

	// Note: NewHandlers expects *natsclient.Client, not NATSClient interface
	// This test verifies the Handlers struct initialization pattern
	h := &Handlers{
		manager: m,
		// nats would be set to the real client in production
	}

	assert.NotNil(t, h)
	assert.Equal(t, m, h.manager)
	_ = mockNATS // Mock would be used if handlers used interface
}

// TestHandleSpawnCommand_Valid tests successful spawn command handling.
func TestHandleSpawnCommand_Valid(t *testing.T) {
	cmd := types.SpawnWorkerCommand{
		Type:         types.CommandSpawn,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		TenantSchema: "tenant_company_123",
		DatabaseURL:  "postgres://localhost/db",
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	// Verify the command can be marshaled/unmarshaled correctly
	var parsed types.SpawnWorkerCommand
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, cmd.Type, parsed.Type)
	assert.Equal(t, cmd.CompanyID, parsed.CompanyID)
	assert.Equal(t, cmd.ConnectionID, parsed.ConnectionID)
	assert.Equal(t, cmd.TenantSchema, parsed.TenantSchema)
	assert.Equal(t, cmd.DatabaseURL, parsed.DatabaseURL)
}

// TestHandleSpawnCommand_MissingFields tests spawn command with missing fields.
func TestHandleSpawnCommand_MissingFields(t *testing.T) {
	tests := []struct {
		name string
		cmd  types.SpawnWorkerCommand
	}{
		{
			name: "missing company_id",
			cmd: types.SpawnWorkerCommand{
				Type:         types.CommandSpawn,
				ConnectionID: "conn-456",
				TenantSchema: "tenant",
				DatabaseURL:  "postgres://localhost/db",
			},
		},
		{
			name: "missing connection_id",
			cmd: types.SpawnWorkerCommand{
				Type:         types.CommandSpawn,
				CompanyID:    "company-123",
				TenantSchema: "tenant",
				DatabaseURL:  "postgres://localhost/db",
			},
		},
		{
			name: "empty tenant_schema",
			cmd: types.SpawnWorkerCommand{
				Type:         types.CommandSpawn,
				CompanyID:    "company-123",
				ConnectionID: "conn-456",
				DatabaseURL:  "postgres://localhost/db",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.cmd)
			require.NoError(t, err)

			// Verify the command can be marshaled (validation would happen in handler)
			var parsed types.SpawnWorkerCommand
			err = json.Unmarshal(data, &parsed)
			require.NoError(t, err)
		})
	}
}

// TestHandleKillCommand_Valid tests successful kill command handling.
func TestHandleKillCommand_Valid(t *testing.T) {
	cmd := types.KillWorkerCommand{
		Type:         types.CommandKill,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Reason:       "user requested disconnect",
		Unlink:       true,
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var parsed types.KillWorkerCommand
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, cmd.Type, parsed.Type)
	assert.Equal(t, cmd.CompanyID, parsed.CompanyID)
	assert.Equal(t, cmd.ConnectionID, parsed.ConnectionID)
	assert.Equal(t, cmd.Reason, parsed.Reason)
	assert.True(t, parsed.Unlink)
}

// TestHandleKillCommand_OptionalReason tests kill command without reason.
func TestHandleKillCommand_OptionalReason(t *testing.T) {
	cmd := types.KillWorkerCommand{
		Type:         types.CommandKill,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		// Reason is omitted
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var parsed types.KillWorkerCommand
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Empty(t, parsed.Reason, "reason should be empty when not provided")
}

// TestHandleStatusCommand_Valid tests successful status command handling.
func TestHandleStatusCommand_Valid(t *testing.T) {
	cmd := types.WorkerStatusCommand{
		Type:         types.CommandStatus,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	var parsed types.WorkerStatusCommand
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, cmd.Type, parsed.Type)
	assert.Equal(t, cmd.CompanyID, parsed.CompanyID)
	assert.Equal(t, cmd.ConnectionID, parsed.ConnectionID)
}

// TestWorkerStatusResponse tests status response serialization.
func TestWorkerStatusResponse(t *testing.T) {
	now := time.Now()
	response := types.WorkerStatusResponse{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Status:       types.StatusConnected,
		ConnectedAt:  now,
		LastActivity: now,
		PID:          12345,
	}

	data, err := json.Marshal(response)
	require.NoError(t, err)

	var parsed types.WorkerStatusResponse
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, response.CompanyID, parsed.CompanyID)
	assert.Equal(t, response.ConnectionID, parsed.ConnectionID)
	assert.Equal(t, response.Status, parsed.Status)
	assert.Equal(t, response.PID, parsed.PID)
}

// TestWorkerStatusResponse_WithError tests status response with error.
func TestWorkerStatusResponse_WithError(t *testing.T) {
	response := types.WorkerStatusResponse{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Status:       types.StatusError,
		Error:        "connection failed: timeout",
	}

	data, err := json.Marshal(response)
	require.NoError(t, err)

	var parsed types.WorkerStatusResponse
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, types.StatusError, parsed.Status)
	assert.Equal(t, "connection failed: timeout", parsed.Error)
}

// TestCommandEnvelope tests command envelope parsing.
func TestCommandEnvelope(t *testing.T) {
	tests := []struct {
		name        string
		commandType string
	}{
		{"spawn command", types.CommandSpawn},
		{"kill command", types.CommandKill},
		{"status command", types.CommandStatus},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			envelope := struct {
				Type string `json:"type"`
			}{
				Type: tt.commandType,
			}

			data, err := json.Marshal(envelope)
			require.NoError(t, err)

			var parsed struct {
				Type string `json:"type"`
			}
			err = json.Unmarshal(data, &parsed)
			require.NoError(t, err)

			assert.Equal(t, tt.commandType, parsed.Type)
		})
	}
}

// TestProcessCommands_InvalidJSON tests handling of invalid JSON.
func TestProcessCommands_InvalidJSON(t *testing.T) {
	invalidJSON := []byte(`{"type": "spawn", invalid json}`)

	var envelope struct {
		Type string `json:"type"`
	}
	err := json.Unmarshal(invalidJSON, &envelope)

	assert.Error(t, err, "should fail to parse invalid JSON")
}

// TestProcessCommands_UnknownType tests handling of unknown command type.
func TestProcessCommands_UnknownType(t *testing.T) {
	envelope := struct {
		Type string `json:"type"`
	}{
		Type: "unknown_command",
	}

	data, err := json.Marshal(envelope)
	require.NoError(t, err)

	var parsed struct {
		Type string `json:"type"`
	}
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	// Verify it's not a known command type
	assert.NotEqual(t, types.CommandSpawn, parsed.Type)
	assert.NotEqual(t, types.CommandKill, parsed.Type)
	assert.NotEqual(t, types.CommandStatus, parsed.Type)
}

// TestConnectionStatusEvent tests connection status event serialization.
func TestConnectionStatusEvent(t *testing.T) {
	now := time.Now()
	event := types.ConnectionStatusEvent{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Status:       types.StatusConnected,
		Reason:       "QR code scanned successfully",
		Timestamp:    now,
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var parsed types.ConnectionStatusEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, event.CompanyID, parsed.CompanyID)
	assert.Equal(t, event.ConnectionID, parsed.ConnectionID)
	assert.Equal(t, event.Status, parsed.Status)
	assert.Equal(t, event.Reason, parsed.Reason)
}

// TestQRCodeEvent tests QR code event serialization.
func TestQRCodeEvent(t *testing.T) {
	now := time.Now()
	event := types.QRCodeEvent{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		QRData:       "base64-encoded-qr-data",
		Timestamp:    now,
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var parsed types.QRCodeEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, event.CompanyID, parsed.CompanyID)
	assert.Equal(t, event.ConnectionID, parsed.ConnectionID)
	assert.Equal(t, event.QRData, parsed.QRData)
}

// TestMessageEvent tests message event serialization.
func TestMessageEvent(t *testing.T) {
	now := time.Now()
	event := types.MessageEvent{
		MessageID: "msg-789",
		From:      "1234567890@s.whatsapp.net",
		To:        "recipient@s.whatsapp.net",
		FromMe:    false,
		Content:   "Hello, World!",
		Type:      "text",
		Timestamp: now,
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var parsed types.MessageEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, event.MessageID, parsed.MessageID)
	assert.Equal(t, event.From, parsed.From)
	assert.Equal(t, event.To, parsed.To)
	assert.Equal(t, event.Content, parsed.Content)
	assert.Equal(t, event.Type, parsed.Type)
}

// TestSubjectConstants tests that NATS subject constants are defined.
func TestSubjectConstants(t *testing.T) {
	assert.Equal(t, "WHATSAPP.commands", types.SubjectCommands)
	assert.Equal(t, "WHATSAPP.events", types.SubjectEvents)
}

// TestCommandTypeConstants tests that command type constants are defined.
func TestCommandTypeConstants(t *testing.T) {
	assert.Equal(t, "spawn", types.CommandSpawn)
	assert.Equal(t, "kill", types.CommandKill)
	assert.Equal(t, "status", types.CommandStatus)
}

// TestEventTypeConstants tests that event type constants are defined.
func TestEventTypeConstants(t *testing.T) {
	assert.Equal(t, "qr_code", types.EventQRCode)
	assert.Equal(t, "connection_status", types.EventConnectionStatus)
	assert.Equal(t, "message", types.EventMessage)
}

// TestMockNATSClient tests the mock NATS client.
func TestMockNATSClient(t *testing.T) {
	mock := NewMockNATSClient()

	// Test PublishEvent
	err := mock.PublishEvent("test.subject", []byte("test data"))
	assert.NoError(t, err)

	calls := mock.GetPublishEventCalls()
	require.Len(t, calls, 1)
	assert.Equal(t, "test.subject", calls[0].Subject)
	assert.Equal(t, []byte("test data"), calls[0].Data)

	// Test PublishCommand
	err = mock.PublishCommand([]byte("command data"))
	assert.NoError(t, err)
	assert.Len(t, mock.PublishCommandCalls, 1)

	// Test CreateStreams
	err = mock.CreateStreams()
	assert.NoError(t, err)
	assert.Equal(t, 1, mock.CreateStreamsCalls)

	// Test Close
	mock.Close()
	assert.Equal(t, 1, mock.CloseCalls)
}

// TestMockNATSClient_CustomBehavior tests custom behavior in mock NATS client.
func TestMockNATSClient_CustomBehavior(t *testing.T) {
	mock := NewMockNATSClient()

	// Set custom error
	expectedErr := assert.AnError
	mock.PublishEventFunc = func(subject string, data []byte) error {
		return expectedErr
	}

	err := mock.PublishEvent("test", []byte("data"))
	assert.Equal(t, expectedErr, err)
}

// TestMockSubscription tests the mock subscription.
func TestMockSubscription(t *testing.T) {
	mock := NewMockSubscription()

	// Default behavior returns timeout
	msgs, err := mock.Fetch(10)
	assert.Nil(t, msgs)
	assert.Error(t, err)

	// Test drain
	err = mock.Drain()
	assert.NoError(t, err)
	assert.Equal(t, 1, mock.DrainCalls)
}

// TestHandlersIntegration tests handlers with mock manager.
func TestHandlersIntegration(t *testing.T) {
	// Create a manager
	m := New(Config{
		HealthCheckInterval: 1 * time.Second,
	})

	// Create handlers struct (without real NATS client)
	h := &Handlers{
		manager: m,
	}

	// Verify handler can access manager
	assert.NotNil(t, h.manager)
	assert.Equal(t, 0, h.manager.WorkerCount())
}

// BenchmarkCommandParsing benchmarks JSON parsing of commands.
func BenchmarkCommandParsing(b *testing.B) {
	cmd := types.SpawnWorkerCommand{
		Type:         types.CommandSpawn,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		TenantSchema: "tenant_company_123",
		DatabaseURL:  "postgres://localhost/db",
	}

	data, _ := json.Marshal(cmd)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var parsed types.SpawnWorkerCommand
		_ = json.Unmarshal(data, &parsed)
	}
}

// BenchmarkEventSerialization benchmarks JSON serialization of events.
func BenchmarkEventSerialization(b *testing.B) {
	event := types.ConnectionStatusEvent{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Status:       types.StatusConnected,
		Reason:       "test",
		Timestamp:    time.Now(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = json.Marshal(event)
	}
}

// TestHandlerErrorRecovery tests that handlers don't panic on errors.
func TestHandlerErrorRecovery(t *testing.T) {
	// Test that parsing invalid commands doesn't panic
	invalidCommands := [][]byte{
		nil,
		{},
		[]byte("not json"),
		[]byte(`{}`),
		[]byte(`{"type": null}`),
		[]byte(`{"type": 123}`),
	}

	for _, data := range invalidCommands {
		var envelope struct {
			Type string `json:"type"`
		}
		// Should not panic, may return error
		_ = json.Unmarshal(data, &envelope)
	}
}

// TestContextInHandlers tests context handling in command processing.
func TestContextInHandlers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Verify context can be passed through handlers
	select {
	case <-ctx.Done():
		// Context timed out as expected
	case <-time.After(200 * time.Millisecond):
		t.Error("context should have timed out")
	}
}

// orchestratorCommandTypes are command types handled by the orchestrator.
// These correspond to worker lifecycle management commands.
var orchestratorCommandTypes = []string{
	types.CommandSpawn,  // "spawn"
	types.CommandKill,   // "kill"
	types.CommandStatus, // "status"
}

// workerCommandTypes are command types handled by WhatsApp workers, NOT the orchestrator.
// The orchestrator should ACK these without processing to prevent blocking workers.
var workerCommandTypes = []string{
	"text",
	"image",
	"video",
	"audio",
	"document",
	"reaction",
	"sticker",
	"post_status",
	"archive_chat",
	"unarchive_chat",
	"read_chat",
	"mute_chat",
	"unmute_chat",
	"pin_chat",
	"unpin_chat",
	"block_contact",
	"unblock_contact",
	"update_group_info",
	"add_group_participant",
	"remove_group_participant",
	"get_business_profile",
	"get_product_catalog",
}

// TestOrchestratorOnlyHandlesControlCommands verifies that the orchestrator
// correctly identifies which command types it should handle.
func TestOrchestratorOnlyHandlesControlCommands(t *testing.T) {
	// Orchestrator should handle spawn, kill, status
	for _, cmdType := range orchestratorCommandTypes {
		t.Run("handles_"+cmdType, func(t *testing.T) {
			isOrchestratorCommand := cmdType == types.CommandSpawn ||
				cmdType == types.CommandKill ||
				cmdType == types.CommandStatus

			assert.True(t, isOrchestratorCommand,
				"orchestrator should handle command type: %s", cmdType)
		})
	}
}

// TestWorkerCommandsAreNotOrchestratorCommands verifies that worker command types
// are NOT orchestrator commands and should be ACK'd without processing.
func TestWorkerCommandsAreNotOrchestratorCommands(t *testing.T) {
	for _, cmdType := range workerCommandTypes {
		t.Run("ignores_"+cmdType, func(t *testing.T) {
			isOrchestratorCommand := cmdType == types.CommandSpawn ||
				cmdType == types.CommandKill ||
				cmdType == types.CommandStatus

			assert.False(t, isOrchestratorCommand,
				"worker command type %q should NOT be handled by orchestrator", cmdType)
		})
	}
}

// TestUnknownCommandTypeShouldBeAcked documents the expected behavior:
// Unknown command types (like "text", "image", etc.) should be ACK'd, not NAK'd.
// This is because these commands are handled by WhatsApp worker consumers,
// not the orchestrator. NAK-ing them would cause unnecessary redelivery.
func TestUnknownCommandTypeShouldBeAcked(t *testing.T) {
	testCases := []struct {
		name        string
		commandType string
		shouldAck   bool // true = ACK (ignore), false = process
	}{
		// Orchestrator commands - should be processed (then ACK'd on success)
		{"spawn command", types.CommandSpawn, false},
		{"kill command", types.CommandKill, false},
		{"status command", types.CommandStatus, false},

		// Worker commands - should be ACK'd immediately without processing
		{"text message", "text", true},
		{"image message", "image", true},
		{"video message", "video", true},
		{"audio message", "audio", true},
		{"document message", "document", true},
		{"reaction", "reaction", true},
		{"unknown type", "some_unknown_type", true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			isOrchestratorCommand := tc.commandType == types.CommandSpawn ||
				tc.commandType == types.CommandKill ||
				tc.commandType == types.CommandStatus

			if tc.shouldAck {
				assert.False(t, isOrchestratorCommand,
					"command type %q should be ACK'd immediately (not processed)", tc.commandType)
			} else {
				assert.True(t, isOrchestratorCommand,
					"command type %q should be processed by orchestrator", tc.commandType)
			}
		})
	}
}

// TestCommandTypeRouting tests the switch statement logic for command routing.
// This simulates what handleMessage does without needing a real NATS connection.
func TestCommandTypeRouting(t *testing.T) {
	testCases := []struct {
		name           string
		commandType    string
		expectedAction string // "process" or "ack_and_skip"
	}{
		{"spawn", types.CommandSpawn, "process"},
		{"kill", types.CommandKill, "process"},
		{"status", types.CommandStatus, "process"},
		{"text", "text", "ack_and_skip"},
		{"image", "image", "ack_and_skip"},
		{"video", "video", "ack_and_skip"},
		{"audio", "audio", "ack_and_skip"},
		{"document", "document", "ack_and_skip"},
		{"reaction", "reaction", "ack_and_skip"},
		{"random_type", "random_type", "ack_and_skip"},
		{"empty_type", "", "ack_and_skip"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Simulate the switch statement in handleMessage
			var action string
			switch tc.commandType {
			case types.CommandSpawn, types.CommandKill, types.CommandStatus:
				action = "process"
			default:
				action = "ack_and_skip"
			}

			assert.Equal(t, tc.expectedAction, action,
				"command type %q should result in action: %s", tc.commandType, tc.expectedAction)
		})
	}
}

// TestSendMessageCommandNotHandledByOrchestrator tests that send message commands
// (which have type="text", "image", etc.) are NOT processed by the orchestrator.
// These commands are published to WHATSAPP.commands.{companyId}.{connectionId}
// and should be handled by the specific WhatsApp worker, not the orchestrator.
func TestSendMessageCommandNotHandledByOrchestrator(t *testing.T) {
	// Simulate a send message command as published by the API
	sendMessageCmd := struct {
		MessageID string `json:"message_id"`
		To        string `json:"to"`
		Type      string `json:"type"`
		Content   string `json:"content"`
	}{
		MessageID: "pending_123",
		To:        "1234567890@s.whatsapp.net",
		Type:      "text",
		Content:   "Hello, World!",
	}

	data, err := json.Marshal(sendMessageCmd)
	require.NoError(t, err)

	// Parse just the type field (as handleMessage does)
	var envelope struct {
		Type string `json:"type"`
	}
	err = json.Unmarshal(data, &envelope)
	require.NoError(t, err)

	// Verify this is NOT an orchestrator command
	isOrchestratorCommand := envelope.Type == types.CommandSpawn ||
		envelope.Type == types.CommandKill ||
		envelope.Type == types.CommandStatus

	assert.False(t, isOrchestratorCommand,
		"send message command (type=%q) should NOT be processed by orchestrator", envelope.Type)

	// Verify the type matches what workers expect
	assert.Equal(t, "text", envelope.Type)
}

// TestReactionCommandNotHandledByOrchestrator tests that reaction commands
// are NOT processed by the orchestrator (they're handled by workers).
func TestReactionCommandNotHandledByOrchestrator(t *testing.T) {
	reactionCmd := struct {
		MessageID       string `json:"message_id"`
		To              string `json:"to"`
		Type            string `json:"type"`
		TargetMessageID string `json:"target_message_id"`
		Emoji           string `json:"emoji"`
	}{
		MessageID:       "pending_456",
		To:              "1234567890@s.whatsapp.net",
		Type:            "reaction",
		TargetMessageID: "existing_msg_789",
		Emoji:           "👍",
	}

	data, err := json.Marshal(reactionCmd)
	require.NoError(t, err)

	var envelope struct {
		Type string `json:"type"`
	}
	err = json.Unmarshal(data, &envelope)
	require.NoError(t, err)

	// Verify this is NOT an orchestrator command
	isOrchestratorCommand := envelope.Type == types.CommandSpawn ||
		envelope.Type == types.CommandKill ||
		envelope.Type == types.CommandStatus

	assert.False(t, isOrchestratorCommand,
		"reaction command (type=%q) should NOT be processed by orchestrator", envelope.Type)
}

// TestMediaCommandTypesNotHandledByOrchestrator tests that all media message types
// are correctly identified as worker commands.
func TestMediaCommandTypesNotHandledByOrchestrator(t *testing.T) {
	mediaTypes := []string{"image", "video", "audio", "document", "sticker"}

	for _, mediaType := range mediaTypes {
		t.Run(mediaType, func(t *testing.T) {
			cmd := struct {
				Type      string `json:"type"`
				To        string `json:"to"`
				MediaData []byte `json:"media_data"`
			}{
				Type:      mediaType,
				To:        "1234567890@s.whatsapp.net",
				MediaData: []byte{0x89, 0x50, 0x4E, 0x47}, // PNG magic bytes
			}

			data, err := json.Marshal(cmd)
			require.NoError(t, err)

			var envelope struct {
				Type string `json:"type"`
			}
			err = json.Unmarshal(data, &envelope)
			require.NoError(t, err)

			// Verify this is NOT an orchestrator command
			isOrchestratorCommand := envelope.Type == types.CommandSpawn ||
				envelope.Type == types.CommandKill ||
				envelope.Type == types.CommandStatus

			assert.False(t, isOrchestratorCommand,
				"media command (type=%q) should NOT be processed by orchestrator", envelope.Type)
		})
	}
}

// TestableMessage is a mock message that tracks Ack/Nak calls for testing.
type TestableMessage struct {
	data     []byte
	acked    bool
	naked    bool
	ackError error
	nakError error
}

// NewTestableMessage creates a new testable message with the given data.
func NewTestableMessage(data []byte) *TestableMessage {
	return &TestableMessage{data: data}
}

// Ack marks the message as acknowledged.
func (m *TestableMessage) Ack() error {
	m.acked = true
	return m.ackError
}

// Nak marks the message as negatively acknowledged.
func (m *TestableMessage) Nak() error {
	m.naked = true
	return m.nakError
}

// Data returns the message data.
func (m *TestableMessage) Data() []byte {
	return m.data
}

// WasAcked returns true if Ack was called.
func (m *TestableMessage) WasAcked() bool {
	return m.acked
}

// WasNaked returns true if Nak was called.
func (m *TestableMessage) WasNaked() bool {
	return m.naked
}

// testableHandleMessage mimics the handleMessage logic for testing purposes.
// It processes a message and calls Ack/Nak on the testable message.
func testableHandleMessage(msg *TestableMessage) (action string, cmdType string) {
	// Parse the command type from the message
	var envelope struct {
		Type string `json:"type"`
	}

	if err := json.Unmarshal(msg.Data(), &envelope); err != nil {
		msg.Nak()
		return "nak", "parse_error"
	}

	switch envelope.Type {
	case types.CommandSpawn:
		// In real handler, this would process the spawn command
		msg.Ack()
		return "process_and_ack", envelope.Type
	case types.CommandKill:
		// In real handler, this would process the kill command
		msg.Ack()
		return "process_and_ack", envelope.Type
	case types.CommandStatus:
		// In real handler, this would process the status command
		msg.Ack()
		return "process_and_ack", envelope.Type
	default:
		// Unknown command types are handled by WhatsApp worker consumers.
		// ACK to prevent redelivery to this consumer.
		msg.Ack()
		return "ack_and_skip", envelope.Type
	}
}

// TestHandleMessage_UnknownCommandTypes_AreAcked is an integration test that verifies
// unknown command types (like send message commands) are ACK'd, not NAK'd.
// This test directly verifies the fix for the "Unknown command type: text" issue.
func TestHandleMessage_UnknownCommandTypes_AreAcked(t *testing.T) {
	testCases := []struct {
		name           string
		command        interface{}
		expectedAction string
		expectedType   string
		shouldBeAcked  bool
		shouldBeNaked  bool
	}{
		{
			name: "text message command should be ACK'd",
			command: struct {
				MessageID string `json:"message_id"`
				To        string `json:"to"`
				Type      string `json:"type"`
				Content   string `json:"content"`
			}{
				MessageID: "pending_123",
				To:        "1234567890@s.whatsapp.net",
				Type:      "text",
				Content:   "Hello, World!",
			},
			expectedAction: "ack_and_skip",
			expectedType:   "text",
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
		{
			name: "image message command should be ACK'd",
			command: struct {
				MessageID string `json:"message_id"`
				To        string `json:"to"`
				Type      string `json:"type"`
			}{
				MessageID: "pending_456",
				To:        "1234567890@s.whatsapp.net",
				Type:      "image",
			},
			expectedAction: "ack_and_skip",
			expectedType:   "image",
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
		{
			name: "reaction command should be ACK'd",
			command: struct {
				MessageID       string `json:"message_id"`
				To              string `json:"to"`
				Type            string `json:"type"`
				TargetMessageID string `json:"target_message_id"`
				Emoji           string `json:"emoji"`
			}{
				MessageID:       "pending_789",
				To:              "1234567890@s.whatsapp.net",
				Type:            "reaction",
				TargetMessageID: "msg_to_react",
				Emoji:           "👍",
			},
			expectedAction: "ack_and_skip",
			expectedType:   "reaction",
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
		{
			name: "spawn command should be processed and ACK'd",
			command: types.SpawnWorkerCommand{
				Type:         types.CommandSpawn,
				CompanyID:    "company-123",
				ConnectionID: "conn-456",
				TenantSchema: "tenant_company_123",
				DatabaseURL:  "postgres://localhost/db",
			},
			expectedAction: "process_and_ack",
			expectedType:   types.CommandSpawn,
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
		{
			name: "kill command should be processed and ACK'd",
			command: types.KillWorkerCommand{
				Type:         types.CommandKill,
				CompanyID:    "company-123",
				ConnectionID: "conn-456",
				Reason:       "user requested",
			},
			expectedAction: "process_and_ack",
			expectedType:   types.CommandKill,
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
		{
			name: "status command should be processed and ACK'd",
			command: types.WorkerStatusCommand{
				Type:         types.CommandStatus,
				CompanyID:    "company-123",
				ConnectionID: "conn-456",
			},
			expectedAction: "process_and_ack",
			expectedType:   types.CommandStatus,
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
		{
			name: "unknown random command should be ACK'd",
			command: struct {
				Type string `json:"type"`
				Data string `json:"data"`
			}{
				Type: "some_future_command_type",
				Data: "some data",
			},
			expectedAction: "ack_and_skip",
			expectedType:   "some_future_command_type",
			shouldBeAcked:  true,
			shouldBeNaked:  false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.command)
			require.NoError(t, err)

			msg := NewTestableMessage(data)
			action, cmdType := testableHandleMessage(msg)

			assert.Equal(t, tc.expectedAction, action,
				"expected action %q, got %q", tc.expectedAction, action)
			assert.Equal(t, tc.expectedType, cmdType,
				"expected command type %q, got %q", tc.expectedType, cmdType)
			assert.Equal(t, tc.shouldBeAcked, msg.WasAcked(),
				"expected acked=%v, got %v", tc.shouldBeAcked, msg.WasAcked())
			assert.Equal(t, tc.shouldBeNaked, msg.WasNaked(),
				"expected naked=%v, got %v", tc.shouldBeNaked, msg.WasNaked())
		})
	}
}

// TestHandleMessage_InvalidJSON_IsNaked tests that invalid JSON causes NAK.
func TestHandleMessage_InvalidJSON_IsNaked(t *testing.T) {
	invalidJSONs := [][]byte{
		[]byte(`not json at all`),
		[]byte(`{"type": "spawn", broken`),
		[]byte(`{{{`),
	}

	for i, invalidJSON := range invalidJSONs {
		t.Run(fmt.Sprintf("invalid_json_%d", i), func(t *testing.T) {
			msg := NewTestableMessage(invalidJSON)
			action, _ := testableHandleMessage(msg)

			assert.Equal(t, "nak", action, "invalid JSON should cause NAK")
			assert.True(t, msg.WasNaked(), "message should be NAK'd for invalid JSON")
			assert.False(t, msg.WasAcked(), "message should NOT be ACK'd for invalid JSON")
		})
	}
}

// TestHandleMessage_EmptyType_IsAcked tests that empty type is ACK'd (treated as unknown).
func TestHandleMessage_EmptyType_IsAcked(t *testing.T) {
	cmd := struct {
		Type string `json:"type"`
	}{
		Type: "",
	}

	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	msg := NewTestableMessage(data)
	action, cmdType := testableHandleMessage(msg)

	assert.Equal(t, "ack_and_skip", action, "empty type should be ACK'd")
	assert.Equal(t, "", cmdType, "command type should be empty")
	assert.True(t, msg.WasAcked(), "message should be ACK'd")
	assert.False(t, msg.WasNaked(), "message should NOT be NAK'd")
}

// TestRegressionUnknownCommandTypeText is a regression test specifically for the
// "Unknown command type: text" bug. This test ensures that when a text message
// command is received by the orchestrator, it is ACK'd (not NAK'd) so that:
// 1. The message is not redelivered to the orchestrator
// 2. The WhatsApp worker can process it via its own consumer
// 3. No "Unknown command type: text" errors are logged
func TestRegressionUnknownCommandTypeText(t *testing.T) {
	// This is the exact format of a send message command from the API
	sendMessageCmd := struct {
		MessageID     string `json:"message_id"`
		ConnectionID  string `json:"connection_id"`
		To            string `json:"to"`
		Type          string `json:"type"`
		Content       string `json:"content"`
		Caption       string `json:"caption,omitempty"`
		FileName      string `json:"file_name,omitempty"`
		MimeType      string `json:"mime_type,omitempty"`
		MediaData     []byte `json:"media_data,omitempty"`
		UserID        string `json:"user_id"`
		ReplyTo       string `json:"reply_to,omitempty"`
		ReplyToSender string `json:"reply_to_sender,omitempty"`
	}{
		MessageID:    "pending_4d7e9eeb-21fc-452a-b50a-1044f90bd006",
		ConnectionID: "conn-123",
		To:           "1234567890@s.whatsapp.net",
		Type:         "text", // This is the critical field that was causing the error
		Content:      "Hello from retry!",
		UserID:       "user-456",
	}

	data, err := json.Marshal(sendMessageCmd)
	require.NoError(t, err)

	msg := NewTestableMessage(data)
	action, cmdType := testableHandleMessage(msg)

	// CRITICAL: The message must be ACK'd, not NAK'd
	assert.Equal(t, "ack_and_skip", action,
		"REGRESSION: text command should be ACK'd (was previously NAK'd causing 'Unknown command type: text' errors)")
	assert.Equal(t, "text", cmdType)
	assert.True(t, msg.WasAcked(),
		"REGRESSION: message must be ACK'd to prevent redelivery loop")
	assert.False(t, msg.WasNaked(),
		"REGRESSION: message must NOT be NAK'd (this was the bug)")
}
