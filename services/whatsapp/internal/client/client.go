package client

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	waStore "go.mau.fi/whatsmeow/store"
	waTypes "go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/logger"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/store"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

// Backoff configuration constants for the two-phase reconnection strategy.
const (
	// Initial backoff duration for exponential phase
	initialBackoff = 2 * time.Second

	// Maximum backoff duration during exponential phase
	maxTransientBackoff = 30 * time.Second

	// Duration of the transient (exponential) phase
	transientPhaseDuration = 5 * time.Minute

	// Fixed backoff duration during persistent phase
	persistentBackoff = 2 * time.Minute

	// Jitter factor for randomization (±10%)
	jitterFactor = 0.1
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
	config              Config
	client              *whatsmeow.Client
	container           *store.PGContainer
	device              *waStore.Device
	handlers            []func(interface{})
	qrCallback          QRCallback
	statusCb            StatusCallback
	logger              waLog.Logger
	mu                  sync.RWMutex
	connected           bool
	reconnecting        bool
	ctx                 context.Context
	cancelReconnect     context.CancelFunc
	reconnectMu         sync.Mutex
	reconnectStartTime  time.Time
	reconnectAttemptNum int
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

	// Create a cancellable context for controlling reconnection loops
	reconnectCtx, cancelReconnect := context.WithCancel(ctx)

	c := &Client{
		config:          cfg,
		client:          waClient,
		container:       container,
		device:          device,
		handlers:        make([]func(interface{}), 0),
		logger:          waLogger,
		ctx:             reconnectCtx,
		cancelReconnect: cancelReconnect,
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
	// Check context state before proceeding
	select {
	case <-ctx.Done():
		return fmt.Errorf("context cancelled before QR flow: %w", ctx.Err())
	default:
	}

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

// calculateBackoff computes the backoff duration based on the two-phase strategy.
// Phase 1 (transient): Exponential backoff from 2s to 30s for the first 5 minutes.
// Phase 2 (persistent): Fixed 2-minute intervals with ±10% jitter after 5 minutes.
func (c *Client) calculateBackoff() time.Duration {
	now := time.Now()
	elapsed := now.Sub(c.reconnectStartTime)

	var baseDuration time.Duration
	isTransientPhase := elapsed < transientPhaseDuration

	if isTransientPhase {
		// Phase 1: Exponential backoff
		// Calculate which attempt number we're on (0-indexed)
		attempt := c.reconnectAttemptNum

		// Exponential formula: min(initial * 2^attempt, maxTransientBackoff)
		exponentialBackoff := initialBackoff * time.Duration(1<<uint(attempt))
		if exponentialBackoff > maxTransientBackoff {
			exponentialBackoff = maxTransientBackoff
		}
		baseDuration = exponentialBackoff
	} else {
		// Phase 2: Persistent phase with fixed 2-minute intervals
		baseDuration = persistentBackoff
	}

	// Apply jitter: ±jitterFactor (e.g., ±10%)
	// Generate random value in [1-jitterFactor, 1+jitterFactor]
	jitterRange := 2 * jitterFactor
	jitterOffset := (rand.Float64() * jitterRange) - jitterFactor
	durationWithJitter := float64(baseDuration) * (1 + jitterOffset)

	return time.Duration(durationWithJitter)
}

// HandleReconnect handles reconnection on disconnect with an infinite loop.
// It implements a two-phase backoff strategy and continues indefinitely until
// successful connection or context cancellation.
//
// The ctx parameter is optional for cancellation control. If nil, the client's
// stored context is used. If the stored context is also nil, context.Background()
// is used (which never cancels).
func (c *Client) HandleReconnect(ctx context.Context) {
	// Prevent duplicate reconnection loops
	if !c.reconnectMu.TryLock() {
		log.Println("Reconnection loop already active, skipping duplicate call")
		return
	}
	defer c.reconnectMu.Unlock()

	// Determine which context to use for cancellation
	// Priority: passed ctx > stored c.ctx > context.Background()
	shutdownCtx := ctx
	if shutdownCtx == nil {
		shutdownCtx = c.ctx
	}
	if shutdownCtx == nil {
		shutdownCtx = context.Background()
	}

	// Mark as not connected and start reconnection
	c.mu.Lock()
	c.reconnecting = true
	c.connected = false
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.reconnecting = false
		c.mu.Unlock()
	}()

	// Initialize reconnection tracking
	c.reconnectStartTime = time.Now()
	c.reconnectAttemptNum = 0

	log.Println("Starting infinite reconnection loop...")

	for {
		// Check if context is cancelled
		select {
		case <-shutdownCtx.Done():
			log.Println("Reconnection loop cancelled by context")
			if c.statusCb != nil {
				c.statusCb("disconnected", "shutdown")
			}
			return
		default:
		}

		// Increment attempt counter
		c.reconnectAttemptNum++

		// Determine if we're in transient phase
		elapsed := time.Since(c.reconnectStartTime)
		isTransientPhase := elapsed < transientPhaseDuration

		// Log every attempt in Phase 1, every 10th in Phase 2
		if isTransientPhase || c.reconnectAttemptNum%10 == 1 {
			phase := "transient"
			if !isTransientPhase {
				phase = "persistent"
			}
			log.Printf("Reconnection attempt #%d (phase: %s, elapsed: %v)",
				c.reconnectAttemptNum, phase, elapsed.Round(time.Second))
		}

		// Attempt connection
		if err := c.client.Connect(); err != nil {
			log.Printf("Reconnection attempt #%d failed: %v", c.reconnectAttemptNum, err)

			// Calculate backoff duration
			backoff := c.calculateBackoff()

			if isTransientPhase || c.reconnectAttemptNum%10 == 1 {
				log.Printf("Waiting %v before next attempt...", backoff.Round(time.Millisecond))
			}

			// Wait for backoff duration or context cancellation
			select {
			case <-shutdownCtx.Done():
				log.Println("Reconnection loop cancelled during backoff")
				if c.statusCb != nil {
					c.statusCb("disconnected", "shutdown")
				}
				return
			case <-time.After(backoff):
				// Continue to next attempt
			}

			continue
		}

		// Connection successful
		c.mu.Lock()
		c.connected = true
		c.mu.Unlock()

		log.Printf("Reconnection successful after %d attempts (elapsed: %v)",
			c.reconnectAttemptNum, time.Since(c.reconnectStartTime).Round(time.Millisecond))
		if c.statusCb != nil {
			c.statusCb("connected", "reconnected")
		}
		return
	}
}

// StopReconnect cancels any active reconnection loop for graceful shutdown.
// It causes an active HandleReconnect loop to exit within 1 second.
func (c *Client) StopReconnect() {
	log.Println("Stopping reconnection loop...")
	if c.cancelReconnect != nil {
		c.cancelReconnect()
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
func (c *Client) SendMessage(ctx context.Context, jid string, text string, replyTo string, replyToSender string) (types.SendResponse, error) {
	// Parse JID
	recipient, err := waTypes.ParseJID(jid)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("invalid JID %s: %w", jid, err)
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
		return types.SendResponse{}, fmt.Errorf("failed to send message: %w", err)
	}

	log.Printf("Message sent: ID=%s, ServerTimestamp=%v", resp.ID, resp.Timestamp)
	return types.SendResponse{
		ID:        string(resp.ID),
		Timestamp: resp.Timestamp,
	}, nil
}

// SendMediaMessage sends a media message (image, document, video, audio).
func (c *Client) SendMediaMessage(ctx context.Context, jid string, mediaType string, data []byte, caption string, fileName string, mimeType string, replyTo string, replyToSender string) (types.SendResponse, error) {
	// Parse JID
	recipient, err := waTypes.ParseJID(jid)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("invalid JID %s: %w", jid, err)
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
		return types.SendResponse{}, fmt.Errorf("unsupported media type: %s", mediaType)
	}

	if err != nil {
		return types.SendResponse{}, fmt.Errorf("failed to create media message: %w", err)
	}

	// Send message
	resp, err := c.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("failed to send media message: %w", err)
	}

	log.Printf("Media message sent: ID=%s, Type=%s", resp.ID, mediaType)
	return types.SendResponse{
		ID:        string(resp.ID),
		Timestamp: resp.Timestamp,
	}, nil
}

