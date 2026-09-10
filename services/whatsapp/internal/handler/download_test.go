package handler

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// fakeDownloadStorage implements interfaces.Storage by recording the mimeType
// argument so the handler can be proven to forward the real DB media type
// (req.MimeType) rather than the coarse category (req.MediaType).
type fakeDownloadStorage struct {
	uploadCalls       []fakeUploadCall
	withFilenameCalls []fakeUploadWithFilenameCall
	uploadErr         error
	returnRef         string
}

type fakeUploadCall struct {
	data      []byte
	mimeType  string
	companyID string
}

type fakeUploadWithFilenameCall struct {
	data      []byte
	mimeType  string
	companyID string
	filename  string
}

func (f *fakeDownloadStorage) UploadMedia(_ context.Context, data []byte, mimeType string, companyID string) (string, error) {
	f.uploadCalls = append(f.uploadCalls, fakeUploadCall{data: data, mimeType: mimeType, companyID: companyID})
	if f.uploadErr != nil {
		return "", f.uploadErr
	}
	if f.returnRef != "" {
		return f.returnRef, nil
	}
	return "s3://whatsapp-media/media/test-company/uuid.ogg", nil
}

func (f *fakeDownloadStorage) UploadMediaWithFilename(_ context.Context, data []byte, mimeType string, companyID string, filename string) (string, error) {
	f.withFilenameCalls = append(f.withFilenameCalls, fakeUploadWithFilenameCall{
		data: data, mimeType: mimeType, companyID: companyID, filename: filename,
	})
	if f.uploadErr != nil {
		return "", f.uploadErr
	}
	if f.returnRef != "" {
		return f.returnRef, nil
	}
	return "s3://whatsapp-media/media/test-company/uuid-" + filename, nil
}

func (f *fakeDownloadStorage) DeleteMedia(_ context.Context, _ string) error { return nil }

func (f *fakeDownloadStorage) GetPresignedURL(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", nil
}

func (f *fakeDownloadStorage) EnsureBucketExists(_ context.Context) error { return nil }

type recordedDownloadResponse struct {
	messageID string
	mediaURL  string
	mediaSize int64
	success   bool
	errMsg    string
}

type recordingDownloadPublisher struct {
	responses []recordedDownloadResponse
}

func (r *recordingDownloadPublisher) publish(messageID, mediaURL string, mediaSize int64, success bool, errMsg string) error {
	r.responses = append(r.responses, recordedDownloadResponse{
		messageID: messageID, mediaURL: mediaURL, mediaSize: mediaSize, success: success, errMsg: errMsg,
	})
	return nil
}

func newDownloadHandlerTestHarness(t *testing.T) (*DownloadHandler, *fakeDownloadStorage, *recordingDownloadPublisher) {
	t.Helper()
	store := &fakeDownloadStorage{}
	pub := &recordingDownloadPublisher{}
	h := New(Config{
		CompanyID: "test-company",
		Storage:   store,
	})
	h.downloadMediaWithPathFn = func(_ context.Context, _ string, _, _, _ []byte, _ whatsmeow.MediaType, _ string) ([]byte, error) {
		return []byte("downloaded-media-bytes"), nil
	}
	h.publishDownloadResponseFn = pub.publish
	return &DownloadHandler{handler: h}, store, pub
}

func downloadRequestMsg(t *testing.T, req natsClient.DownloadRequest) *nats.Msg {
	t.Helper()
	data, err := json.Marshal(req)
	require.NoError(t, err)
	return &nats.Msg{Data: data}
}

// TestHandleDownloadRequest_PassesRealMimeTypeToStorage is the core regression
// test: the real DB media type travels on req.MimeType and is what gets stored
// as the S3 Content-Type. The category (req.MediaType, here "audio") must
// never be forwarded as the mime type.
func TestHandleDownloadRequest_PassesRealMimeTypeToStorage(t *testing.T) {
	dh, store, pub := newDownloadHandlerTestHarness(t)
	msg := downloadRequestMsg(t, natsClient.DownloadRequest{
		MessageID:  "msg-audio",
		DirectPath: "/whatsapp/media/audio",
		MediaKey:   []byte("key"),
		MediaType:  "audio",
		MimeType:   "audio/ogg; codecs=opus",
	})

	dh.handleDownloadRequest(msg)

	require.Len(t, store.uploadCalls, 1, "UploadMedia (no filename) must be called once")
	require.Empty(t, store.withFilenameCalls, "audio (no FileName) must use UploadMedia, not the filename path")
	got := store.uploadCalls[0]
	assert.Equal(t, "audio/ogg; codecs=opus", got.mimeType, "the real media type must be stored as the Content-Type")
	assert.NotEqual(t, "audio", got.mimeType, "the category must never be passed as the mime type")
	assert.Equal(t, "test-company", got.companyID)
	assert.Equal(t, []byte("downloaded-media-bytes"), got.data)
	require.Len(t, pub.responses, 1)
	assert.True(t, pub.responses[0].success)
	assert.Equal(t, "msg-audio", pub.responses[0].messageID)
	assert.NotEmpty(t, pub.responses[0].mediaURL)
	assert.Equal(t, int64(len("downloaded-media-bytes")), pub.responses[0].mediaSize)
}

