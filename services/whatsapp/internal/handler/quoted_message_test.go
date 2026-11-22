package handler

import (
	"strings"
	"testing"
	"unicode/utf8"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func replyTo(quoted *waE2E.Message, participant string) *waE2E.Message {
	return &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text: proto.String("Everyone looking good!"),
		ContextInfo: &waE2E.ContextInfo{
			StanzaID:      proto.String("3A62CC70343D56565D7C"),
			Participant:   proto.String(participant),
			QuotedMessage: quoted,
		},
	}}
}

func TestQuotedMessageSnapshot(t *testing.T) {
	h := &Handler{}
	sender := "15550000002@s.whatsapp.net"

	tests := []struct {
		name        string
		quoted      *waE2E.Message
		wantType    string
		wantContent string
	}{
		{"plain text", &waE2E.Message{Conversation: proto.String("  Thank you Magda.  ")}, "text", "Thank you Magda."},
		{"extended text", &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("hi")}}, "text", "hi"},
		{"photo with caption", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("three men")}}, "image", "three men"},
		{"photo album parent", &waE2E.Message{AlbumMessage: &waE2E.AlbumMessage{}}, "image", ""},
		{"voice note", &waE2E.Message{AudioMessage: &waE2E.AudioMessage{}}, "audio", ""},
		{"document falls back to file name", &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{FileName: proto.String("menu.pdf")}}, "document", "menu.pdf"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := h.getQuotedMessageSnapshot(replyTo(tt.quoted, sender))
			if got == nil {
				t.Fatal("expected a snapshot")
			}
			if got.MessageType != tt.wantType || got.Content != tt.wantContent {
				t.Fatalf("got (%q, %q), want (%q, %q)", got.MessageType, got.Content, tt.wantType, tt.wantContent)
			}
			if got.SenderJID != sender {
				t.Fatalf("sender = %q, want %q", got.SenderJID, sender)
			}
		})
	}
}

func TestQuotedMessageSnapshotAbsent(t *testing.T) {
	h := &Handler{}
	if got := h.getQuotedMessageSnapshot(&waE2E.Message{Conversation: proto.String("not a reply")}); got != nil {
		t.Fatalf("plain message produced a snapshot: %+v", got)
	}
	// A reply whose copy WhatsApp omitted keeps only the id, as before.
	if got := h.getQuotedMessageSnapshot(replyTo(nil, "1@s.whatsapp.net")); got != nil {
		t.Fatalf("reply without a quoted copy produced a snapshot: %+v", got)
	}
	if got := h.getQuotedMessageSnapshot(nil); got != nil {
		t.Fatal("nil message produced a snapshot")
	}
}

func TestQuotedMessageSnapshotIsBounded(t *testing.T) {
	h := &Handler{}
	long := strings.Repeat("é", maxQuotedSnapshotBytes) // 2 bytes per rune
	got := h.getQuotedMessageSnapshot(replyTo(&waE2E.Message{Conversation: proto.String(long)}, ""))
	if got == nil || len(got.Content) > maxQuotedSnapshotBytes || !utf8.ValidString(got.Content) {
		t.Fatalf("snapshot not bounded to valid UTF-8: len=%d", len(got.Content))
	}
	if got.SenderJID != "" {
		t.Fatalf("empty participant produced sender %q", got.SenderJID)
	}
}
