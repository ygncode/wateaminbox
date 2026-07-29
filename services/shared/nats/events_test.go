package nats

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestEventTypeConstants(t *testing.T) {
	// Ensure event type constants are not empty
	eventTypes := []struct {
		name  string
		value string
	}{
		{"EventTypeQR", EventTypeQR},
		{"EventTypeConnected", EventTypeConnected},
		{"EventTypeDisconnected", EventTypeDisconnected},
		{"EventTypeMessage", EventTypeMessage},
		{"EventTypeReceipt", EventTypeReceipt},
		{"EventTypePresence", EventTypePresence},
		{"EventTypeContact", EventTypeContact},
		{"EventTypeProfilePicture", EventTypeProfilePicture},
		{"EventTypeMessageRevoke", EventTypeMessageRevoke},
		{"EventTypeSendConfirm", EventTypeSendConfirm},
		{"EventTypeTyping", EventTypeTyping},
		{"EventTypeReaction", EventTypeReaction},
		{"EventTypeSyncStatus", EventTypeSyncStatus},
		{"EventTypeDownloadResp", EventTypeDownloadResp},
	}

	for _, tt := range eventTypes {
		t.Run(tt.name, func(t *testing.T) {
			if tt.value == "" {
				t.Errorf("%s should not be empty", tt.name)
			}
		})
	}
}

func TestContactPayloadAlwaysSerializesUnreadSnapshot(t *testing.T) {
	unreadCount := 0
	data, err := json.Marshal(ContactPayload{
		JID:         "123@g.us",
		IsGroup:     true,
		UnreadCount: &unreadCount,
		Participants: []GroupParticipantPayload{
			{JID: "1@s.whatsapp.net", IsAdmin: true},
		},
	})
	if err != nil {
		t.Fatalf("failed to marshal contact payload: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("failed to unmarshal contact payload: %v", err)
	}
	if unread, ok := payload["unreadCount"]; !ok || unread != float64(0) {
		t.Fatalf("expected an explicit zero unread snapshot, got %#v", payload["unreadCount"])
	}
	participants, ok := payload["participants"].([]any)
	if !ok || len(participants) != 1 {
		t.Fatalf("expected one serialized group participant, got %#v", payload["participants"])
	}
}

func TestGroupMetadataCanRefreshWithoutResettingUnread(t *testing.T) {
	participantCount := 42
	data, err := json.Marshal(ContactPayload{
		JID:              "123@g.us",
		IsGroup:          true,
		ParticipantCount: &participantCount,
	})
	if err != nil {
		t.Fatalf("failed to marshal group metadata: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("failed to unmarshal group metadata: %v", err)
	}
	if _, exists := payload["unreadCount"]; exists {
		t.Fatalf("metadata-only refresh must not reset unread state: %#v", payload)
	}
	if payload["participantCount"] != float64(42) {
		t.Fatalf("expected participant count snapshot, got %#v", payload["participantCount"])
	}
}

func TestCommandTypeConstants(t *testing.T) {
	if CommandSpawn != "spawn" {
		t.Errorf("CommandSpawn = %q, want 'spawn'", CommandSpawn)
	}
	if CommandKill != "kill" {
		t.Errorf("CommandKill = %q, want 'kill'", CommandKill)
	}
	if CommandStatus != "status" {
		t.Errorf("CommandStatus = %q, want 'status'", CommandStatus)
	}
}

func TestStatusConstants(t *testing.T) {
	statuses := []struct {
		name  string
		value string
		want  string
	}{
		{"StatusStarting", StatusStarting, "starting"},
		{"StatusConnecting", StatusConnecting, "connecting"},
		{"StatusConnected", StatusConnected, "connected"},
		{"StatusDisconnected", StatusDisconnected, "disconnected"},
		{"StatusStopping", StatusStopping, "stopping"},
		{"StatusStopped", StatusStopped, "stopped"},
		{"StatusError", StatusError, "error"},
	}

	for _, tt := range statuses {
		t.Run(tt.name, func(t *testing.T) {
			if tt.value != tt.want {
				t.Errorf("%s = %q, want %q", tt.name, tt.value, tt.want)
			}
		})
	}
}

func TestWhatsAppEventSerialization(t *testing.T) {
	event := WhatsAppEvent{
		Type:         EventTypeMessage,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Payload: MessagePayload{
			MessageID:   "msg-789",
			From:        "1234567890@s.whatsapp.net",
			To:          "0987654321@s.whatsapp.net",
			FromMe:      true,
			Content:     "Hello, World!",
			MessageType: "text",
			Timestamp:   "2024-01-15T12:00:00Z",
		},
		Timestamp: "2024-01-15T12:00:00Z",
	}

	// Serialize
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal WhatsAppEvent: %v", err)
	}

	// Check JSON structure
	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal to map: %v", err)
	}

	if parsed["type"] != EventTypeMessage {
		t.Errorf("type = %v, want %v", parsed["type"], EventTypeMessage)
	}
	if parsed["companyId"] != "company-123" {
		t.Errorf("companyId = %v, want 'company-123'", parsed["companyId"])
	}
	if parsed["connectionId"] != "conn-456" {
		t.Errorf("connectionId = %v, want 'conn-456'", parsed["connectionId"])
	}

	// Verify payload structure
	payload, ok := parsed["payload"].(map[string]interface{})
	if !ok {
		t.Fatal("payload should be a map")
	}
	if payload["messageId"] != "msg-789" {
		t.Errorf("payload.messageId = %v, want 'msg-789'", payload["messageId"])
	}
}

