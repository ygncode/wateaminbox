//go:build integration

package nats

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	mediastore "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/storage"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

func TestRealisticMediaObjectSendWithLocalMinIO(t *testing.T) {
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://localhost:4450"
	}
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		bucket = "whatsapp-media"
	}
	client, err := mediastore.New(mediastore.Config{
		Endpoint: endpoint, AccessKeyID: "minioadmin", SecretAccessKey: "minioadmin",
		Bucket: bucket, Region: "us-east-1", UsePathStyle: true,
	})
	require.NoError(t, err)

	companyID := "integration-media-company"
	data := make([]byte, 5*1024*1024)
	for index := range data {
		data[index] = byte(index % 251)
	}
	digest := sha256.Sum256(data)
	checksum := hex.EncodeToString(digest[:])
	mediaURL, err := client.UploadMediaWithFilename(
		context.Background(), data, "application/pdf", companyID, "realistic.pdf",
	)
	require.NoError(t, err)
	parsed, err := url.Parse(mediaURL)
	require.NoError(t, err)
	require.Equal(t, "s3", parsed.Scheme)
	require.Equal(t, bucket, parsed.Host)
	objectKey := strings.TrimPrefix(parsed.Path, "/")
	defer client.DeleteMedia(context.Background(), objectKey)

	sentBytes := 0
	sender := &mockMessageSender{sendMediaMessageFunc: func(_ context.Context, _ string, mediaType string, received []byte, _ string, fileName string, mimeType string, _ string, _ string) (types.SendResponse, error) {
		sentBytes = len(received)
		assert.Equal(t, "document", mediaType)
		assert.Equal(t, "realistic.pdf", fileName)
		assert.Equal(t, "application/pdf", mimeType)
		return types.SendResponse{ID: "wa-media-id", Timestamp: time.Now()}, nil
	}}
	ledger := &memoryCommandLedger{results: make(map[string][]byte)}
	publisher := &recordingCommandPublisher{}
	subscriber := &Subscriber{
		ctx: context.Background(), companyID: companyID, sender: sender,
		storage: client, ledger: ledger, publisher: publisher,
	}
	command, err := json.Marshal(SendMessageCommand{
		CommandID: "media-command", MessageID: "pending-media", To: "1@s.whatsapp.net",
		Type: "document", MediaObjectKey: objectKey, MediaSize: int64(len(data)),
		MediaChecksum: checksum, FileName: "realistic.pdf", MimeType: "application/pdf",
	})
	require.NoError(t, err)
	subscriber.handleSendCommand(&natsgo.Msg{Data: command})

	assert.Equal(t, len(data), sentBytes)
	assert.Equal(t, 1, ledger.saves)
	assert.Equal(t, 1, publisher.confirmationAttempts)
}
