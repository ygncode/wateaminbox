package handler

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// retainMediaReference keeps the encrypted WhatsApp attachment coordinates on
// the event even when the eager download fails. The API can then persist them
// and request an on-demand download from the owning worker later.
func retainMediaReference(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) {
	if downloadable == nil || event == nil {
		return
	}
	event.MediaDirectPath = downloadable.GetDirectPath()
	event.MediaKey = bytes.Clone(downloadable.GetMediaKey())
	event.MediaFileSHA256 = bytes.Clone(downloadable.GetFileSHA256())
	event.MediaFileEncSHA256 = bytes.Clone(downloadable.GetFileEncSHA256())
}

// downloadWithRetry downloads media with exponential backoff retry logic.
// It attempts to download media up to mediaDownloadMaxRetries times, with each
// attempt having its own mediaDownloadAttemptTimeout. Backoff delays follow
// exponential progression: 1s, 2s, 4s.
//
// The parent context is checked between retries for cancellation.
// Returns the downloaded data on success, or an error after all retries are exhausted.
func (h *Handler) downloadWithRetry(ctx context.Context, downloadable whatsmeow.DownloadableMessage) ([]byte, error) {
	var lastErr error

	for attempt := 0; attempt < mediaDownloadMaxRetries; attempt++ {
		// Check if parent context is cancelled before attempting
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		// Create a per-attempt context with timeout
		attemptCtx, cancel := context.WithTimeout(context.Background(), mediaDownloadAttemptTimeout)

		// Attempt the download
		data, err := h.config.Client.DownloadMedia(attemptCtx, downloadable)
		cancel()

		// Success - return the data immediately
		if err == nil {
			if attempt > 0 {
				log.Printf("Media download succeeded on attempt %d after retries", attempt+1)
			}
			return data, nil
		}

		// Store this attempt's error
		lastErr = err

		// Log the failure
		if attempt < mediaDownloadMaxRetries-1 {
			log.Printf("Media download attempt %d failed: %v (retrying in %v)", attempt+1, err, mediaDownloadBaseDelay*time.Duration(1<<uint(attempt)))
		} else {
			log.Printf("Media download attempt %d failed: %v (no more retries)", attempt+1, err)
		}

		// Exponential backoff before next retry (but not after the last attempt)
		if attempt < mediaDownloadMaxRetries-1 {
			backoffDelay := mediaDownloadBaseDelay * time.Duration(1<<uint(attempt))

			// Wait for backoff duration or context cancellation
			select {
			case <-time.After(backoffDelay):
				// Continue to next attempt
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
	}

	// All retries exhausted
	return nil, lastErr
}

// handleMediaMessage downloads media and uploads to storage.
// Uses retry logic with exponential backoff for robustness.
// Timeout is extended to 135s to accommodate retry delays (1s + 2s + 4s backoff).
func (h *Handler) handleMediaMessage(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) {
	retainMediaReference(downloadable, event)
	if h.config.Client == nil {
		log.Println("Client not available for media download")
		return
	}

	// Create a context with timeout for media download and upload.
	// Extended from 120s to 135s to accommodate retry delays (up to ~7s total backoff).
	ctx, cancel := context.WithTimeout(context.Background(), 135*time.Second)
	defer cancel()

	// Download the media with retry logic (exponential backoff)
	data, err := h.downloadWithRetry(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download media after retry exhaustion: %v", err)
		return
	}

	log.Printf("Downloaded media: %d bytes, type: %s", len(data), event.MediaType)

	// Upload to storage if configured
	if h.config.Storage != nil {
		// Use filename if available (for documents)
		var mediaURL string
		if event.FileName != "" {
			mediaURL, err = h.config.Storage.UploadMediaWithFilename(ctx, data, event.MediaType, h.config.CompanyID, event.FileName)
		} else {
			mediaURL, err = h.config.Storage.UploadMedia(ctx, data, event.MediaType, h.config.CompanyID)
		}

		if err != nil {
			log.Printf("Failed to upload media to storage: %v", err)
			return
		}

		event.MediaURL = mediaURL
		event.MediaSize = int64(len(data))
		log.Printf("Media uploaded successfully: %s", mediaURL)
	} else {
		log.Println("Storage not configured, media not persisted")
	}
}

// downloadHistoryMedia downloads media from history sync with rate limiting.
// Uses retry logic with exponential backoff for robustness.
// Timeout is extended to 75s to accommodate retry delays (1s + 2s + 4s backoff).
// Returns true if download was successful, false otherwise.
func (h *Handler) downloadHistoryMedia(downloadable whatsmeow.DownloadableMessage, event *natsClient.MessageEvent) bool {
	retainMediaReference(downloadable, event)
	if h.config.Client == nil {
		log.Println("Client not available for history media download")
		return false
	}

	if h.config.Storage == nil {
		log.Println("Storage not configured, skipping history media download")
		return false
	}

	// Create a context with timeout for media download and upload.
	// Extended from 60s to 75s to accommodate retry delays (up to ~7s total backoff).
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()

	// Download the media with retry logic (exponential backoff)
	data, err := h.downloadWithRetry(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download history media after retry exhaustion: %v", err)
		return false
	}

	log.Printf("Downloaded history media: %d bytes, type: %s", len(data), event.MediaType)

	// Upload to storage
	var mediaURL string
	if event.FileName != "" {
		mediaURL, err = h.config.Storage.UploadMediaWithFilename(ctx, data, event.MediaType, h.config.CompanyID, event.FileName)
	} else {
		mediaURL, err = h.config.Storage.UploadMedia(ctx, data, event.MediaType, h.config.CompanyID)
	}

	if err != nil {
		log.Printf("Failed to upload history media to storage: %v", err)
		return false
	}

	event.MediaURL = mediaURL
	event.MediaSize = int64(len(data))
	log.Printf("History media uploaded: %s", mediaURL)

	// Rate limiting: small delay between media downloads to avoid overwhelming
	time.Sleep(100 * time.Millisecond)

	return true
}

func (h *Handler) processHistoryMedia(
	downloadable whatsmeow.DownloadableMessage,
	event *natsClient.MessageEvent,
	deferDownload bool,
) bool {
	if deferDownload {
		retainMediaReference(downloadable, event)
		return false
	}
	return h.downloadHistoryMedia(downloadable, event)
}

// FetchProfilePicture resolves and caches a profile picture for command-driven
// group participant lookups. Empty results are cached too, because privacy
// settings commonly make profile pictures unavailable.
func (h *Handler) FetchProfilePicture(rawJID string) string {
	parsedJID, err := types.ParseJID(rawJID)
	if err != nil {
		return ""
	}
	jid := h.resolvePreferredJID(parsedJID, types.EmptyJID)
	cacheKey := jid.String()
	if cached, ok := h.profilePictureCache.Load(cacheKey); ok {
		return cached.(string)
	}

	result, _, _ := h.profilePictureRequests.Do(cacheKey, func() (interface{}, error) {
		if cached, ok := h.profilePictureCache.Load(cacheKey); ok {
			return cached.(string), nil
		}
		profilePictureURL := h.fetchProfilePicture(jid)
		h.profilePictureCache.Store(cacheKey, profilePictureURL)
		return profilePictureURL, nil
	})
	return result.(string)
}

// fetchProfilePicture downloads and uploads a contact's profile picture.
// Returns the private object reference if successful, empty string otherwise.
func (h *Handler) fetchProfilePicture(jid types.JID) string {
	if h.config.Client == nil {
		log.Println("Client not available for profile picture fetch")
		return ""
	}

	if h.config.Storage == nil {
		log.Println("Storage not configured, skipping profile picture fetch")
		return ""
	}

	// Get profile picture info from WhatsApp
	client := h.config.Client.GetClient()
	if client == nil {
		log.Println("WhatsApp client not available for profile picture fetch")
		return ""
	}

	// Get the profile picture (preview size is sufficient for contacts)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	picInfo, err := client.GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{
		Preview: true,
	})
	if err != nil {
		log.Printf("Failed to get profile picture info for %s: %v", jid.String(), err)
		return ""
	}

	if picInfo == nil || picInfo.URL == "" {
		// No profile picture set
		return ""
	}

	// Download the profile picture from the URL
	req, err := http.NewRequestWithContext(ctx, "GET", picInfo.URL, nil)
	if err != nil {
		log.Printf("Failed to create request for profile picture: %v", err)
		return ""
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Failed to download profile picture for %s: %v", jid.String(), err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Failed to download profile picture for %s: status %d", jid.String(), resp.StatusCode)
		return ""
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Failed to read profile picture data for %s: %v", jid.String(), err)
		return ""
	}

	log.Printf("Downloaded profile picture for %s: %d bytes", jid.String(), len(data))

	// Upload to storage
	mediaURL, err := h.config.Storage.UploadMedia(ctx, data, "image/jpeg", h.config.CompanyID)
	if err != nil {
		log.Printf("Failed to upload profile picture to storage: %v", err)
		return ""
	}

	log.Printf("Profile picture uploaded for %s: %s", jid.String(), mediaURL)
	return mediaURL
}