func TestMessagePayloadSerialization(t *testing.T) {
	payload := MessagePayload{
		MessageID:         "msg-123",
		From:              "1234567890@s.whatsapp.net",
		To:                "0987654321@s.whatsapp.net",
		FromMe:            false,
		Content:           "Test message",
		MessageType:       "text",
		Timestamp:         "2024-01-15T12:00:00Z",
		MediaURL:          "https://example.com/media.jpg",
		QuotedMessageID:   "msg-100",
		IsGroup:           true,
		GroupID:           "group-456",
		SenderName:        "John Doe",
		ProtocolSenderJID: "48954691608613@lid",
		Caption:           "Photo caption",
		FileName:          "document.pdf",
		MediaType:         "image/jpeg",
		MediaSize:         1024,
		IsHistorySync:     true,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal MessagePayload: %v", err)
	}

	var parsed MessagePayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal MessagePayload: %v", err)
	}

	if parsed.MessageID != payload.MessageID {
		t.Errorf("MessageID = %v, want %v", parsed.MessageID, payload.MessageID)
	}
	if parsed.From != payload.From {
		t.Errorf("From = %v, want %v", parsed.From, payload.From)
	}
	if parsed.FromMe != payload.FromMe {
		t.Errorf("FromMe = %v, want %v", parsed.FromMe, payload.FromMe)
	}
	if parsed.IsGroup != payload.IsGroup {
		t.Errorf("IsGroup = %v, want %v", parsed.IsGroup, payload.IsGroup)
	}
	if parsed.MediaSize != payload.MediaSize {
		t.Errorf("MediaSize = %v, want %v", parsed.MediaSize, payload.MediaSize)
	}
	if parsed.ProtocolSenderJID != payload.ProtocolSenderJID {
		t.Errorf("ProtocolSenderJID = %v, want %v", parsed.ProtocolSenderJID, payload.ProtocolSenderJID)
	}
}

func TestQRPayloadSerialization(t *testing.T) {
	payload := QRPayload{
		QRCode:    "base64encodedqrcode",
		ExpiresAt: "2024-01-15T12:05:00Z",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal QRPayload: %v", err)
	}

	var parsed QRPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal QRPayload: %v", err)
	}

	if parsed.QRCode != payload.QRCode {
		t.Errorf("QRCode = %v, want %v", parsed.QRCode, payload.QRCode)
	}
	if parsed.ExpiresAt != payload.ExpiresAt {
		t.Errorf("ExpiresAt = %v, want %v", parsed.ExpiresAt, payload.ExpiresAt)
	}
}

