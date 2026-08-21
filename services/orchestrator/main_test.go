package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadHTTPBearerTokenReadsFileAndStripsWorkerInheritableEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control-token")
	require.NoError(t, os.WriteFile(path, []byte("fresh-control-authority-1234567890abcdef\n"), 0o600))
	t.Setenv("HTTP_BEARER_TOKEN_FILE", path)

	token, err := loadHTTPBearerToken()
	require.NoError(t, err)
	require.Equal(t, "fresh-control-authority-1234567890abcdef", token)
	require.Empty(t, os.Getenv("HTTP_BEARER_TOKEN"))
	require.Empty(t, os.Getenv("HTTP_BEARER_TOKEN_FILE"))
}

func TestLoadHTTPBearerTokenRejectsGroupReadableFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "control-token")
	require.NoError(t, os.WriteFile(path, []byte("fresh-control-authority-1234567890abcdef\n"), 0o640))
	t.Setenv("HTTP_BEARER_TOKEN_FILE", path)

	_, err := loadHTTPBearerToken()
	require.ErrorContains(t, err, "root-only regular file")
}
