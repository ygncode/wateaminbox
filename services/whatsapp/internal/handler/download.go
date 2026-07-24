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

// mediaTypeMapping maps request media types to whatsmeow MediaType constants.
var mediaTypeMapping = map[string]whatsmeow.MediaType{
	"image":    whatsmeow.MediaImage,
	"video":    whatsmeow.MediaVideo,
	"audio":    whatsmeow.MediaAudio,
	"document": whatsmeow.MediaDocument,
}

// mmsTypeMapping maps request media types to MMS type strings.
var mmsTypeMapping = map[string]string{
	"image":    "image",
	"video":    "video",
	"audio":    "audio",
	"document": "document",
}

// DownloadHandler handles on-demand media download requests.
type DownloadHandler struct {
	handler      *Handler
	subscription *nats.Subscription
	nc           *nats.Conn
	js           nats.JetStreamContext
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

// subscribe sets up the JetStream subscription for download requests.
func (dh *DownloadHandler) subscribe() error {
	subject := fmt.Sprintf(natsClient.SubjectDownloadRequest,
		dh.handler.config.CompanyID, dh.handler.config.ConnectionID)

	log.Printf("Subscribing to download requests on: %s (JetStream)", subject)

	// Use JetStream subscription with ephemeral consumer
	// This ensures messages are acknowledged and not redelivered
	sub, err := dh.js.Subscribe(
		subject,
		func(msg *nats.Msg) {
			dh.handleDownloadRequest(msg)
			// Acknowledge the message after processing
			if err := msg.Ack(); err != nil {
				log.Printf("Failed to ack download request: %v", err)
			}
		},
		nats.DeliverNew(),             // Only receive new messages
		nats.AckExplicit(),            // Require explicit acknowledgment
		nats.MaxDeliver(3),            // Retry up to 3 times on failure
		nats.AckWait(120*time.Second), // Wait up to 2 minutes for ack (downloads can be slow)
	)
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

	log.Printf("Received download request for message: %s, mediaType: %s", req.MessageID, req.MediaType)

	// Validate required fields
	if req.DirectPath == "" || len(req.MediaKey) == 0 {
		log.Printf("Invalid download request: missing required fields")
		dh.publishError(req.MessageID, "invalid request: missing required fields")
		return
	}

	// Map request media type to whatsmeow MediaType
	mediaType, ok := mediaTypeMapping[req.MediaType]
	if !ok {
		log.Printf("Unknown media type: %s, defaulting to document", req.MediaType)
		mediaType = whatsmeow.MediaDocument
	}

	mmsType, ok := mmsTypeMapping[req.MediaType]
	if !ok {
		mmsType = "document"
	}

	// Download the media using DownloadMediaWithPath
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if dh.handler.config.Client == nil {
		log.Printf("WhatsApp client not available for download")
		dh.publishError(req.MessageID, "WhatsApp client not available")
		return
	}

	// Get the underlying whatsmeow client to access DownloadMediaWithPath
	client := dh.handler.config.Client.GetClient()
	if client == nil {
		log.Printf("WhatsApp client not initialized for download")
		dh.publishError(req.MessageID, "WhatsApp client not initialized")
		return
	}

	// Use DownloadMediaWithPath which takes raw parameters directly
	// This avoids the type assertion issue with custom DownloadableMessage implementations
	// Pass -1 for fileLength to skip length validation (whatsmeow validates when >= 0)
	data, err := client.DownloadMediaWithPath(
		ctx,
		req.DirectPath,
		req.FileEncSHA256,
		req.FileSHA256,
		req.MediaKey,
		-1, // fileLength - pass -1 to skip length validation
		mediaType,
		mmsType,
	)
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
