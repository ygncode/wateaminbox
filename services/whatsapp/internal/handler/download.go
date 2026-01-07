// Package handler provides the download handler for on-demand media downloads.
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"go.mau.fi/whatsmeow"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// DownloadHandler handles on-demand media download requests.
type DownloadHandler struct {
	handler      *Handler
	subscription *nats.Subscription
	nc           *nats.Conn
	js           nats.JetStreamContext
}

// reconstructedMedia implements whatsmeow.DownloadableMessage for on-demand downloads.
// It reconstructs the download info from stored references.
type reconstructedMedia struct {
	directPath    string
	mediaKey      []byte
	fileSHA256    []byte
	fileEncSHA256 []byte
}

// Implement DownloadableMessage interface
func (r *reconstructedMedia) GetDirectPath() string {
	return r.directPath
}

func (r *reconstructedMedia) GetMediaKey() []byte {
	return r.mediaKey
}

func (r *reconstructedMedia) GetFileSHA256() []byte {
	return r.fileSHA256
}

func (r *reconstructedMedia) GetFileEncSHA256() []byte {
	return r.fileEncSHA256
}

// These methods are required by the interface but not used for download
func (r *reconstructedMedia) GetFileLength() uint64 {
	return 0
}

func (r *reconstructedMedia) GetMediaKeyTimestamp() int64 {
	return 0
}

func (r *reconstructedMedia) GetMimetype() string {
	return ""
}

// NewDownloadHandler creates a new download handler.
func NewDownloadHandler(h *Handler) (*DownloadHandler, error) {
	if h.publisher == nil {
		return nil, fmt.Errorf("publisher not initialized")
	}

	// Connect to NATS
	nc, err := nats.Connect(h.config.NATSUrl,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to get JetStream context: %w", err)
	}

	dh := &DownloadHandler{
		handler: h,
		nc:      nc,
		js:      js,
	}

	// Subscribe to download requests for this connection
	if err := dh.subscribe(); err != nil {
		nc.Close()
		return nil, fmt.Errorf("failed to subscribe: %w", err)
	}

	log.Printf("Download handler initialized for company %s, connection %s",
		h.config.CompanyID, h.config.ConnectionID)

	return dh, nil
}

// subscribe sets up the NATS subscription for download requests.
func (dh *DownloadHandler) subscribe() error {
	subject := fmt.Sprintf(natsClient.SubjectDownloadRequest,
		dh.handler.config.CompanyID, dh.handler.config.ConnectionID)

	log.Printf("Subscribing to download requests on: %s", subject)

	sub, err := dh.nc.Subscribe(subject, func(msg *nats.Msg) {
		dh.handleDownloadRequest(msg)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to %s: %w", subject, err)
	}

	dh.subscription = sub
	return nil
}

// handleDownloadRequest processes a single download request.
func (dh *DownloadHandler) handleDownloadRequest(msg *nats.Msg) {
	var req natsClient.DownloadRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		log.Printf("Failed to unmarshal download request: %v", err)
		return
	}

	log.Printf("Received download request for message: %s", req.MessageID)

	// Validate required fields
	if req.DirectPath == "" || len(req.MediaKey) == 0 {
		log.Printf("Invalid download request: missing required fields")
		dh.publishError(req.MessageID, "invalid request: missing required fields")
		return
	}

	// Reconstruct downloadable message
	downloadable := &reconstructedMedia{
		directPath:    req.DirectPath,
		mediaKey:      req.MediaKey,
		fileSHA256:    req.FileSHA256,
		fileEncSHA256: req.FileEncSHA256,
	}

	// Download the media
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	data, err := dh.downloadMedia(ctx, downloadable)
	if err != nil {
		log.Printf("Failed to download media for message %s: %v", req.MessageID, err)
		dh.publishError(req.MessageID, fmt.Sprintf("download failed: %v", err))
		return
	}

	log.Printf("Downloaded media: %d bytes for message %s", len(data), req.MessageID)

	// Upload to storage
	if dh.handler.config.Storage == nil {
		log.Printf("Storage not configured, cannot upload media")
		dh.publishError(req.MessageID, "storage not configured")
		return
	}

	var mediaURL string
	if req.FileName != "" {
		mediaURL, err = dh.handler.config.Storage.UploadMediaWithFilename(
			ctx, data, req.MediaType, dh.handler.config.CompanyID, req.FileName)
	} else {
		mediaURL, err = dh.handler.config.Storage.UploadMedia(
			ctx, data, req.MediaType, dh.handler.config.CompanyID)
	}

	if err != nil {
		log.Printf("Failed to upload media for message %s: %v", req.MessageID, err)
		dh.publishError(req.MessageID, fmt.Sprintf("upload failed: %v", err))
		return
	}

	log.Printf("Uploaded media for message %s: %s", req.MessageID, mediaURL)

	// Publish success response
	if err := dh.handler.publisher.PublishDownloadResponse(
		req.MessageID, mediaURL, int64(len(data)), true, ""); err != nil {
		log.Printf("Failed to publish download response: %v", err)
	}
}

// downloadMedia downloads media using the reconstructed reference.
func (dh *DownloadHandler) downloadMedia(ctx context.Context, downloadable whatsmeow.DownloadableMessage) ([]byte, error) {
	if dh.handler.config.Client == nil {
		return nil, fmt.Errorf("WhatsApp client not available")
	}

	// Use the handler's retry logic
	return dh.handler.downloadWithRetry(ctx, downloadable)
}

// publishError publishes an error response for a download request.
func (dh *DownloadHandler) publishError(messageID, errMsg string) {
	if err := dh.handler.publisher.PublishDownloadResponse(
		messageID, "", 0, false, errMsg); err != nil {
		log.Printf("Failed to publish error response: %v", err)
	}
}

// Close closes the download handler and unsubscribes from NATS.
func (dh *DownloadHandler) Close() {
	if dh.subscription != nil {
		dh.subscription.Unsubscribe()
	}
	if dh.nc != nil {
		dh.nc.Close()
	}
	log.Printf("Download handler closed")
}
