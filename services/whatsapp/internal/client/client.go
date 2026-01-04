package client

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/logger"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/store"
)

// Config holds WhatsApp client configuration.
type Config struct {
	WorkerID     string
	CompanyID    string
	ConnectionID string
	DatabaseURL  string
	LogLevel     string
}

// QRCallback is called when a QR code is available for pairing.
type QRCallback func(qrCode string)

// StatusCallback is called when connection status changes.
type StatusCallback func(status string, reason string)

// Client wraps the whatsmeow client.
type Client struct {
	config       Config
	client       *whatsmeow.Client
	container    *store.PGContainer
	device       *waStore.Device
	handlers     []func(interface{})
	qrCallback   QRCallback
	statusCb     StatusCallback
	logger       waLog.Logger
	mu           sync.RWMutex
	connected    bool
	reconnecting bool
}

// New creates a new WhatsApp client wrapper.
func New(ctx context.Context, cfg Config) (*Client, error) {
	log.Printf("Initializing WhatsApp client for worker: %s, company: %s, connection: %s", cfg.WorkerID, cfg.CompanyID, cfg.ConnectionID)

	// Create logger
	logLevel := cfg.LogLevel
	if logLevel == "" {
		logLevel = "info"
	}
	waLogger := logger.New("whatsmeow", logLevel)

	// Initialize PostgreSQL store
	container, err := store.NewStore(ctx, store.Config{
		DatabaseURL:  cfg.DatabaseURL,
		ConnectionID: cfg.ConnectionID,
		Logger:       waLogger.Sub("store"),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create store: %w", err)
	}

	// Get or create device
	device, err := store.GetOrCreateDevice(ctx, container)
	if err != nil {
		return nil, fmt.Errorf("failed to get device: %w", err)
	}

	// Create whatsmeow client
	waClient := whatsmeow.NewClient(device, waLogger.Sub("client"))

	c := &Client{
		config:    cfg,
		client:    waClient,
		container: container,
		device:    device,
		handlers:  make([]func(interface{}), 0),
		logger:    waLogger,
	}

	// Register internal event handler to forward events
	waClient.AddEventHandler(c.internalEventHandler)

	return c, nil
}

// SetQRCallback sets the callback for QR code events.
func (c *Client) SetQRCallback(cb QRCallback) {
	c.qrCallback = cb
}

// SetStatusCallback sets the callback for status change events.
func (c *Client) SetStatusCallback(cb StatusCallback) {
	c.statusCb = cb
}

// internalEventHandler forwards events to registered handlers.
func (c *Client) internalEventHandler(evt interface{}) {
	c.mu.RLock()
	handlers := c.handlers
	c.mu.RUnlock()

	for _, handler := range handlers {
		handler(evt)
	}
}

// Connect establishes connection to WhatsApp.
func (c *Client) Connect(ctx context.Context) (err error) {
	// Recover from any panics in the whatsmeow library
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during WhatsApp connection: %v", r)
			log.Printf("Recovered from panic in Connect: %v", r)
		}
	}()

	log.Println("Connecting to WhatsApp...")

	// Check if we have a device ID (already logged in)
	if c.client.Store.ID == nil {
		// No device ID, need to pair via QR code
		log.Println("No existing session found, starting QR code pairing...")
		return c.connectWithQR(ctx)
	}

	// Already have a device, just connect
	log.Println("Existing session found, reconnecting...")
	return c.reconnect(ctx)
}

// connectWithQR starts the QR code pairing flow.
func (c *Client) connectWithQR(ctx context.Context) error {
	// Get QR channel
	qrChan, err := c.client.GetQRChannel(ctx)
	if err != nil {
		return fmt.Errorf("failed to get QR channel: %w", err)
	}

	// Connect to WhatsApp
	if err := c.client.Connect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	// Process QR events
	go func() {
		for evt := range qrChan {
			switch evt.Event {
			case "code":
				// QR code available
				log.Printf("QR code available: %s", evt.Code[:20]+"...")
				if c.qrCallback != nil {
					c.qrCallback(evt.Code)
				}
			case "success":
				// Pairing successful
				log.Println("QR code pairing successful")
				c.mu.Lock()
				c.connected = true
				c.mu.Unlock()
				if c.statusCb != nil {
					c.statusCb("connected", "paired")
				}
			case "timeout":
				// QR code timeout
				log.Println("QR code timeout")
				if c.statusCb != nil {
					c.statusCb("disconnected", "qr_timeout")
				}
			}
		}
	}()

	return nil
}

