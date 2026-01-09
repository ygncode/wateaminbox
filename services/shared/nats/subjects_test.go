package nats

import (
	"fmt"
	"strings"
	"testing"
)

func TestSubjectConstants(t *testing.T) {
	// Verify SubjectCommands is a valid subject (no format specifiers)
	if strings.Contains(SubjectCommands, "%") {
		t.Error("SubjectCommands should not contain format specifiers")
	}
	if SubjectCommands != "WHATSAPP.commands" {
		t.Errorf("SubjectCommands = %q, want 'WHATSAPP.commands'", SubjectCommands)
	}
}

func TestSubjectFormatPatterns(t *testing.T) {
	// All event subjects should have format specifiers for companyId and connectionId
	subjects := []struct {
		name    string
		pattern string
	}{
		{"SubjectQR", SubjectQR},
		{"SubjectStatus", SubjectStatus},
		{"SubjectMessage", SubjectMessage},
		{"SubjectReceipt", SubjectReceipt},
		{"SubjectPresence", SubjectPresence},
		{"SubjectContact", SubjectContact},
		{"SubjectProfilePicture", SubjectProfilePicture},
		{"SubjectMessageRevoke", SubjectMessageRevoke},
		{"SubjectSendConfirm", SubjectSendConfirm},
		{"SubjectTyping", SubjectTyping},
		{"SubjectReaction", SubjectReaction},
		{"SubjectSyncStatus", SubjectSyncStatus},
		{"SubjectDownloadRequest", SubjectDownloadRequest},
		{"SubjectDownloadResponse", SubjectDownloadResponse},
	}

	for _, tt := range subjects {
		t.Run(tt.name, func(t *testing.T) {
			// Should contain exactly 2 format specifiers
			count := strings.Count(tt.pattern, "%s")
			if count != 2 {
				t.Errorf("%s should have 2 %%s format specifiers, got %d", tt.name, count)
			}

			// Should start with WHATSAPP.
			if !strings.HasPrefix(tt.pattern, "WHATSAPP.") {
				t.Errorf("%s should start with 'WHATSAPP.', got %q", tt.name, tt.pattern)
			}
		})
	}
}

func TestSubjectFormatting(t *testing.T) {
	companyID := "company-123"
	connectionID := "conn-456"

	tests := []struct {
		name         string
		pattern      string
		wantContains []string
	}{
		{
			name:         "QR subject",
			pattern:      SubjectQR,
			wantContains: []string{companyID, connectionID, "qr"},
		},
		{
			name:         "Status subject",
			pattern:      SubjectStatus,
			wantContains: []string{companyID, connectionID, "status"},
		},
		{
			name:         "Message subject",
			pattern:      SubjectMessage,
			wantContains: []string{companyID, connectionID, "message"},
		},
		{
			name:         "Receipt subject",
			pattern:      SubjectReceipt,
			wantContains: []string{companyID, connectionID, "receipt"},
		},
		{
			name:         "Typing subject",
			pattern:      SubjectTyping,
			wantContains: []string{companyID, connectionID, "typing"},
		},
		{
			name:         "Reaction subject",
			pattern:      SubjectReaction,
			wantContains: []string{companyID, connectionID, "reaction"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := fmt.Sprintf(tt.pattern, companyID, connectionID)

			for _, want := range tt.wantContains {
				if !strings.Contains(result, want) {
					t.Errorf("Formatted subject %q should contain %q", result, want)
				}
			}
		})
	}
}

func TestSubjectHierarchy(t *testing.T) {
	// Verify that event subjects follow the correct hierarchy
	// Format: WHATSAPP.events.{companyId}.{connectionId}.{type}
	eventSubjects := []struct {
		pattern  string
		isEvents bool
	}{
		{SubjectQR, true},
		{SubjectStatus, true},
		{SubjectMessage, true},
		{SubjectReceipt, true},
		{SubjectPresence, true},
		{SubjectContact, true},
		{SubjectProfilePicture, true},
		{SubjectMessageRevoke, true},
		{SubjectSendConfirm, true},
		{SubjectTyping, true},
		{SubjectReaction, true},
		{SubjectSyncStatus, true},
		{SubjectDownloadResponse, true},
	}

	for _, tt := range eventSubjects {
		if tt.isEvents && !strings.HasPrefix(tt.pattern, "WHATSAPP.events.") {
			t.Errorf("Event subject %q should start with 'WHATSAPP.events.'", tt.pattern)
		}
	}

	// Download request should be in the download namespace
	if !strings.HasPrefix(SubjectDownloadRequest, "WHATSAPP.download.") {
		t.Errorf("SubjectDownloadRequest should start with 'WHATSAPP.download.', got %q", SubjectDownloadRequest)
	}
}

func TestSubjectNoDuplicates(t *testing.T) {
	// Ensure no two subject patterns are identical
	subjects := []string{
		SubjectQR,
		SubjectStatus,
		SubjectMessage,
		SubjectReceipt,
		SubjectPresence,
		SubjectContact,
		SubjectProfilePicture,
		SubjectMessageRevoke,
		SubjectSendConfirm,
		SubjectTyping,
		SubjectReaction,
		SubjectSyncStatus,
		SubjectDownloadRequest,
		SubjectDownloadResponse,
	}

	seen := make(map[string]bool)
	for _, s := range subjects {
		if seen[s] {
			t.Errorf("Duplicate subject pattern found: %q", s)
		}
		seen[s] = true
	}
}
