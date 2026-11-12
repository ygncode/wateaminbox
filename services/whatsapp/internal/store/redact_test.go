package store

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
)

const leakyURL = "postgres://wateaminbox_worker:s3cr3t-pass@db.example.internal:25061/wateaminbox?sslmode=verify-full\n"

func assertRedacted(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	msg := err.Error()
	for _, leak := range []string{"s3cr3t-pass", "db.example.internal", "wateaminbox_worker", `postgres://`} {
		if strings.Contains(msg, leak) {
			t.Fatalf("error text leaks %q: %s", leak, msg)
		}
	}
}

func TestRedactDatabaseErrorStripsURLErrorAndRawURL(t *testing.T) {
	_, parseErr := url.Parse(leakyURL)
	if parseErr == nil {
		t.Fatal("control character must make url.Parse fail")
	}
	// *url.Error quotes the URL with %q, so the raw string never appears verbatim.
	err := redactDatabaseError(parseErr, leakyURL)
	assertRedacted(t, err)
	if !strings.Contains(err.Error(), "invalid control character") {
		t.Fatalf("cause must survive redaction: %s", err)
	}

	// A raw occurrence (no *url.Error) is replaced too, with and without the search_path suffix.
	raw := errors.New("dial failed for " + leakyURL + "&search_path=whatsapp_sessions and " + leakyURL)
	assertRedacted(t, redactDatabaseError(raw, leakyURL+"&search_path=whatsapp_sessions", leakyURL))
	if redactDatabaseError(nil, leakyURL) != nil {
		t.Fatal("nil stays nil")
	}
}

func TestNewPGContainerDoesNotEchoTheDatabaseURL(t *testing.T) {
	_, err := NewPGContainer(context.Background(), PGConfig{DatabaseURL: leakyURL, ConnectionID: "test"})
	assertRedacted(t, err)
}