// SendReaction sends a reaction to a message.
// emoji can be an emoji string to add a reaction, or empty string to remove reaction.
// fromMe indicates whether the message being reacted to was sent by us (true) or received (false).
func (c *Client) SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, fromMe bool) (types.SendResponse, error) {
	// Parse chat JID
	recipient, err := waTypes.ParseJID(chatJID)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("invalid chat JID %s: %w", chatJID, err)
	}

	// Create reaction message using waCommon.MessageKey
	reactionMsg := &waE2E.ReactionMessage{
		Key: &waCommon.MessageKey{
			RemoteJID: proto.String(chatJID),
			FromMe:    proto.Bool(fromMe), // Use the fromMe parameter to indicate if we sent the original message
			ID:        proto.String(messageID),
		},
		Text:              proto.String(emoji),
		SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
	}

	msg := &waE2E.Message{
		ReactionMessage: reactionMsg,
	}

	// Send reaction
	resp, err := c.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("failed to send reaction: %w", err)
	}

	log.Printf("Reaction sent: ID=%s, TargetMessage=%s, Emoji=%s, FromMe=%v", resp.ID, messageID, emoji, fromMe)
	return types.SendResponse{
		ID:        string(resp.ID),
		Timestamp: resp.Timestamp,
	}, nil
}

