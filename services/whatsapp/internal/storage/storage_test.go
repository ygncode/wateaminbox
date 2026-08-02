package storage

import (
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