func TestConnectionPayloadSerialization(t *testing.T) {
	payload := ConnectionPayload{
		PhoneNumber: "+1234567890",
		JID:         "1234567890@s.whatsapp.net",
		Reason:      "user_logout",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal ConnectionPayload: %v", err)
	}

	var parsed ConnectionPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal ConnectionPayload: %v", err)
	}

	if parsed.PhoneNumber != payload.PhoneNumber {
		t.Errorf("PhoneNumber = %v, want %v", parsed.PhoneNumber, payload.PhoneNumber)
	}
	if parsed.JID != payload.JID {
		t.Errorf("JID = %v, want %v", parsed.JID, payload.JID)
	}
}

func TestReceiptPayloadSerialization(t *testing.T) {
	payload := ReceiptPayload{
		MessageID: "msg-123",
		Status:    "read",
		Timestamp: "2024-01-15T12:00:00Z",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal ReceiptPayload: %v", err)
	}

	var parsed ReceiptPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal ReceiptPayload: %v", err)
	}

	if parsed.MessageID != payload.MessageID {
		t.Errorf("MessageID = %v, want %v", parsed.MessageID, payload.MessageID)
	}
	if parsed.Status != payload.Status {
		t.Errorf("Status = %v, want %v", parsed.Status, payload.Status)
	}
}

func TestTypingPayloadSerialization(t *testing.T) {
	payload := TypingPayload{
		From:      "1234567890@s.whatsapp.net",
		ChatJID:   "0987654321@s.whatsapp.net",
		IsTyping:  true,
		MediaType: "text",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal TypingPayload: %v", err)
	}

	var parsed TypingPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal TypingPayload: %v", err)
	}

	if parsed.From != payload.From {
		t.Errorf("From = %v, want %v", parsed.From, payload.From)
	}
	if parsed.IsTyping != payload.IsTyping {
		t.Errorf("IsTyping = %v, want %v", parsed.IsTyping, payload.IsTyping)
	}
}

func TestReactionPayloadSerialization(t *testing.T) {
	payload := ReactionPayload{
		MessageID: "msg-123",
		From:      "1234567890@s.whatsapp.net",
		ChatJID:   "0987654321@s.whatsapp.net",
		Emoji:     "👍",
		Timestamp: "2024-01-15T12:00:00Z",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal ReactionPayload: %v", err)
	}

	var parsed ReactionPayload
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal ReactionPayload: %v", err)
	}

	if parsed.Emoji != payload.Emoji {
		t.Errorf("Emoji = %v, want %v", parsed.Emoji, payload.Emoji)
	}
	if parsed.MessageID != payload.MessageID {
		t.Errorf("MessageID = %v, want %v", parsed.MessageID, payload.MessageID)
	}
}

func TestSpawnWorkerCommandSerialization(t *testing.T) {
	cmd := SpawnWorkerCommand{
		Type:         CommandSpawn,
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		TenantSchema: "tenant_company_123",
		DatabaseURL:  "postgres://localhost/db",
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		t.Fatalf("Failed to marshal SpawnWorkerCommand: %v", err)
	}

	var parsed SpawnWorkerCommand
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal SpawnWorkerCommand: %v", err)
	}

	if parsed.Type != cmd.Type {
		t.Errorf("Type = %v, want %v", parsed.Type, cmd.Type)
	}
	if parsed.CompanyID != cmd.CompanyID {
		t.Errorf("CompanyID = %v, want %v", parsed.CompanyID, cmd.CompanyID)
	}
	if parsed.TenantSchema != cmd.TenantSchema {
		t.Errorf("TenantSchema = %v, want %v", parsed.TenantSchema, cmd.TenantSchema)
	}
}

func TestWorkerStatusResponseSerialization(t *testing.T) {
	now := time.Now()
	resp := WorkerStatusResponse{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Status:       StatusConnected,
		ConnectedAt:  now,
		LastActivity: now.Add(-5 * time.Minute),
		PID:          12345,
		Error:        "",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal WorkerStatusResponse: %v", err)
	}

	var parsed WorkerStatusResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal WorkerStatusResponse: %v", err)
	}

	if parsed.Status != resp.Status {
		t.Errorf("Status = %v, want %v", parsed.Status, resp.Status)
	}
	if parsed.PID != resp.PID {
		t.Errorf("PID = %v, want %v", parsed.PID, resp.PID)
	}
}