// SendChatPresence sends a typing indicator to a chat.
// isTyping=true shows "typing...", isTyping=false shows "paused" (stopped typing).
func (c *Client) SendChatPresence(ctx context.Context, jidStr string, isTyping bool) error {
	jid, err := waTypes.ParseJID(jidStr)
	if err != nil {
		return fmt.Errorf("invalid JID %s: %w", jidStr, err)
	}

	var state waTypes.ChatPresence
	if isTyping {
		state = waTypes.ChatPresenceComposing
	} else {
		state = waTypes.ChatPresencePaused
	}

	if err := c.client.SendChatPresence(ctx, jid, state, waTypes.ChatPresenceMediaText); err != nil {
		return fmt.Errorf("failed to send chat presence: %w", err)
	}

	log.Printf("Chat presence sent: jid=%s, isTyping=%v", jidStr, isTyping)
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

// DownloadMediaWithPath downloads media using its direct path and keys.
func (c *Client) DownloadMediaWithPath(ctx context.Context, directPath string, encFileHash, fileHash, mediaKey []byte, fileLength int, mediaType whatsmeow.MediaType, mmsType string) ([]byte, error) {
	return c.client.DownloadMediaWithPath(ctx, directPath, encFileHash, fileHash, mediaKey, fileLength, mediaType, mmsType)
}

// SendPresence updates the user's presence status on WhatsApp.
// Should be called after connecting to mark yourself as available so the server sends presence updates.
func (c *Client) SendPresence(ctx context.Context, state waTypes.Presence) error {
	if c.client == nil {
		return fmt.Errorf("client not initialized")
	}
	return c.client.SendPresence(ctx, state)
}

// SubscribePresence subscribes to presence updates for a specific contact.
// WhatsApp servers will send presence events for this contact after subscription.
func (c *Client) SubscribePresence(ctx context.Context, jid waTypes.JID) error {
	if c.client == nil {
		return fmt.Errorf("client not initialized")
	}
	return c.client.SubscribePresence(ctx, jid)
}

// Block operation constants.
const (
	blockMaxRetries = 3
	blockBaseDelay  = 1 * time.Second
)

// BlockContact blocks a contact on WhatsApp.
// Uses exponential backoff retry logic (3 attempts: 1s, 2s).
func (c *Client) BlockContact(ctx context.Context, jid string) error {
	return c.updateBlocklistWithRetry(ctx, jid, "block")
}

// UnblockContact unblocks a contact on WhatsApp.
// Uses exponential backoff retry logic (3 attempts: 1s, 2s).
func (c *Client) UnblockContact(ctx context.Context, jid string) error {
	return c.updateBlocklistWithRetry(ctx, jid, "unblock")
}

// updateBlocklistWithRetry is the internal helper that handles blocklist updates with retry logic.
func (c *Client) updateBlocklistWithRetry(ctx context.Context, jidStr string, action string) error {
	if c.client == nil {
		return fmt.Errorf("client not initialized")
	}

	// Parse the JID string
	parsedJID, err := waTypes.ParseJID(jidStr)
	if err != nil {
		return fmt.Errorf("failed to parse JID %s: %w", jidStr, err)
	}

	// Determine the blocklist action
	var blocklistAction events.BlocklistChangeAction
	switch action {
	case "block":
		blocklistAction = events.BlocklistChangeActionBlock
	case "unblock":
		blocklistAction = events.BlocklistChangeActionUnblock
	default:
		return fmt.Errorf("unknown blocklist action: %s", action)
	}

	var lastErr error
	for attempt := 0; attempt < blockMaxRetries; attempt++ {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Create a timeout context for this attempt
		attemptCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		_, err := c.client.UpdateBlocklist(attemptCtx, parsedJID, blocklistAction)
		cancel()

		if err == nil {
			log.Printf("Successfully %sed contact %s (attempt %d)", action, jidStr, attempt+1)
			return nil
		}

		lastErr = err
		log.Printf("Failed to %s contact %s (attempt %d/%d): %v", action, jidStr, attempt+1, blockMaxRetries, err)

		// Don't sleep on the last attempt
		if attempt < blockMaxRetries-1 {
			delay := blockBaseDelay * time.Duration(1<<uint(attempt)) // Exponential: 1s, 2s
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}
	}

	return fmt.Errorf("failed to %s contact after %d attempts: %w", action, blockMaxRetries, lastErr)
}
