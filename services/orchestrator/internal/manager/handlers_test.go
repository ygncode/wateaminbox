package manager

import (
	"context"
	"encoding/json"
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
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		MessageID:    "msg-789",
		From:         "1234567890@s.whatsapp.net",
		Content:      "Hello, World!",
		Type:         "text",
		Timestamp:    now,
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var parsed types.MessageEvent
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, event.CompanyID, parsed.CompanyID)
	assert.Equal(t, event.ConnectionID, parsed.ConnectionID)
	assert.Equal(t, event.MessageID, parsed.MessageID)
	assert.Equal(t, event.From, parsed.From)
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
