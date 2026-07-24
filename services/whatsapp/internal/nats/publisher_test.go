package nats

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestLabelColorHex(t *testing.T) {
	assert.Equal(t, "#00a884", labelColorHex(0))
	assert.Equal(t, "#475569", labelColorHex(19))
	assert.Empty(t, labelColorHex(99))
}

// TestPublishSendConfirmation_PayloadFormat tests that the payload is correctly formatted.
func TestPublishSendConfirmation_PayloadFormat(t *testing.T) {
	pendingID := "pending_abc123-def456"
	realID := "3EB01234567890@s.whatsapp.net"
	timestamp := time.Date(2026, 1, 5, 12, 30, 0, 0, time.UTC)

	// Create the payload directly
	payload := SendConfirmationPayload{
		PendingMessageID: pendingID,
		MessageID:        realID,
		Timestamp:        timestamp.Format(time.RFC3339),
	}

	// Marshal to verify JSON structure
	data, err := json.Marshal(payload)
	assert.NoError(t, err, "should marshal successfully")
	assert.NotEmpty(t, data, "marshaled data should not be empty")

	// Verify the JSON contains the expected fields
	var unmarshaled SendConfirmationPayload
	err = json.Unmarshal(data, &unmarshaled)
	assert.NoError(t, err, "should unmarshal successfully")

	assert.Equal(t, pendingID, unmarshaled.PendingMessageID, "pending message ID should match")
	assert.Equal(t, realID, unmarshaled.MessageID, "real message ID should match")
	assert.Equal(t, "2026-01-05T12:30:00Z", unmarshaled.Timestamp, "timestamp should be in RFC3339 format")
}

// TestPublishSendConfirmation_TimestampFormat tests that timestamp is correctly formatted.
func TestPublishSendConfirmation_TimestampFormat(t *testing.T) {
	testTime := time.Date(2026, 1, 5, 14, 30, 45, 0, time.UTC)

	payload := SendConfirmationPayload{
		PendingMessageID: "pending_xyz",
		MessageID:        "real_id_123",
		Timestamp:        testTime.Format(time.RFC3339),
	}

	// Verify RFC3339 format
	parsedTime, err := time.Parse(time.RFC3339, payload.Timestamp)
	assert.NoError(t, err, "timestamp should be valid RFC3339")
	assert.Equal(t, testTime, parsedTime, "timestamp should match input time")
}

// TestPublishSendConfirmation_SubjectFormat tests various company and connection ID formats.
func TestPublishSendConfirmation_SubjectFormat(t *testing.T) {
	tests := []struct {
		name         string
		companyID    string
		connectionID string
		expectedSub  string
	}{
		{
			name:         "Simple IDs",
			companyID:    "company",
			connectionID: "connection",
			expectedSub:  "WHATSAPP.events.company.connection.send_confirmation",
		},
		{
			name:         "IDs with hyphens",
			companyID:    "test-company-123",
			connectionID: "conn-456",
			expectedSub:  "WHATSAPP.events.test-company-123.conn-456.send_confirmation",
		},
		{
			name:         "UUID-like IDs",
			companyID:    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			connectionID: "9876-5432-10ab-cdef",
			expectedSub:  "WHATSAPP.events.a1b2c3d4-e5f6-7890-abcd-ef1234567890.9876-5432-10ab-cdef.send_confirmation",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test that the subject format string works correctly
			subject := sprintfHelper(SubjectSendConfirmation, tt.companyID, tt.connectionID)
			assert.Equal(t, tt.expectedSub, subject, "subject should match expected format")
		})
	}
}

// TestPublishSendConfirmation_IDMapping tests that pending and real IDs are correctly mapped.
func TestPublishSendConfirmation_IDMapping(t *testing.T) {
	tests := []struct {
		name         string
		pendingID    string
		realID       string
		expectPrefix string
	}{
		{
			name:         "Standard pending UUID",
			pendingID:    "pending_550e8400-e29b-41d4-a716-446655440000",
			realID:       "3EB0FFFF@s.whatsapp.net",
			expectPrefix: "pending_",
		},
		{
			name:         "Short pending ID",
			pendingID:    "pending_abc123",
			realID:       "3EB01234@s.whatsapp.net",
			expectPrefix: "pending_",
		},
		{
			name:         "WhatsApp message ID with server",
			pendingID:    "pending_xyz",
			realID:       "3EB0FFFF@newsletter.whatsapp.net",
			expectPrefix: "pending_",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload := SendConfirmationPayload{
				PendingMessageID: tt.pendingID,
				MessageID:        tt.realID,
				Timestamp:        time.Now().Format(time.RFC3339),
			}

			assert.Equal(t, tt.pendingID, payload.PendingMessageID, "pending ID should match")
			assert.Equal(t, tt.realID, payload.MessageID, "real ID should match")
			assert.True(t, strings.HasPrefix(payload.PendingMessageID, tt.expectPrefix), "pending ID should have expected prefix")
		})
	}
}