// reconnect reconnects an existing session.
func (c *Client) reconnect(ctx context.Context) error {
	if err := c.client.Connect(); err != nil {
		return fmt.Errorf("failed to reconnect: %w", err)
	}

	c.mu.Lock()
	c.connected = true
	c.mu.Unlock()

	return nil
}

// HandleReconnect handles reconnection on disconnect.
func (c *Client) HandleReconnect() {
	c.mu.Lock()
	if c.reconnecting {
		c.mu.Unlock()
		return
	}
	c.reconnecting = true
	c.connected = false
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.reconnecting = false
		c.mu.Unlock()
	}()

	// Wait before attempting reconnection
	time.Sleep(5 * time.Second)

	for attempts := 0; attempts < 5; attempts++ {
		log.Printf("Attempting reconnection (attempt %d/5)...", attempts+1)

		if err := c.client.Connect(); err != nil {
			log.Printf("Reconnection failed: %v", err)
			time.Sleep(time.Duration(attempts+1) * 10 * time.Second)
			continue
		}

		c.mu.Lock()
		c.connected = true
		c.mu.Unlock()

		log.Println("Reconnection successful")
		if c.statusCb != nil {
			c.statusCb("connected", "reconnected")
		}
		return
	}

	log.Println("Failed to reconnect after 5 attempts")
	if c.statusCb != nil {
		c.statusCb("disconnected", "reconnect_failed")
	}
}

// Disconnect closes the WhatsApp connection and the database.
func (c *Client) Disconnect() {
	log.Println("Disconnecting from WhatsApp...")

	// Recover from any panics during disconnect
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic in Disconnect: %v", r)
		}
	}()

	if c.client != nil && c.client.IsConnected() {
		c.client.Disconnect()
	}

	if c.container != nil {
		c.container.Close()
	}

	c.mu.Lock()
	c.connected = false
	c.mu.Unlock()
}

// RegisterEventHandler adds an event handler.
func (c *Client) RegisterEventHandler(handler func(interface{})) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers = append(c.handlers, handler)
}

// SendMessage sends a text message.
func (c *Client) SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string) error {
	// Parse JID
	recipient, err := types.ParseJID(jid)
	if err != nil {
		return fmt.Errorf("invalid JID %s: %w", jid, err)
	}

	var msg *waE2E.Message

	// If replying to a message, use ExtendedTextMessage with ContextInfo
	if replyTo != "" {
		// Use provided sender JID, or fall back to recipient JID
		participant := replyToSender
		if participant == "" {
			participant = jid
		}
		log.Printf("Sending reply message: stanzaId=%s, participant=%s", replyTo, participant)
		msg = &waE2E.Message{
			ExtendedTextMessage: &waE2E.ExtendedTextMessage{
				Text: proto.String(text),
				ContextInfo: &waE2E.ContextInfo{
					StanzaID:    proto.String(replyTo),
					Participant: proto.String(participant),
				},
			},
		}
	} else {
		// Simple text message
		msg = &waE2E.Message{
			Conversation: proto.String(text),
		}
	}

	// Send message
	resp, err := c.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	log.Printf("Message sent: ID=%s, ServerTimestamp=%v", resp.ID, resp.Timestamp)
	return nil
}

// SendMediaMessage sends a media message (image, document, video, audio).
func (c *Client) SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) error {
	// Parse JID
	recipient, err := types.ParseJID(jid)
	if err != nil {
		return fmt.Errorf("invalid JID %s: %w", jid, err)
	}

	// Use provided sender JID, or fall back to recipient JID
	participant := replyToSender
	if participant == "" {
		participant = jid
	}

	var msg *waE2E.Message

	switch mediaType {
	case "image":
		msg, err = c.createImageMessage(ctx, data, caption, mimeType, participant, replyTo)
	case "document":
		msg, err = c.createDocumentMessage(ctx, data, caption, fileName, mimeType, participant, replyTo)
	case "video":
		msg, err = c.createVideoMessage(ctx, data, caption, mimeType, participant, replyTo)
	case "audio":
		msg, err = c.createAudioMessage(ctx, data, mimeType, participant, replyTo)
	default:
		return fmt.Errorf("unsupported media type: %s", mediaType)
	}

	if err != nil {
		return fmt.Errorf("failed to create media message: %w", err)
	}

	// Send message
	resp, err := c.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return fmt.Errorf("failed to send media message: %w", err)
	}

	log.Printf("Media message sent: ID=%s, Type=%s", resp.ID, mediaType)
	return nil
}

