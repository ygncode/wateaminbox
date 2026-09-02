package handler

import (
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

const mediaAlbumManifestTTL = 10 * time.Minute

type mediaAlbumManifest struct {
	expectedCount int
	expiresAt     time.Time
}

func mediaAlbumKey(chatJID, parentMessageID string) string {
	return chatJID + "\x00" + parentMessageID
}

func (h *Handler) rememberMediaAlbum(chatJID, parentMessageID string, album *waE2E.AlbumMessage) {
	if h == nil || album == nil || chatJID == "" || parentMessageID == "" {
		return
	}
	expectedCount := int(album.GetExpectedImageCount()) + int(album.GetExpectedVideoCount())
	if expectedCount < 2 {
		return
	}

	now := time.Now()
	h.mediaAlbumMu.Lock()
	defer h.mediaAlbumMu.Unlock()
	if h.mediaAlbumManifests == nil {
		h.mediaAlbumManifests = make(map[string]mediaAlbumManifest)
	}
	for key, manifest := range h.mediaAlbumManifests {
		if !manifest.expiresAt.After(now) {
			delete(h.mediaAlbumManifests, key)
		}
	}
	h.mediaAlbumManifests[mediaAlbumKey(chatJID, parentMessageID)] = mediaAlbumManifest{
		expectedCount: expectedCount,
		expiresAt:     now.Add(mediaAlbumManifestTTL),
	}
}

func getMediaAlbumAssociation(message *waE2E.Message) (parentMessageID string, index int, ok bool) {
	if message == nil {
		return "", 0, false
	}
	association := message.GetMessageContextInfo().GetMessageAssociation()
	if association == nil || association.GetAssociationType() != waE2E.MessageAssociation_MEDIA_ALBUM {
		return "", 0, false
	}
	parentMessageID = association.GetParentMessageKey().GetID()
	if parentMessageID == "" {
		return "", 0, false
	}
	return parentMessageID, int(association.GetMessageIndex()), true
}

// Some WhatsApp builds wrap album media in associatedChildMessage instead of
// placing the image/video directly on the outer message. Unwrap only album
// children so unrelated future-proof message types keep their existing path.
func unwrapMediaAlbumMessage(message *waE2E.Message) *waE2E.Message {
	if message == nil {
		return nil
	}
	inner := message.GetAssociatedChildMessage().GetMessage()
	if inner == nil {
		return message
	}
	_, _, outerIsAlbum := getMediaAlbumAssociation(message)
	_, _, innerIsAlbum := getMediaAlbumAssociation(inner)
	if !outerIsAlbum && !innerIsAlbum {
		return message
	}
	if inner.MessageContextInfo == nil && message.MessageContextInfo != nil {
		inner.MessageContextInfo = message.MessageContextInfo
	}
	return inner
}

func (h *Handler) applyMediaAlbumMetadata(chatJID string, message *waE2E.Message, event *natsClient.MessageEvent) {
	if h == nil || event == nil {
		return
	}
	parentMessageID, index, ok := getMediaAlbumAssociation(message)
	if !ok {
		return
	}

	event.MediaAlbumID = parentMessageID
	event.MediaAlbumIndex = index

	h.mediaAlbumMu.Lock()
	defer h.mediaAlbumMu.Unlock()
	key := mediaAlbumKey(chatJID, parentMessageID)
	manifest, found := h.mediaAlbumManifests[key]
	if found && manifest.expiresAt.After(time.Now()) {
		event.MediaAlbumCount = manifest.expectedCount
	} else if found {
		delete(h.mediaAlbumManifests, key)
	}
}