func TestMessageEventSerialization(t *testing.T) {
	now := time.Now()
	event := MessageEvent{
		MessageID:       "msg-123",
		From:            "1234567890@s.whatsapp.net",
		To:              "0987654321@s.whatsapp.net",
		FromMe:          true,
		Type:            "text",
		Content:         "Hello",
		IsGroup:         false,
		Timestamp:       now,
		QuotedMessageID: "msg-100",
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal MessageEvent: %v", err)
	}

	var parsed MessageEvent
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal MessageEvent: %v", err)
	}

	if parsed.MessageID != event.MessageID {
		t.Errorf("MessageID = %v, want %v", parsed.MessageID, event.MessageID)
	}
	if parsed.FromMe != event.FromMe {
		t.Errorf("FromMe = %v, want %v", parsed.FromMe, event.FromMe)
	}
	if parsed.Type != event.Type {
		t.Errorf("Type = %v, want %v", parsed.Type, event.Type)
	}
}

func TestConnectionStatusEventSerialization(t *testing.T) {
	now := time.Now()
	event := ConnectionStatusEvent{
		CompanyID:    "company-123",
		ConnectionID: "conn-456",
		Status:       StatusConnected,
		Reason:       "initial_connect",
		Timestamp:    now,
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal ConnectionStatusEvent: %v", err)
	}

	var parsed ConnectionStatusEvent
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal ConnectionStatusEvent: %v", err)
	}

	if parsed.Status != event.Status {
		t.Errorf("Status = %v, want %v", parsed.Status, event.Status)
	}
	if parsed.Reason != event.Reason {
		t.Errorf("Reason = %v, want %v", parsed.Reason, event.Reason)
	}
}

func TestDownloadRequestSerialization(t *testing.T) {
	req := DownloadRequest{
		MessageID:     "msg-123",
		DirectPath:    "/path/to/media",
		MediaKey:      []byte("mediakey"),
		FileSHA256:    []byte("sha256hash"),
		FileEncSHA256: []byte("encsha256hash"),
		MediaType:     "image/jpeg",
		FileName:      "photo.jpg",
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("Failed to marshal DownloadRequest: %v", err)
	}

	var parsed DownloadRequest
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal DownloadRequest: %v", err)
	}

	if parsed.MessageID != req.MessageID {
		t.Errorf("MessageID = %v, want %v", parsed.MessageID, req.MessageID)
	}
	if parsed.DirectPath != req.DirectPath {
		t.Errorf("DirectPath = %v, want %v", parsed.DirectPath, req.DirectPath)
	}
	if parsed.MediaType != req.MediaType {
		t.Errorf("MediaType = %v, want %v", parsed.MediaType, req.MediaType)
	}
}

func TestSharedMessageEventFixture(t *testing.T) {
	data, err := os.ReadFile("testdata/message-event-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var event WhatsAppEvent
	if err := json.Unmarshal(data, &event); err != nil {
		t.Fatal(err)
	}
	if event.ContractVersion != ContractVersion || event.Type != EventTypeMessage {
		t.Fatalf("unexpected fixture envelope: %+v", event)
	}
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		t.Fatal(err)
	}
	var message MessagePayload
	if err := json.Unmarshal(payload, &message); err != nil {
		t.Fatal(err)
	}
	if message.MessageID != "wa-message-1" {
		t.Fatalf("unexpected fixture message: %+v", message)
	}
}

func TestDownloadResponsePayloadSerialization(t *testing.T) {
	tests := []struct {
		name    string
		payload DownloadResponsePayload
	}{
		{
			name: "successful download",
			payload: DownloadResponsePayload{
				MessageID: "msg-123",
				MediaURL:  "https://cdn.example.com/media.jpg",
				MediaSize: 1048576,
				Success:   true,
				Error:     "",
			},
		},
		{
			name: "failed download",
			payload: DownloadResponsePayload{
				MessageID: "msg-123",
				MediaURL:  "",
				MediaSize: 0,
				Success:   false,
				Error:     "media not found",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			var parsed DownloadResponsePayload
			if err := json.Unmarshal(data, &parsed); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			if parsed.Success != tt.payload.Success {
				t.Errorf("Success = %v, want %v", parsed.Success, tt.payload.Success)
			}
			if parsed.Error != tt.payload.Error {
				t.Errorf("Error = %v, want %v", parsed.Error, tt.payload.Error)
			}
		})
	}
}
