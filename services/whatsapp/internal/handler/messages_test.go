package handler

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type fakeLIDStore struct {
	pnByLID map[string]types.JID
}

func (s *fakeLIDStore) PutManyLIDMappings(context.Context, []store.LIDMapping) error {
	return nil
}

func (s *fakeLIDStore) PutLIDMapping(context.Context, types.JID, types.JID) error {
	return nil
}

func (s *fakeLIDStore) GetPNForLID(_ context.Context, lid types.JID) (types.JID, error) {
	return s.pnByLID[lid.String()], nil
}

func (s *fakeLIDStore) GetLIDForPN(context.Context, types.JID) (types.JID, error) {
	return types.EmptyJID, nil
}

func (s *fakeLIDStore) GetManyLIDsForPNs(context.Context, []types.JID) (map[types.JID]types.JID, error) {
	return nil, nil
}

func mustParseJID(t *testing.T, raw string) types.JID {
	t.Helper()
	jid, err := types.ParseJID(raw)
	if err != nil {
		t.Fatalf("failed to parse JID %q: %v", raw, err)
	}
	return jid
}

func TestResolvePreferredJIDUsesPersistedDeviceMapping(t *testing.T) {
	lid := mustParseJID(t, "190288643534904:18@lid")
	pn := mustParseJID(t, "6584042683:18@s.whatsapp.net")
	lidStore := &fakeLIDStore{pnByLID: map[string]types.JID{lid.String(): pn}}
	waClient := &whatsmeow.Client{Store: &store.Device{LIDs: lidStore}}
	handler := New(Config{Client: &mockDownloader{client: waClient}})

	resolved := handler.resolvePreferredJID(lid, types.EmptyJID)
	if resolved.String() != "6584042683@s.whatsapp.net" {
		t.Fatalf("expected phone JID, got %s", resolved.String())
	}
}

func TestResolvePreferredJIDUsesEventAlternative(t *testing.T) {
	lid := mustParseJID(t, "190288643534904:18@lid")
	pn := mustParseJID(t, "6584042683:18@s.whatsapp.net")
	handler := New(Config{})

	resolved := handler.resolvePreferredJID(lid, pn)
	if resolved.String() != "6584042683@s.whatsapp.net" {
		t.Fatalf("expected alternative phone JID, got %s", resolved.String())
	}
}

func TestResolvePreferredJIDKeepsUnmappedLID(t *testing.T) {
	lid := mustParseJID(t, "190288643534904:18@lid")
	handler := New(Config{})

	resolved := handler.resolvePreferredJID(lid, types.EmptyJID)
	if resolved.String() != "190288643534904@lid" {
		t.Fatalf("expected normalized LID fallback, got %s", resolved.String())
	}
}

func TestGetHistorySenderJIDUsesGroupParticipant(t *testing.T) {
	handler := New(Config{})

	resolved := handler.getHistorySenderJID(
		"120363380084647857@g.us",
		"6582239810:18@s.whatsapp.net",
		true,
	)
	if resolved != "6582239810@s.whatsapp.net" {
		t.Fatalf("expected group participant JID, got %s", resolved)
	}
}

func TestNormalizeHistoryMessageStatus(t *testing.T) {
	tests := []struct {
		status   waWeb.WebMessageInfo_Status
		expected string
	}{
		{status: waWeb.WebMessageInfo_PENDING, expected: "pending"},
		{status: waWeb.WebMessageInfo_SERVER_ACK, expected: "sent"},
		{status: waWeb.WebMessageInfo_DELIVERY_ACK, expected: "delivered"},
		{status: waWeb.WebMessageInfo_READ, expected: "read"},
		{status: waWeb.WebMessageInfo_PLAYED, expected: "read"},
		{status: waWeb.WebMessageInfo_ERROR, expected: "failed"},
	}

	for _, tt := range tests {
		if actual := normalizeHistoryMessageStatus(tt.status); actual != tt.expected {
			t.Fatalf("status %s: expected %q, got %q", tt.status, tt.expected, actual)
		}
	}
}

func TestNormalizeReceiptStatus(t *testing.T) {
	tests := []struct {
		name     string
		receipt  types.ReceiptType
		expected string
	}{
		{name: "empty means delivered", receipt: types.ReceiptTypeDelivered, expected: "delivered"},
		{name: "sender means sent", receipt: types.ReceiptTypeSender, expected: "sent"},
		{name: "read", receipt: types.ReceiptTypeRead, expected: "read"},
		{name: "played means read", receipt: types.ReceiptTypePlayed, expected: "read"},
		{name: "unsupported is preserved", receipt: types.ReceiptTypeInactive, expected: "inactive"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := normalizeReceiptStatus(tt.receipt); actual != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, actual)
			}
		})
	}
}

func TestNewMessageEventPreservesFromMe(t *testing.T) {
	sender := mustParseJID(t, "6584042683:18@s.whatsapp.net")
	chat := mustParseJID(t, "6582239810@s.whatsapp.net")
	msg := &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{
		Sender:   sender,
		Chat:     chat,
		IsFromMe: true,
	}}}

	event := newMessageEvent(msg, sender.ToNonAD(), chat.ToNonAD())
	if !event.FromMe {
		t.Fatal("expected outgoing WhatsApp message to remain from_me")
	}
	if event.To != "6582239810@s.whatsapp.net" {
		t.Fatalf("expected recipient chat JID, got %s", event.To)
	}
}
