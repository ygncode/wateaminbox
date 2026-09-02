package handler

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

func albumChild(parentMessageID string, index int32) *waE2E.Message {
	return &waE2E.Message{
		MessageContextInfo: &waE2E.MessageContextInfo{
			MessageAssociation: &waE2E.MessageAssociation{
				AssociationType:  waE2E.MessageAssociation_MEDIA_ALBUM.Enum(),
				ParentMessageKey: &waCommon.MessageKey{ID: proto.String(parentMessageID)},
				MessageIndex:     proto.Int32(index),
			},
		},
	}
}

func TestGetMediaAlbumAssociation(t *testing.T) {
	parentMessageID, index, ok := getMediaAlbumAssociation(albumChild("album-parent", 0))
	if !ok || parentMessageID != "album-parent" || index != 0 {
		t.Fatalf("unexpected association: parent=%q index=%d ok=%v", parentMessageID, index, ok)
	}
}

func TestUnwrapMediaAlbumMessagePreservesOuterAssociation(t *testing.T) {
	outer := albumChild("album-parent", 3)
	outer.AssociatedChildMessage = &waE2E.FutureProofMessage{
		Message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}},
	}

	unwrapped := unwrapMediaAlbumMessage(outer)
	if unwrapped.GetImageMessage() == nil {
		t.Fatal("expected wrapped album image to be unwrapped")
	}
	parentMessageID, index, ok := getMediaAlbumAssociation(unwrapped)
	if !ok || parentMessageID != "album-parent" || index != 3 {
		t.Fatalf("association was not preserved: parent=%q index=%d ok=%v", parentMessageID, index, ok)
	}
}

func TestApplyMediaAlbumMetadataIncludesManifestCount(t *testing.T) {
	handler := New(Config{})
	handler.rememberMediaAlbum("120363000000@g.us", "album-parent", &waE2E.AlbumMessage{
		ExpectedImageCount: proto.Uint32(3),
		ExpectedVideoCount: proto.Uint32(1),
	})

	event := &natsClient.MessageEvent{}
	handler.applyMediaAlbumMetadata(
		"120363000000@g.us",
		albumChild("album-parent", 2),
		event,
	)

	if event.MediaAlbumID != "album-parent" {
		t.Fatalf("expected album ID, got %q", event.MediaAlbumID)
	}
	if event.MediaAlbumIndex != 2 {
		t.Fatalf("expected index 2, got %d", event.MediaAlbumIndex)
	}
	if event.MediaAlbumCount != 4 {
		t.Fatalf("expected count 4, got %d", event.MediaAlbumCount)
	}
}

func TestApplyMediaAlbumMetadataStillAssociatesWithoutManifest(t *testing.T) {
	handler := New(Config{})
	event := &natsClient.MessageEvent{}
	handler.applyMediaAlbumMetadata(
		"15551234567@s.whatsapp.net",
		albumChild("album-parent", 1),
		event,
	)

	if event.MediaAlbumID != "album-parent" || event.MediaAlbumIndex != 1 {
		t.Fatalf("expected child association without count, got %#v", event)
	}
	if event.MediaAlbumCount != 0 {
		t.Fatalf("expected unknown count, got %d", event.MediaAlbumCount)
	}
}
