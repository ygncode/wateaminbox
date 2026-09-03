package handler

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type fakeLIDStore struct {
	pnByLID map[string]types.JID
}

func (s *fakeLIDStore) PutManyLIDMappings(context.Context, []store.LIDMapping) error {
	return nil
}

func (s *fakeLIDStore) PutLIDMapping(_ context.Context, lid, pn types.JID) error {
	if s.pnByLID == nil {
		s.pnByLID = make(map[string]types.JID)
	}
	s.pnByLID[lid.String()] = pn
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

func TestHistorySyncPersistsMappingsBeforeResolvingReactionIdentity(t *testing.T) {
	lidStore := &fakeLIDStore{}
	waClient := &whatsmeow.Client{Store: &store.Device{LIDs: lidStore}}
	handler := New(Config{Client: &mockDownloader{client: waClient}})

	handler.storeHistoryLIDMappings([]*waHistorySync.PhoneNumberToLIDMapping{
		{
			PnJID:  proto.String("841665247989@s.whatsapp.net"),
			LidJID: proto.String("277905926004845@lid"),
		},
	})

	resolved := handler.resolveHistoryIdentity("277905926004845@lid")
	if resolved != "841665247989@s.whatsapp.net" {
		t.Fatalf("expected canonical reaction identity, got %s", resolved)
	}
}

func TestHistorySyncConversationUsesPersistedMappingForLIDOnlyChat(t *testing.T) {
	lidStore := &fakeLIDStore{}
	waClient := &whatsmeow.Client{Store: &store.Device{LIDs: lidStore}}
	handler := New(Config{Client: &mockDownloader{client: waClient}})

	handler.storeHistoryLIDMappings([]*waHistorySync.PhoneNumberToLIDMapping{
		{
			PnJID:  proto.String("6584042683@s.whatsapp.net"),
			LidJID: proto.String("44578136657990@lid"),
		},
	})

	result := handler.processHistorySyncConversation(
		&waHistorySync.Conversation{ID: proto.String("44578136657990@lid")},
		true,
	)
	if result.chatJID != "6584042683@s.whatsapp.net" {
		t.Fatalf("expected canonical phone chat JID, got %q", result.chatJID)
	}
}

func TestGetQuotedMessageIDFromIncomingMessages(t *testing.T) {
	tests := []struct {
		name     string
		message  *waE2E.Message
		expected string
	}{
		{
			name:     "text reply",
			expected: "quoted-text-id",
			message: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
				Text: proto.String("reply"),
				ContextInfo: &waE2E.ContextInfo{
					StanzaID: proto.String("quoted-text-id"),
				},
			}},
		},
		{
			name:     "image reply",
			expected: "quoted-image-id",
			message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
				ContextInfo: &waE2E.ContextInfo{
					StanzaID: proto.String("quoted-image-id"),
				},
			}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := getQuotedMessageID(tt.message); actual != tt.expected {
				t.Fatalf("expected %s, got %s", tt.expected, actual)
			}
		})
	}
}

func TestGetQuotedMessageIDReturnsEmptyForRegularMessage(t *testing.T) {
	message := &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text: proto.String("not a reply"),
	}}
	if actual := getQuotedMessageID(message); actual != "" {
		t.Fatalf("expected no quoted ID, got %s", actual)
	}
}

func TestContactCardPayloadsPreserveDisplayNameAndVCard(t *testing.T) {
	cards := contactCardPayloads([]*waE2E.ContactMessage{
		{
			DisplayName: proto.String("My Universe 🌟❤️"),
			Vcard: proto.String(
				"BEGIN:VCARD\nFN:My Universe 🌟❤️\nTEL:+6591234567\nEND:VCARD",
			),
		},
		nil,
	})

	if len(cards) != 1 {
		t.Fatalf("expected one contact card, got %d", len(cards))
	}
	if cards[0].DisplayName != "My Universe 🌟❤️" {
		t.Fatalf("unexpected contact name %q", cards[0].DisplayName)
	}
	if cards[0].VCard == "" {
		t.Fatal("expected vCard details to be preserved")
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

func TestGetHistoryParticipantSupportsBothWhatsAppLocations(t *testing.T) {
	tests := []struct {
		name     string
		message  *waWeb.WebMessageInfo
		expected string
	}{
		{
			name: "message key participant",
			message: &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{
				Participant: proto.String("6582239810@s.whatsapp.net"),
			}},
			expected: "6582239810@s.whatsapp.net",
		},
		{
			name: "outer participant",
			message: &waWeb.WebMessageInfo{
				Key:         &waCommon.MessageKey{},
				Participant: proto.String("6591134349@s.whatsapp.net"),
			},
			expected: "6591134349@s.whatsapp.net",
		},
		{
			name: "key wins when both are present",
			message: &waWeb.WebMessageInfo{
				Key: &waCommon.MessageKey{
					Participant: proto.String("6582239810@s.whatsapp.net"),
				},
				Participant: proto.String("6591134349@s.whatsapp.net"),
			},
			expected: "6582239810@s.whatsapp.net",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := getHistoryParticipant(tt.message); actual != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, actual)
			}
		})
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

func TestNewMessageEventPreservesGroupProtocolSenderJID(t *testing.T) {
	protocolSender := mustParseJID(t, "48954691608613:8@lid")
	preferredSender := mustParseJID(t, "84855316944@s.whatsapp.net")
	group := mustParseJID(t, "120363401436917596@g.us")
	msg := &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{
		Sender:  protocolSender,
		Chat:    group,
		IsGroup: true,
	}}}

	event := newMessageEvent(msg, preferredSender, group)

	if event.From != "84855316944@s.whatsapp.net" {
		t.Fatalf("expected preferred sender for display, got %s", event.From)
	}
	if event.ProtocolSenderJID != "48954691608613@lid" {
		t.Fatalf("expected protocol sender LID, got %s", event.ProtocolSenderJID)
	}
}