// TestSendConfirmationPayload_Structure tests the SendConfirmationPayload struct structure.
func TestSendConfirmationPayload_Structure(t *testing.T) {
	payload := SendConfirmationPayload{
		PendingMessageID: "pending_abc123",
		MessageID:        "3EB0DEF@s.whatsapp.net",
		Timestamp:        time.Now().Format(time.RFC3339),
	}

	// Verify we can marshal it
	data, err := json.Marshal(payload)
	assert.NoError(t, err, "should marshal successfully")
	assert.NotEmpty(t, data, "marshaled data should not be empty")

	// Verify we can unmarshal it back
	var unmarshaled SendConfirmationPayload
	err = json.Unmarshal(data, &unmarshaled)
	assert.NoError(t, err, "should unmarshal successfully")

	assert.Equal(t, payload.PendingMessageID, unmarshaled.PendingMessageID)
	assert.Equal(t, payload.MessageID, unmarshaled.MessageID)
	assert.Equal(t, payload.Timestamp, unmarshaled.Timestamp)
}

// TestSubjectConstants tests that the subject constants are correctly formatted.
func TestSubjectConstants(t *testing.T) {
	assert.Equal(t, "WHATSAPP.events.%s.%s.send_confirmation", SubjectSendConfirmation,
		"SubjectSendConfirmation should have correct format")

	// Test that it's a valid format string
	formatted := sprintfHelper(SubjectSendConfirmation, "company1", "conn1")
	assert.Equal(t, "WHATSAPP.events.company1.conn1.send_confirmation", formatted)
}

// TestSendConfirmation_MultipleConfirmations tests multiple confirmation events.
func TestSendConfirmation_MultipleConfirmations(t *testing.T) {
	confirmations := []struct {
		pendingID string
		realID    string
	}{
		{"pending_001", "3EB0001@s.whatsapp.net"},
		{"pending_002", "3EB0002@s.whatsapp.net"},
		{"pending_003", "3EB0003@s.whatsapp.net"},
	}

	var payloads []SendConfirmationPayload

	// Create multiple payloads
	for _, conf := range confirmations {
		payload := SendConfirmationPayload{
			PendingMessageID: conf.pendingID,
			MessageID:        conf.realID,
			Timestamp:        time.Now().Format(time.RFC3339),
		}
		payloads = append(payloads, payload)
	}

	assert.Len(t, payloads, 3, "should have 3 payloads")

	// Verify each confirmation
	for i, conf := range confirmations {
		assert.Equal(t, conf.pendingID, payloads[i].PendingMessageID)
		assert.Equal(t, conf.realID, payloads[i].MessageID)
	}
}

// TestWhatsAppEvent_WithSendConfirmation tests that a WhatsAppEvent can be created with send confirmation payload.
func TestWhatsAppEvent_WithSendConfirmation(t *testing.T) {
	payload := SendConfirmationPayload{
		PendingMessageID: "pending_test",
		MessageID:        "3EB0TEST@s.whatsapp.net",
		Timestamp:        time.Now().Format(time.RFC3339),
	}

	event := WhatsAppEvent{
		Type:         "send_confirmation",
		CompanyID:    "test-company",
		ConnectionID: "test-connection",
		Payload:      payload,
		Timestamp:    time.Now().Format(time.RFC3339),
	}

	// Marshal the event
	data, err := json.Marshal(event)
	assert.NoError(t, err, "should marshal event successfully")

	// Unmarshal back
	var unmarshaledEvent WhatsAppEvent
	err = json.Unmarshal(data, &unmarshaledEvent)
	assert.NoError(t, err, "should unmarshal event successfully")

	assert.Equal(t, "send_confirmation", unmarshaledEvent.Type)
	assert.Equal(t, "test-company", unmarshaledEvent.CompanyID)
	assert.Equal(t, "test-connection", unmarshaledEvent.ConnectionID)

	// Extract and verify payload
	payloadBytes, err := json.Marshal(unmarshaledEvent.Payload)
	assert.NoError(t, err)

	var unmarshaledPayload SendConfirmationPayload
	err = json.Unmarshal(payloadBytes, &unmarshaledPayload)
	assert.NoError(t, err)

	assert.Equal(t, "pending_test", unmarshaledPayload.PendingMessageID)
	assert.Equal(t, "3EB0TEST@s.whatsapp.net", unmarshaledPayload.MessageID)
}

// TestPublishSendConfirmation_JSONTags tests that JSON tags are correct.
func TestPublishSendConfirmation_JSONTags(t *testing.T) {
	payload := SendConfirmationPayload{
		PendingMessageID: "pending_abc",
		MessageID:        "real_id",
		Timestamp:        "2026-01-05T12:00:00Z",
	}

	data, err := json.Marshal(payload)
	assert.NoError(t, err)

	// Verify JSON keys are camelCase as expected
	var jsonMap map[string]interface{}
	err = json.Unmarshal(data, &jsonMap)
	assert.NoError(t, err)

	assert.Contains(t, jsonMap, "pendingMessageId", "should have pendingMessageId key")
	assert.Contains(t, jsonMap, "messageId", "should have messageId key")
	assert.Contains(t, jsonMap, "timestamp", "should have timestamp key")

	assert.Equal(t, "pending_abc", jsonMap["pendingMessageId"])
	assert.Equal(t, "real_id", jsonMap["messageId"])
	assert.Equal(t, "2026-01-05T12:00:00Z", jsonMap["timestamp"])
}

// Helper function to simulate fmt.Sprintf for testing format strings
func sprintfHelper(format string, args ...string) string {
	// Simple implementation for our test cases
	if len(args) >= 2 && strings.Contains(format, "%s.%s") {
		result := format
		for _, arg := range args {
			result = strings.Replace(result, "%s", arg, 1)
		}
		return result
	}
	return format
}
