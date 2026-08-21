package handler

import (
	"errors"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types"
)

func TestFetchProfilePictureCachesSuccessfulLookup(t *testing.T) {
	handler := New(Config{})
	calls := 0
	handler.fetchProfilePictureFn = func(types.JID) (string, error) {
		calls++
		return "s3://whatsapp-media/media/company/avatar.jpg", nil
	}

	for range 2 {
		url, err := handler.FetchProfilePicture("15551234567@s.whatsapp.net")
		if err != nil {
			t.Fatalf("fetch failed: %v", err)
		}
		if url != "s3://whatsapp-media/media/company/avatar.jpg" {
			t.Fatalf("unexpected URL %q", url)
		}
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls)
	}
}

func TestFetchProfilePictureDoesNotCacheTransientFailure(t *testing.T) {
	handler := New(Config{})
	calls := 0
	handler.fetchProfilePictureFn = func(types.JID) (string, error) {
		calls++
		if calls == 1 {
			return "", errors.New("temporary storage failure")
		}
		return "s3://whatsapp-media/media/company/avatar.jpg", nil
	}

	if _, err := handler.FetchProfilePicture("15551234567@s.whatsapp.net"); err == nil {
		t.Fatal("expected the first lookup to fail")
	}
	url, err := handler.FetchProfilePicture("15551234567@s.whatsapp.net")
	if err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	if url == "" || calls != 2 {
		t.Fatalf("retry URL = %q, calls = %d", url, calls)
	}
}

func TestFetchProfilePictureNegativeCacheExpires(t *testing.T) {
	handler := New(Config{})
	calls := 0
	handler.fetchProfilePictureFn = func(types.JID) (string, error) {
		calls++
		return "", nil
	}
	jid := "15551234567@s.whatsapp.net"

	if url, err := handler.FetchProfilePicture(jid); err != nil || url != "" {
		t.Fatalf("first absence = %q, %v", url, err)
	}
	if url, err := handler.FetchProfilePicture(jid); err != nil || url != "" {
		t.Fatalf("cached absence = %q, %v", url, err)
	}
	if calls != 1 {
		t.Fatalf("fetch calls before expiry = %d, want 1", calls)
	}

	handler.profilePictureCache.Store(jid, profilePictureCacheEntry{
		expiresAt: time.Now().Add(-time.Second),
	})
	if _, err := handler.FetchProfilePicture(jid); err != nil {
		t.Fatalf("lookup after expiry failed: %v", err)
	}
	if calls != 2 {
		t.Fatalf("fetch calls after expiry = %d, want 2", calls)
	}
}
