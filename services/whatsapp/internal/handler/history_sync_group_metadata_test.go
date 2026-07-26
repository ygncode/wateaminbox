package handler

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"google.golang.org/protobuf/proto"
)

func TestGetHistoryGroupParticipantsNormalizesJIDsAndAdminRanks(t *testing.T) {
	h := New(Config{})
	conversation := &waHistorySync.Conversation{
		Participant: []*waHistorySync.GroupParticipant{
			{
				UserJID: proto.String("111:2@s.whatsapp.net"),
				Rank:    waHistorySync.GroupParticipant_ADMIN.Enum(),
			},
			{
				UserJID: proto.String("222@s.whatsapp.net"),
				Rank:    waHistorySync.GroupParticipant_REGULAR.Enum(),
			},
			{UserJID: proto.String("not-a-valid-jid")},
		},
	}

	participants := h.getHistoryGroupParticipants(conversation)
	if len(participants) != 2 {
		t.Fatalf("expected 2 valid participants, got %d: %+v", len(participants), participants)
	}
	if participants[0].JID != "111@s.whatsapp.net" || !participants[0].IsAdmin {
		t.Fatalf("expected normalized admin participant, got %+v", participants[0])
	}
	if participants[1].JID != "222@s.whatsapp.net" || participants[1].IsAdmin {
		t.Fatalf("expected regular participant, got %+v", participants[1])
	}
}