// createImageMessage creates an image message.
func (c *Client) createImageMessage(ctx context.Context, data []byte, caption string, mimeType string, jid string, replyTo string) (*waE2E.Message, error) {
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	// Upload image to WhatsApp servers
	uploaded, err := c.client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return nil, fmt.Errorf("failed to upload image: %w", err)
	}

	imageMsg := &waE2E.ImageMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mimeType),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		Caption:       proto.String(caption),
	}

	// Add reply context if provided
	if replyTo != "" {
		imageMsg.ContextInfo = &waE2E.ContextInfo{
			StanzaID:    proto.String(replyTo),
			Participant: proto.String(jid),
		}
	}

	return &waE2E.Message{ImageMessage: imageMsg}, nil
}

// createDocumentMessage creates a document message.
func (c *Client) createDocumentMessage(ctx context.Context, data []byte, caption string, fileName string, mimeType string, jid string, replyTo string) (*waE2E.Message, error) {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if fileName == "" {
		fileName = "document"
	}

	// Upload document to WhatsApp servers
	uploaded, err := c.client.Upload(ctx, data, whatsmeow.MediaDocument)
	if err != nil {
		return nil, fmt.Errorf("failed to upload document: %w", err)
	}

	docMsg := &waE2E.DocumentMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mimeType),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		FileName:      proto.String(fileName),
		Caption:       proto.String(caption),
	}

	// Add reply context if provided
	if replyTo != "" {
		docMsg.ContextInfo = &waE2E.ContextInfo{
			StanzaID:    proto.String(replyTo),
			Participant: proto.String(jid),
		}
	}

	return &waE2E.Message{DocumentMessage: docMsg}, nil
}

// createVideoMessage creates a video message.
func (c *Client) createVideoMessage(ctx context.Context, data []byte, caption string, mimeType string, jid string, replyTo string) (*waE2E.Message, error) {
	if mimeType == "" {
		mimeType = "video/mp4"
	}

	// Upload video to WhatsApp servers
	uploaded, err := c.client.Upload(ctx, data, whatsmeow.MediaVideo)
	if err != nil {
		return nil, fmt.Errorf("failed to upload video: %w", err)
	}

	videoMsg := &waE2E.VideoMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mimeType),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		Caption:       proto.String(caption),
	}

	// Add reply context if provided
	if replyTo != "" {
		videoMsg.ContextInfo = &waE2E.ContextInfo{
			StanzaID:    proto.String(replyTo),
			Participant: proto.String(jid),
		}
	}

	return &waE2E.Message{VideoMessage: videoMsg}, nil
}

// createAudioMessage creates an audio message.
func (c *Client) createAudioMessage(ctx context.Context, data []byte, mimeType string, jid string, replyTo string) (*waE2E.Message, error) {
	if mimeType == "" {
		mimeType = "audio/ogg; codecs=opus"
	}

	// Upload audio to WhatsApp servers
	uploaded, err := c.client.Upload(ctx, data, whatsmeow.MediaAudio)
	if err != nil {
		return nil, fmt.Errorf("failed to upload audio: %w", err)
	}

	audioMsg := &waE2E.AudioMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mimeType),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		PTT:           proto.Bool(true), // Push-to-talk (voice note)
	}

	// Add reply context if provided
	if replyTo != "" {
		audioMsg.ContextInfo = &waE2E.ContextInfo{
			StanzaID:    proto.String(replyTo),
			Participant: proto.String(jid),
		}
	}

	return &waE2E.Message{AudioMessage: audioMsg}, nil
}

// GetQRCode returns the QR code for device pairing (deprecated, use Connect with callback).
func (c *Client) GetQRCode(ctx context.Context) (string, error) {
	return "", fmt.Errorf("use Connect() with SetQRCallback instead")
}

// IsLoggedIn checks if the client is authenticated.
func (c *Client) IsLoggedIn() bool {
	if c.client == nil {
		return false
	}
	return c.client.IsLoggedIn()
}

// IsConnected checks if the client is connected.
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected && c.client != nil && c.client.IsConnected()
}

// GetClient returns the underlying whatsmeow client.
func (c *Client) GetClient() *whatsmeow.Client {
	return c.client
}

// GetJID returns the JID of the logged-in device.
func (c *Client) GetJID() string {
	if c.client.Store.ID == nil {
		return ""
	}
	return c.client.Store.ID.String()
}

// DownloadMedia downloads media from a message.
func (c *Client) DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error) {
	return c.client.Download(ctx, msg)
}
