package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrivateObjectReferenceIsNotHTTPDownloadURL(t *testing.T) {
	client := &Client{bucket: "whatsapp-media"}
	reference := client.getPrivateReference("media/company-a/2026/01/01/file.jpg")

	assert.Equal(t, "s3://whatsapp-media/media/company-a/2026/01/01/file.jpg", reference)
	assert.False(t, strings.HasPrefix(reference, "http://"))
	assert.False(t, strings.HasPrefix(reference, "https://"))
}

func TestProductionBucketCheckNeverCreatesBucket(t *testing.T) {
	methods := make([]string, 0, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		methods = append(methods, request.Method)
		writer.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	client, err := New(Config{
		Endpoint: server.URL, AccessKeyID: "access", SecretAccessKey: "secret",
		Bucket: "whatsapp-media", Region: "auto", UsePathStyle: true,
		CreateBucketIfMissing: false,
	})
	require.NoError(t, err)
	require.Error(t, client.EnsureBucketExists(context.Background()))
	assert.NotEmpty(t, methods)
	assert.NotContains(t, methods, http.MethodPut)
}

func TestMediaKeyInputsStayInsideTenantPrefix(t *testing.T) {
	require.True(t, validTenantID("company-a_123"))
	assert.False(t, validTenantID("../company-b"))
	assert.False(t, validTenantID("company/a"))
	assert.False(t, validTenantID(""))

	key := generateMediaKeyWithFilename("company-a", sanitizeFilename("../../other/secret\r\n.pdf"))
	assert.True(t, strings.HasPrefix(key, "media/company-a/"))
	assert.NotContains(t, key, "..")
	assert.NotContains(t, key, "\r")
	assert.NotContains(t, key, "\n")
}

// capturedPut records what the fake S3 received on the last PUT request.
type capturedPut struct {
	method             string
	key                string
	contentType        string
	contentDisposition string
	puts               int
}

func newFakeS3Server() (*httptest.Server, *capturedPut) {
	cap := &capturedPut{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			cap.method = r.Method
			cap.key = r.URL.Path
			cap.contentType = r.Header.Get("Content-Type")
			cap.contentDisposition = r.Header.Get("Content-Disposition")
			cap.puts++
			w.Header().Set("ETag", "\"fake-etag\"")
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	return server, cap
}

func newFakeClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	client, err := New(Config{
		Endpoint: server.URL, AccessKeyID: "access", SecretAccessKey: "secret",
		Bucket: "whatsapp-media", Region: "auto", UsePathStyle: true,
	})
	require.NoError(t, err)
	return client
}

// TestUploadMediaRejectsSubtypelessMimeType asserts the guard catches the bug
// shape: a bare category such as "audio" (no subtype) must never reach S3 as
// the object's Content-Type. PutObject must not be attempted.
func TestUploadMediaRejectsSubtypelessMimeType(t *testing.T) {
	server, cap := newFakeS3Server()
	defer server.Close()
	client := newFakeClient(t, server)

	_, err := client.UploadMedia(context.Background(), []byte("data"), "audio", "company-a")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid mime type")
	assert.Equal(t, 0, cap.puts, "PutObject must not be called for a subtype-less mime type")
}

func TestUploadMediaWithFilenameRejectsSubtypelessMimeType(t *testing.T) {
	server, cap := newFakeS3Server()
	defer server.Close()
	client := newFakeClient(t, server)

	_, err := client.UploadMediaWithFilename(context.Background(), []byte("data"), "image", "company-a", "photo.jpg")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid mime type")
	assert.Equal(t, 0, cap.puts, "PutObject must not be called for a subtype-less mime type")
}

// TestUploadMediaRejectsEmptyMimeType guards against a producer silently
// forgetting the real type.
func TestUploadMediaRejectsEmptyMimeType(t *testing.T) {
	server, cap := newFakeS3Server()
	defer server.Close()
	client := newFakeClient(t, server)

	_, err := client.UploadMedia(context.Background(), []byte("data"), "", "company-a")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid mime type")
	assert.Equal(t, 0, cap.puts)
}

// TestUploadMediaStoresContentTypeFromMimeType asserts the real mime type is
// written verbatim as the S3 Content-Type, including parameters.
func TestUploadMediaStoresContentTypeFromMimeType(t *testing.T) {
	server, cap := newFakeS3Server()
	defer server.Close()
	client := newFakeClient(t, server)

	const want = "audio/ogg; codecs=opus"
	ref, err := client.UploadMedia(context.Background(), []byte("voice-note"), want, "company-a")
	require.NoError(t, err)
	assert.Equal(t, 1, cap.puts)
	assert.Equal(t, want, cap.contentType, "the stored Content-Type must be the real media type, not a category")
	assert.True(t, strings.HasPrefix(ref, "s3://whatsapp-media/media/company-a/"),
		"expected an s3:// private reference, got %q", ref)
	assert.True(t, strings.HasSuffix(ref, ".ogg"),
		"audio/ogg with parameters should resolve to a .ogg key, got %q", ref)
	assert.False(t, strings.HasSuffix(ref, ".bin"),
		"the key must not fall back to .bin for a known audio type")
}

// TestUploadMediaWithFilenameStoresContentTypeAndDisposition asserts the
// filename path also carries the real Content-Type and the inline
// Content-Disposition.
func TestUploadMediaWithFilenameStoresContentTypeAndDisposition(t *testing.T) {
	server, cap := newFakeS3Server()
	defer server.Close()
	client := newFakeClient(t, server)

	// "file.pdf" avoids the unrelated pre-existing sanitizeFilename defect
	// that mangles literal 'r'/'n' inside filenames.
	const want = "application/pdf"
	ref, err := client.UploadMediaWithFilename(context.Background(), []byte("doc"), want, "company-a", "file.pdf")
	require.NoError(t, err)
	assert.Equal(t, 1, cap.puts)
	assert.Equal(t, want, cap.contentType)
	assert.Contains(t, cap.key, "file.pdf")
	assert.Contains(t, cap.contentDisposition, "file.pdf")
	assert.True(t, strings.HasPrefix(ref, "s3://whatsapp-media/media/company-a/"))
}

// TestExtensionFromMimeTypeParsesParameters covers the param-bearing types
// WhatsApp reports (e.g. "audio/ogg; codecs=opus"): after the fix they resolve
// to a known extension rather than the generic .bin. The exact-match entry
// "audio/ogg;codecs=opus" (no space) keeps its specialized .opus mapping.
func TestExtensionFromMimeTypeParsesParameters(t *testing.T) {
	assert.Equal(t, ".ogg", getExtensionFromMimeType("audio/ogg; codecs=opus"))
	assert.Equal(t, ".opus", getExtensionFromMimeType("audio/ogg;codecs=opus"))
	assert.Equal(t, ".ogg", getExtensionFromMimeType("audio/ogg"))
	assert.Equal(t, ".jpg", getExtensionFromMimeType("image/jpeg"))
	assert.Equal(t, ".mp4", getExtensionFromMimeType("video/mp4"))
	assert.Equal(t, ".bin", getExtensionFromMimeType("application/x-unknown"))
	assert.Equal(t, ".bin", getExtensionFromMimeType("not-a-mime-type"))
}
