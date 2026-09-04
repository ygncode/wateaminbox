package client

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow/proto/waE2E"
	waTypes "go.mau.fi/whatsmeow/types"

	internalTypes "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

func TestBuildMediaAlbumManifest(t *testing.T) {
	manifest := buildMediaAlbumManifest(internalTypes.MediaAlbumContext{
		ImageCount: 2,
		VideoCount: 1,
	})

	require.Equal(t, uint32(2), manifest.GetAlbumMessage().GetExpectedImageCount())
	require.Equal(t, uint32(1), manifest.GetAlbumMessage().GetExpectedVideoCount())
}

func TestApplyMediaAlbumAssociation(t *testing.T) {
	message := &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}
	recipient, err := waTypes.ParseJID("120363000000000000@g.us")
	require.NoError(t, err)

	applyMediaAlbumAssociation(message, recipient, internalTypes.MediaAlbumContext{
		ID:    "3EB0000102030405FAFBFF",
		Index: 2,
	})

	association := message.GetMessageContextInfo().GetMessageAssociation()
	require.Equal(t, waE2E.MessageAssociation_MEDIA_ALBUM, association.GetAssociationType())
	require.Equal(t, "3EB0000102030405FAFBFF", association.GetParentMessageKey().GetID())
	require.Equal(t, recipient.String(), association.GetParentMessageKey().GetRemoteJID())
	require.True(t, association.GetParentMessageKey().GetFromMe())
	require.Equal(t, int32(2), association.GetMessageIndex())
}