// TestHandleDownloadRequest_PassesRealMimeTypeWithFilename covers the filename
// branch (UploadMediaWithFilename), e.g. a deferred document.
func TestHandleDownloadRequest_PassesRealMimeTypeWithFilename(t *testing.T) {
	dh, store, pub := newDownloadHandlerTestHarness(t)
	msg := downloadRequestMsg(t, natsClient.DownloadRequest{
		MessageID:  "msg-doc",
		DirectPath: "/whatsapp/media/doc",
		MediaKey:   []byte("key"),
		MediaType:  "document",
		MimeType:   "application/pdf",
		FileName:   "report.pdf",
	})

	dh.handleDownloadRequest(msg)

	require.Len(t, store.withFilenameCalls, 1)
	require.Empty(t, store.uploadCalls)
	got := store.withFilenameCalls[0]
	assert.Equal(t, "application/pdf", got.mimeType)
	assert.NotEqual(t, "document", got.mimeType, "the category must never be passed as the mime type")
	assert.Equal(t, "report.pdf", got.filename)
	assert.Equal(t, "test-company", got.companyID)
	require.Len(t, pub.responses, 1)
	assert.True(t, pub.responses[0].success)
}

// TestHandleDownloadRequest_EmptyMimeTypeFallsBackToOctetStream covers the
// transitional/edge case: a request from an API that predates the MimeType
// field arrives with MimeType == "". The handler must neither write the invalid
// category as the Content-Type nor hard-fail; it stores a valid generic type.
func TestHandleDownloadRequest_EmptyMimeTypeFallsBackToOctetStream(t *testing.T) {
	dh, store, pub := newDownloadHandlerTestHarness(t)
	msg := downloadRequestMsg(t, natsClient.DownloadRequest{
		MessageID:  "msg-transitional",
		DirectPath: "/whatsapp/media/audio",
		MediaKey:   []byte("key"),
		MediaType:  "audio",
		// MimeType intentionally empty (old-API shape / no recorded mimetype)
	})

	dh.handleDownloadRequest(msg)

	require.Len(t, store.uploadCalls, 1)
	assert.Equal(t, "application/octet-stream", store.uploadCalls[0].mimeType)
	assert.NotEqual(t, "audio", store.uploadCalls[0].mimeType)
	require.Len(t, pub.responses, 1)
	assert.True(t, pub.responses[0].success, "an empty MimeType must not hard-fail the upload")
}

// TestHandleDownloadRequest_DownloadErrorPublishesFailure asserts a download
// failure publishes an error response and never reaches storage.
func TestHandleDownloadRequest_DownloadErrorPublishesFailure(t *testing.T) {
	dh, store, pub := newDownloadHandlerTestHarness(t)
	dh.handler.downloadMediaWithPathFn = func(_ context.Context, _ string, _, _, _ []byte, _ whatsmeow.MediaType, _ string) ([]byte, error) {
		return nil, errors.New("boom")
	}
	msg := downloadRequestMsg(t, natsClient.DownloadRequest{
		MessageID:  "msg-fail",
		DirectPath: "/whatsapp/media",
		MediaKey:   []byte("key"),
		MediaType:  "audio",
		MimeType:   "audio/ogg; codecs=opus",
	})

	dh.handleDownloadRequest(msg)

	assert.Empty(t, store.uploadCalls)
	assert.Empty(t, store.withFilenameCalls)
	require.Len(t, pub.responses, 1)
	assert.False(t, pub.responses[0].success)
	assert.Contains(t, pub.responses[0].errMsg, "download failed")
}

// TestHandleDownloadRequest_MissingRequiredFieldsPublishesError asserts the
// validation guard fires before any download/upload attempt.
func TestHandleDownloadRequest_MissingRequiredFieldsPublishesError(t *testing.T) {
	dh, store, pub := newDownloadHandlerTestHarness(t)
	msg := downloadRequestMsg(t, natsClient.DownloadRequest{
		MessageID: "msg-bad",
		MediaType: "audio",
		MimeType:  "audio/ogg",
		// DirectPath and MediaKey missing
	})

	dh.handleDownloadRequest(msg)

	assert.Empty(t, store.uploadCalls)
	assert.Empty(t, store.withFilenameCalls)
	require.Len(t, pub.responses, 1)
	assert.False(t, pub.responses[0].success)
	assert.Contains(t, pub.responses[0].errMsg, "missing required fields")
}

// TestHandleDownloadRequest_UnknownMediaTypeDefaultsToDocument proves the
// coarse category defaulting still drives the download path while the real
// mime is what storage receives.
func TestHandleDownloadRequest_UnknownMediaTypeDefaultsToDocument(t *testing.T) {
	var seenMedia whatsmeow.MediaType
	var seenMMS string
	dh, store, pub := newDownloadHandlerTestHarness(t)
	dh.handler.downloadMediaWithPathFn = func(_ context.Context, _ string, _, _, _ []byte, mt whatsmeow.MediaType, mms string) ([]byte, error) {
		seenMedia = mt
		seenMMS = mms
		return []byte("ok"), nil
	}
	msg := downloadRequestMsg(t, natsClient.DownloadRequest{
		MessageID:  "msg-unknown",
		DirectPath: "/whatsapp/media",
		MediaKey:   []byte("key"),
		MediaType:  "sticker", // not in mediaTypeMapping -> defaults to document
		MimeType:   "image/webp",
	})

	dh.handleDownloadRequest(msg)

	assert.Equal(t, whatsmeow.MediaDocument, seenMedia, "unknown category defaults to document for the download")
	assert.Equal(t, "document", seenMMS)
	require.Len(t, store.uploadCalls, 1)
	assert.Equal(t, "image/webp", store.uploadCalls[0].mimeType, "the real mime is still what storage receives")
	require.Len(t, pub.responses, 1)
	assert.True(t, pub.responses[0].success)
}
