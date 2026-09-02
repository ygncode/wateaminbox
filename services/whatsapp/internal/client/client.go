package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	waBinary "go.mau.fi/whatsmeow/binary"
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
	WorkerID       string
	CompanyID      string
	ConnectionID   string
	DatabaseURL    string
	RequiredDBRole string
	LogLevel       string

	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration
	DBConnMaxIdleTime time.Duration
}

// QRCallback is called when a QR code is available for pairing.
type QRCallback func(qrCode string)

// StatusCallback is called when connection status changes.
type StatusCallback func(status string, reason string)

type labelRecoveryWaiter struct {
	labels map[string]types.WhatsAppLabel
	done   chan []types.WhatsAppLabel
}

type appStateResetter interface {
	ResetAppState(context.Context, string) error
}

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
	appStateSyncMu      sync.Mutex
	labelRecoveryMu     sync.Mutex
	labelRecovery       *labelRecoveryWaiter
	catalogTokenMu      sync.Mutex
	catalogToken        string
	catalogOwnerJID     waTypes.JID
	catalogLIDJID       waTypes.JID
	catalogDeviceID     uint16
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
		DatabaseURL:     cfg.DatabaseURL,
		RequiredRole:    cfg.RequiredDBRole,
		ConnectionID:    cfg.ConnectionID,
		Logger:          waLogger.Sub("store"),
		MaxOpenConns:    cfg.DBMaxOpenConns,
		MaxIdleConns:    cfg.DBMaxIdleConns,
		ConnMaxLifetime: cfg.DBConnMaxLifetime,
		ConnMaxIdleTime: cfg.DBConnMaxIdleTime,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create store: %w", err)
	}

	// Get or create device
	device, err := store.GetOrCreateDevice(ctx, container)
	if err != nil {
		return nil, fmt.Errorf("failed to get device: %w", err)
	}

	// Create whatsmeow client. If an offline group message cannot be decrypted
	// because its sender key is missing, whatsmeow first asks the sender to
	// retry. The sender may no longer be online after a server outage, so also
	// ask the primary phone for the message after whatsmeow's retry delay.
	waClient := whatsmeow.NewClient(device, waLogger.Sub("client"))
	configureMessageRecovery(waClient)

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

	// Cache the stable account identifiers before networking starts. Pairing
	// refreshes the cache from the Connected event after whatsmeow stores them.
	c.cacheCatalogIdentity()

	// Register internal event handler to forward events
	waClient.AddEventHandler(c.internalEventHandler)

	return c, nil
}

func configureMessageRecovery(waClient *whatsmeow.Client) {
	waClient.AutomaticMessageRerequestFromPhone = true
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
	c.captureLabelRecoveryEvent(evt)
	if _, connected := evt.(*events.Connected); connected {
		c.cacheCatalogIdentity()
	}

	c.mu.RLock()
	handlers := c.handlers
	c.mu.RUnlock()

	for _, handler := range handlers {
		handler(evt)
	}
}

// cacheCatalogIdentity copies account identifiers that WhatsMeow owns into
// fields guarded by Client.mu. SyncCatalog can then avoid racing reconnects
// that update the WhatsMeow device store.
func (c *Client) cacheCatalogIdentity() {
	var owner, lid waTypes.JID
	var deviceID uint16
	if c.client.Store.ID != nil {
		deviceID = c.client.Store.ID.Device
		owner = c.client.Store.ID.ToNonAD()
	}
	if c.client.Store.LID.User != "" {
		lid = c.client.Store.LID.ToNonAD()
	}
	c.mu.Lock()
	if !owner.IsEmpty() {
		c.catalogOwnerJID = owner
		c.catalogDeviceID = deviceID
	}
	if !lid.IsEmpty() {
		c.catalogLIDJID = lid
	}
	c.mu.Unlock()
}

func (c *Client) catalogIdentity() (owner, lid waTypes.JID, deviceID uint16) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.catalogOwnerJID, c.catalogLIDJID, c.catalogDeviceID
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
	if err := ensureSocketConnected(c.client.IsConnected, c.client.Connect); err != nil {
		return fmt.Errorf("failed to reconnect: %w", err)
	}

	c.mu.Lock()
	c.connected = true
	c.mu.Unlock()

	return nil
}

// ensureSocketConnected tolerates the race where whatsmeow restores its socket
// after a Disconnected event but before our reconnect attempt runs. Connect
// reports "websocket is already connected" in that case even though recovery
// has succeeded.
func ensureSocketConnected(isConnected func() bool, connect func() error) error {
	if isConnected() {
		return nil
	}
	if err := connect(); err != nil {
		if isConnected() {
			return nil
		}
		return err
	}
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
		if err := ensureSocketConnected(c.client.IsConnected, c.client.Connect); err != nil {
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

		log.Printf("Reconnect socket established after %d attempts (elapsed: %v); awaiting Connected event",
			c.reconnectAttemptNum, time.Since(c.reconnectStartTime).Round(time.Millisecond))
		// Connect() only establishes the socket. The WhatsApp protocol handshake
		// completes asynchronously, so the Connected event is the only reliable
		// point at which the connection may be reported as usable.
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

// logoutThenPurge preserves credentials when remote logout fails. Purging first
// would make a retry impossible while leaving the device linked at WhatsApp.
func logoutThenPurge(hasSession bool, logout, purge func() error) error {
	if hasSession {
		if err := logout(); err != nil {
			return fmt.Errorf("remote logout failed; credentials preserved for retry: %w", err)
		}
	}
	if err := purge(); err != nil {
		return fmt.Errorf("purge session credentials: %w", err)
	}
	return nil
}

// LogoutAndPurge unlinks the device from WhatsApp and then erases credentials
// and runtime state. Credentials remain intact until remote logout succeeds so
// durable unlink retries can authenticate and finish the operation.
func (c *Client) LogoutAndPurge(ctx context.Context) error {
	log.Println("Unlinking WhatsApp device and purging session credentials...")
	hasSession := c.client != nil && c.client.Store.ID != nil
	return logoutThenPurge(
		hasSession,
		func() error {
			if !c.client.IsConnected() {
				if err := c.client.Connect(); err != nil {
					return fmt.Errorf("connect for logout: %w", err)
				}
			}
			return c.client.Logout(ctx)
		},
		func() error {
			if c.container == nil {
				return nil
			}
			return c.container.PurgeSession(ctx)
		},
	)
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
	case "sticker":
		msg, err = c.createStickerMessage(ctx, data, mimeType, participant, replyTo)
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
// targetSenderJID identifies the author of the target message. WhatsApp requires
// it as the participant in the message key when reacting to an incoming group message.
// fromMe indicates whether the message being reacted to was sent by us (true) or received (false).
func (c *Client) SendReaction(ctx context.Context, chatJID string, messageID string, emoji string, targetSenderJID string, fromMe bool) (types.SendResponse, error) {
	// Parse chat JID
	recipient, err := waTypes.ParseJID(chatJID)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("invalid chat JID %s: %w", chatJID, err)
	}

	if recipient.Server == waTypes.GroupServer && !fromMe {
		targetSender, parseErr := waTypes.ParseJID(targetSenderJID)
		if parseErr != nil {
			return types.SendResponse{}, fmt.Errorf("invalid target sender JID %s: %w", targetSenderJID, parseErr)
		}
		targetSender, err = c.resolveGroupReactionSender(ctx, recipient, targetSender)
		if err != nil {
			return types.SendResponse{}, err
		}
		targetSenderJID = targetSender.String()
	}

	reactionKey, err := buildReactionKey(recipient, messageID, targetSenderJID, fromMe)
	if err != nil {
		return types.SendResponse{}, err
	}

	msg := buildReactionMessage(reactionKey, emoji)

	// Send reaction
	resp, err := c.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("failed to send reaction: %w", err)
	}

	log.Printf("Reaction sent: ID=%s, TargetMessage=%s, TargetSender=%s, Emoji=%s, FromMe=%v", resp.ID, messageID, reactionKey.GetParticipant(), emoji, fromMe)
	return types.SendResponse{
		ID:        string(resp.ID),
		Timestamp: resp.Timestamp,
	}, nil
}

func (c *Client) resolveGroupReactionSender(ctx context.Context, group, targetSender waTypes.JID) (waTypes.JID, error) {
	targetSender = targetSender.ToNonAD()
	// A stored protocol sender is already exact and avoids a group metadata
	// request. Phone-number identities need resolving because modern groups use
	// LIDs as their primary participant address.
	if targetSender.Server == waTypes.HiddenUserServer || targetSender.Server == waTypes.HostedLIDServer {
		return targetSender, nil
	}

	groupInfo, err := c.client.GetGroupInfo(ctx, group)
	if err != nil {
		return waTypes.EmptyJID, fmt.Errorf("failed to resolve participant for reaction in group %s: %w", group, err)
	}
	if sender, ok := findGroupReactionSender(targetSender, groupInfo.Participants); ok {
		return sender, nil
	}
	return waTypes.EmptyJID, fmt.Errorf("target sender %s is not a participant of group %s", targetSender, group)
}

func findGroupReactionSender(target waTypes.JID, participants []waTypes.GroupParticipant) (waTypes.JID, bool) {
	target = target.ToNonAD()
	for _, participant := range participants {
		identities := [...]waTypes.JID{
			participant.JID,
			participant.PhoneNumber,
			participant.LID,
		}
		matches := false
		for _, identity := range identities {
			if !identity.IsEmpty() && identity.ToNonAD() == target {
				matches = true
				break
			}
		}
		if !matches {
			continue
		}
		if !participant.JID.IsEmpty() {
			return participant.JID.ToNonAD(), true
		}
		if !participant.LID.IsEmpty() {
			return participant.LID.ToNonAD(), true
		}
		if !participant.PhoneNumber.IsEmpty() {
			return participant.PhoneNumber.ToNonAD(), true
		}
	}
	return waTypes.EmptyJID, false
}

func buildReactionKey(recipient waTypes.JID, messageID string, targetSenderJID string, fromMe bool) (*waCommon.MessageKey, error) {
	key := &waCommon.MessageKey{
		RemoteJID: proto.String(recipient.String()),
		FromMe:    proto.Bool(fromMe),
		ID:        proto.String(messageID),
	}
	if recipient.Server != waTypes.GroupServer || fromMe {
		return key, nil
	}
	if targetSenderJID == "" {
		return nil, fmt.Errorf("target sender JID is required for incoming group message %s", messageID)
	}
	targetSender, err := waTypes.ParseJID(targetSenderJID)
	if err != nil {
		return nil, fmt.Errorf("invalid target sender JID %s: %w", targetSenderJID, err)
	}
	key.Participant = proto.String(targetSender.ToNonAD().String())
	return key, nil
}

func buildReactionMessage(key *waCommon.MessageKey, emoji string) *waE2E.Message {
	return &waE2E.Message{
		ReactionMessage: &waE2E.ReactionMessage{
			Key:               key,
			Text:              proto.String(emoji),
			SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
		},
	}
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

func (c *Client) createStickerMessage(ctx context.Context, data []byte, mimeType string, jid string, replyTo string) (*waE2E.Message, error) {
	if mimeType == "" {
		mimeType = "image/webp"
	}
	uploaded, err := c.client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return nil, fmt.Errorf("failed to upload sticker: %w", err)
	}
	sticker := &waE2E.StickerMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mimeType),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
	}
	if replyTo != "" {
		sticker.ContextInfo = &waE2E.ContextInfo{
			StanzaID: proto.String(replyTo), Participant: proto.String(jid),
		}
	}
	return &waE2E.Message{StickerMessage: sticker}, nil
}

// PostStatus sends a text or media update to WhatsApp's status broadcast.
func (c *Client) PostStatus(ctx context.Context, statusType, content, mediaURL string) (types.SendResponse, error) {
	var msg *waE2E.Message
	var err error
	if statusType == "text" {
		msg = &waE2E.Message{Conversation: proto.String(content)}
	} else {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
		if reqErr != nil {
			return types.SendResponse{}, fmt.Errorf("invalid status media URL: %w", reqErr)
		}
		resp, reqErr := http.DefaultClient.Do(req)
		if reqErr != nil {
			return types.SendResponse{}, fmt.Errorf("failed to download status media: %w", reqErr)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return types.SendResponse{}, fmt.Errorf("status media download returned HTTP %d", resp.StatusCode)
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 32*1024*1024+1))
		if readErr != nil {
			return types.SendResponse{}, fmt.Errorf("failed to read status media: %w", readErr)
		}
		if len(data) > 32*1024*1024 {
			return types.SendResponse{}, fmt.Errorf("status media exceeds 32 MiB")
		}
		mimeType := resp.Header.Get("Content-Type")
		switch statusType {
		case "image":
			msg, err = c.createImageMessage(ctx, data, content, mimeType, "", "")
		case "video":
			msg, err = c.createVideoMessage(ctx, data, content, mimeType, "", "")
		case "audio":
			msg, err = c.createAudioMessage(ctx, data, mimeType, "", "")
		default:
			return types.SendResponse{}, fmt.Errorf("unsupported status type %q", statusType)
		}
		if err != nil {
			return types.SendResponse{}, err
		}
	}
	result, err := c.client.SendMessage(ctx, waTypes.StatusBroadcastJID, msg)
	if err != nil {
		return types.SendResponse{}, fmt.Errorf("failed to post status: %w", err)
	}
	return types.SendResponse{ID: string(result.ID), Timestamp: result.Timestamp}, nil
}

func (c *Client) ApplyLabel(ctx context.Context, contactJID, labelID string, labeled bool) error {
	jid, err := waTypes.ParseJID(contactJID)
	if err != nil {
		return fmt.Errorf("invalid contact JID: %w", err)
	}
	return c.client.SendAppState(ctx, appstate.BuildLabelChat(jid, labelID, labeled))
}

func (c *Client) SyncLabels(ctx context.Context) ([]types.WhatsAppLabel, error) {
	// A full app-state fetch can cause whatsmeow to dispatch events while it
	// waits for the server response. Never hold c.mu here: internalEventHandler
	// needs that mutex, and blocking the event loop also blocks the app-state
	// response, deadlocking this command and the sequential NATS consumer.
	c.appStateSyncMu.Lock()
	defer c.appStateSyncMu.Unlock()

	previousEmitSetting := c.client.EmitAppStateEventsOnFullSync
	c.client.EmitAppStateEventsOnFullSync = true
	defer func() {
		c.client.EmitAppStateEventsOnFullSync = previousEmitSetting
	}()

	eventsToProcess, err := c.client.DangerousInternals().FetchAppState(ctx, appstate.WAPatchRegular, true, false)
	if err != nil {
		if errors.Is(err, appstate.ErrMismatchingLTHash) {
			// whatsmeow's full sync clears only the saved version. Clear the
			// mutation MAC cache too, then retry once from an actually clean
			// snapshot before asking the primary device for recovery.
			if resetter, ok := c.client.Store.AppState.(appStateResetter); ok {
				if resetErr := resetter.ResetAppState(ctx, string(appstate.WAPatchRegular)); resetErr != nil {
					return nil, fmt.Errorf("failed to reset labels app state after hash mismatch: %w", resetErr)
				}
				eventsToProcess, err = c.client.DangerousInternals().FetchAppState(ctx, appstate.WAPatchRegular, true, false)
				if err == nil {
					return labelsFromAppStateEvents(eventsToProcess), nil
				}
			}
		}
		if errors.Is(err, appstate.ErrMismatchingLTHash) {
			return c.recoverLabels(ctx)
		}
		return nil, fmt.Errorf("failed to fetch labels app state: %w", err)
	}
	return labelsFromAppStateEvents(eventsToProcess), nil
}

func labelsFromAppStateEvents(eventsToProcess []any) []types.WhatsAppLabel {
	labels := make([]types.WhatsAppLabel, 0)
	for _, evt := range eventsToProcess {
		label, ok := evt.(*events.LabelEdit)
		if !ok || label.Action == nil || label.Action.GetDeleted() {
			continue
		}
		labels = append(labels, types.WhatsAppLabel{
			ID: label.LabelID, Name: label.Action.GetName(), Color: label.Action.GetColor(), PredefinedID: label.Action.GetPredefinedID(),
		})
	}
	return labels
}

func (c *Client) recoverLabels(ctx context.Context) ([]types.WhatsAppLabel, error) {
	waiter := &labelRecoveryWaiter{
		labels: make(map[string]types.WhatsAppLabel),
		done:   make(chan []types.WhatsAppLabel, 1),
	}
	c.labelRecoveryMu.Lock()
	c.labelRecovery = waiter
	c.labelRecoveryMu.Unlock()
	defer c.clearLabelRecovery(waiter)

	// A failed encrypted snapshot can leave a partially advanced version in the
	// store. Reset it so whatsmeow accepts the authoritative recovery snapshot
	// even when both snapshots report the same version.
	if err := c.client.Store.AppState.DeleteAppStateVersion(ctx, string(appstate.WAPatchRegular)); err != nil {
		return nil, fmt.Errorf("failed to reset labels app state for recovery: %w", err)
	}
	if _, err := c.client.SendPeerMessage(
		ctx,
		whatsmeow.BuildAppStateRecoveryRequest(appstate.WAPatchRegular),
	); err != nil {
		return nil, fmt.Errorf("failed to request labels recovery from the primary device: %w", err)
	}

	select {
	case labels := <-waiter.done:
		return labels, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("timed out waiting for labels recovery from the primary device: %w", ctx.Err())
	}
}

func (c *Client) clearLabelRecovery(waiter *labelRecoveryWaiter) {
	c.labelRecoveryMu.Lock()
	if c.labelRecovery == waiter {
		c.labelRecovery = nil
	}
	c.labelRecoveryMu.Unlock()
}

func (c *Client) captureLabelRecoveryEvent(evt interface{}) {
	c.labelRecoveryMu.Lock()
	waiter := c.labelRecovery
	if waiter == nil {
		c.labelRecoveryMu.Unlock()
		return
	}

	switch event := evt.(type) {
	case *events.LabelEdit:
		if event.Action == nil {
			break
		}
		if event.Action.GetDeleted() {
			delete(waiter.labels, event.LabelID)
			break
		}
		waiter.labels[event.LabelID] = types.WhatsAppLabel{
			ID:           event.LabelID,
			Name:         event.Action.GetName(),
			Color:        event.Action.GetColor(),
			PredefinedID: event.Action.GetPredefinedID(),
		}
	case *events.AppStateSyncComplete:
		if event.Name != appstate.WAPatchRegular || !event.Recovery {
			break
		}
		labels := make([]types.WhatsAppLabel, 0, len(waiter.labels))
		for _, label := range waiter.labels {
			labels = append(labels, label)
		}
		sort.Slice(labels, func(i, j int) bool {
			return labels[i].ID < labels[j].ID
		})
		c.labelRecovery = nil
		c.labelRecoveryMu.Unlock()
		waiter.done <- labels
		return
	}
	c.labelRecoveryMu.Unlock()
}

func nodeText(node waBinary.Node, tags ...string) string {
	current := node
	if len(tags) > 0 {
		var ok bool
		current, ok = node.GetOptionalChildByTag(tags...)
		if !ok {
			return ""
		}
	}
	if data, ok := current.Content.([]byte); ok {
		return string(data)
	}
	return ""
}

func nodeAttr(node waBinary.Node, keys ...string) string {
	for _, key := range keys {
		if value, ok := node.Attrs[key]; ok {
			return fmt.Sprint(value)
		}
	}
	return ""
}

func collectNodes(node waBinary.Node, tag string, out *[]waBinary.Node) {
	if node.Tag == tag {
		*out = append(*out, node)
	}
	for _, child := range node.GetChildren() {
		collectNodes(child, tag, out)
	}
}

const (
	catalogFacebookQueryID = "9957894520961099"
	catalogFacebookURL     = "https://graph.facebook.com/graphql"
	catalogPageSize        = "100"
	catalogMaxPages        = 20
)

var errCatalogAuthentication = errors.New("catalog authentication failed")

type catalogBoolean bool

func (value *catalogBoolean) UnmarshalJSON(data []byte) error {
	if bytes.Equal(data, []byte("null")) {
		*value = false
		return nil
	}
	var boolean bool
	if err := json.Unmarshal(data, &boolean); err == nil {
		*value = catalogBoolean(boolean)
		return nil
	}
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return fmt.Errorf("invalid catalog boolean: %w", err)
	}
	parsed, err := strconv.ParseBool(text)
	if err != nil {
		return fmt.Errorf("invalid catalog boolean %q: %w", text, err)
	}
	*value = catalogBoolean(parsed)
	return nil
}

type catalogGraphQLProduct struct {
	ID           string         `json:"id"`
	RetailerID   string         `json:"retailer_id"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Price        string         `json:"price"`
	Currency     string         `json:"currency"`
	Availability string         `json:"availability"`
	URL          string         `json:"url"`
	IsHidden     catalogBoolean `json:"is_hidden"`
	IsSanctioned catalogBoolean `json:"is_sanctioned"`
	Media        struct {
		Images []struct {
			OriginalURL string `json:"original_image_url"`
			RequestURL  string `json:"request_image_url"`
		} `json:"images"`
	} `json:"media"`
}

type catalogGraphQLError struct {
	Code       int    `json:"code"`
	Message    string `json:"message"`
	Extensions struct {
		ErrorCode int `json:"error_code"`
	} `json:"extensions"`
}

type catalogGraphQLResponse struct {
	Data struct {
		Catalog struct {
			ProductCatalog *struct {
				ID       string                  `json:"catalog_id"`
				Name     string                  `json:"catalog_name"`
				Products []catalogGraphQLProduct `json:"products"`
				Paging   struct {
					After string `json:"after"`
				} `json:"paging"`
			} `json:"product_catalog"`
		} `json:"xfb_whatsapp_catalog"`
	} `json:"data"`
	Error  *catalogGraphQLError  `json:"error"`
	Errors []catalogGraphQLError `json:"errors"`
}

func (response catalogGraphQLResponse) firstError() *catalogGraphQLError {
	if response.Error != nil {
		return response.Error
	}
	if len(response.Errors) > 0 {
		return &response.Errors[0]
	}
	return nil
}

func catalogGraphQLErrorResult(graphError *catalogGraphQLError) error {
	if graphError == nil {
		return nil
	}
	log.Printf("Catalog GraphQL query failed (code=%d, extension_code=%d): %s", graphError.Code, graphError.Extensions.ErrorCode, graphError.Message)
	if graphError.Code == 102 || graphError.Code == 190 || graphError.Extensions.ErrorCode == 102 || graphError.Extensions.ErrorCode == 190 {
		return errCatalogAuthentication
	}
	return fmt.Errorf("catalog service rejected the query")
}

func (c *Client) fetchCatalogAccessToken(ctx context.Context) (string, error) {
	c.catalogTokenMu.Lock()
	defer c.catalogTokenMu.Unlock()
	if c.catalogToken != "" {
		return c.catalogToken, nil
	}

	nonceCh := make(chan string, 1)
	handlerID := c.client.AddEventHandler(func(evt any) {
		if nonceEvent, ok := evt.(*events.BusinessTokenNonce); ok {
			select {
			case nonceCh <- nonceEvent.Nonce:
			default:
			}
		}
	})
	defer c.client.RemoveEventHandler(handlerID)

	response, err := c.client.DangerousInternals().SendIQ(ctx, whatsmeow.DangerousInfoQuery{
		Namespace: "fb:thrift_iq",
		Type:      whatsmeow.DangerousInfoQueryType("get"),
		To:        waTypes.ServerJID,
		SMaxID:    "118",
	})
	if err != nil {
		return "", fmt.Errorf("failed to request business token nonce: %w", err)
	}
	result, ok := response.GetOptionalChildByTag("result")
	if !ok || !strings.EqualFold(nodeAttr(result, "status"), "Success") {
		return "", fmt.Errorf("business token nonce request was not accepted")
	}

	var nonce string
	select {
	case nonce = <-nonceCh:
	case <-ctx.Done():
		return "", fmt.Errorf("waiting for business token nonce: %w", ctx.Err())
	}

	response, err = c.client.DangerousInternals().SendIQ(ctx, whatsmeow.DangerousInfoQuery{
		Namespace: "fb:thrift_iq",
		Type:      whatsmeow.DangerousInfoQueryType("get"),
		To:        waTypes.ServerJID,
		SMaxID:    "104",
		Content: []waBinary.Node{{
			Tag: "parameters",
			Content: []waBinary.Node{{
				Tag:     "code",
				Content: []byte(nonce),
			}},
		}},
	})
	if err != nil {
		return "", fmt.Errorf("failed to request business access token: %w", err)
	}
	var tokenNodes []waBinary.Node
	collectNodes(*response, "access_token", &tokenNodes)
	if len(tokenNodes) == 0 {
		return "", fmt.Errorf("business access token response did not contain a token")
	}
	token := nodeText(tokenNodes[0])
	if token == "" {
		return "", fmt.Errorf("business access token response contained an empty token")
	}
	c.catalogToken = token
	return token, nil
}

func (c *Client) invalidateCatalogAccessToken(token string) {
	c.catalogTokenMu.Lock()
	defer c.catalogTokenMu.Unlock()
	if c.catalogToken == token {
		c.catalogToken = ""
	}
}

func (c *Client) fetchCatalogPage(ctx context.Context, token, catalogJID string, deviceID uint16, after any) (catalogGraphQLResponse, error) {
	variables := map[string]any{
		"request": map[string]any{
			"product_catalog": map[string]any{
				"jid":                              catalogJID,
				"after":                            after,
				"limit":                            catalogPageSize,
				"width":                            "100",
				"height":                           "100",
				"belongs_to":                       map[string]any{},
				"allow_shop_source":                false,
				"direct_connection_encrypted_info": nil,
				"variant_thumbnail_height":         nil,
				"variant_thumbnail_width":          nil,
			},
			"platform": "WEB",
		},
	}
	body, err := json.Marshal(map[string]any{
		"access_token": token,
		"doc_id":       catalogFacebookQueryID,
		"variables":    variables,
		"locale":       "en_US",
	})
	if err != nil {
		return catalogGraphQLResponse{}, fmt.Errorf("failed to encode catalog query: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, catalogFacebookURL, bytes.NewReader(body))
	if err != nil {
		return catalogGraphQLResponse{}, fmt.Errorf("failed to create catalog query: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if deviceID > 0 {
		req.Header.Set("X-WA-Device-ID", strconv.Itoa(int(deviceID)))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return catalogGraphQLResponse{}, fmt.Errorf("catalog query failed: %w", err)
	}
	defer resp.Body.Close()
	var response catalogGraphQLResponse
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 10<<20)).Decode(&response)
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return catalogGraphQLResponse{}, fmt.Errorf("%w: HTTP %d", errCatalogAuthentication, resp.StatusCode)
		}
		if decodeErr == nil {
			if graphErr := catalogGraphQLErrorResult(response.firstError()); graphErr != nil {
				return catalogGraphQLResponse{}, fmt.Errorf("%w: HTTP %d", graphErr, resp.StatusCode)
			}
		}
		return catalogGraphQLResponse{}, fmt.Errorf("catalog query returned HTTP %d", resp.StatusCode)
	}
	if decodeErr != nil {
		return catalogGraphQLResponse{}, fmt.Errorf("failed to decode catalog query: %w", decodeErr)
	}
	if graphErr := catalogGraphQLErrorResult(response.firstError()); graphErr != nil {
		return catalogGraphQLResponse{}, graphErr
	}
	if response.Data.Catalog.ProductCatalog == nil {
		return catalogGraphQLResponse{}, fmt.Errorf("catalog query returned no product catalog")
	}
	return response, nil
}

// SyncCatalog queries the linked business account's product catalog through
// the authenticated Facebook GraphQL path used for a user's own catalog by
// current WhatsApp Web clients.
func (c *Client) SyncCatalog(ctx context.Context, catalogID string) (types.Catalog, error) {
	owner, lid, deviceID := c.catalogIdentity()
	if owner.IsEmpty() {
		return types.Catalog{}, fmt.Errorf("client is not logged in")
	}
	if catalogID == "" {
		catalogID = owner.String()
	}
	catalog := types.Catalog{ID: catalogID, Name: "WhatsApp Catalog", Products: []types.Product{}}
	token, err := c.fetchCatalogAccessToken(ctx)
	if err != nil {
		return types.Catalog{}, fmt.Errorf("failed to authenticate business catalog query: %w", err)
	}

	// WhatsApp Web chooses LID or phone-number addressing using a server-side
	// feature flag that workers cannot read. Prefer LID, then retry the first
	// page with the phone-number JID before treating the query as failed.
	catalogJIDs := make([]string, 0, 2)
	if !lid.IsEmpty() {
		catalogJIDs = append(catalogJIDs, lid.String())
	}
	if owner.String() != lid.String() {
		catalogJIDs = append(catalogJIDs, owner.String())
	}
	var response catalogGraphQLResponse
	var queryErr error
	var catalogJID string
	for _, candidate := range catalogJIDs {
		response, queryErr = c.fetchCatalogPage(ctx, token, candidate, deviceID, nil)
		if queryErr == nil {
			catalogJID = candidate
			break
		}
	}
	if queryErr != nil {
		if errors.Is(queryErr, errCatalogAuthentication) {
			c.invalidateCatalogAccessToken(token)
		}
		return types.Catalog{}, fmt.Errorf("failed to query business catalog: %w", queryErr)
	}

	seenCursors := make(map[string]struct{})
	for pageNumber := 0; pageNumber < catalogMaxPages; pageNumber++ {
		if pageNumber > 0 {
			response, queryErr = c.fetchCatalogPage(ctx, token, catalogJID, deviceID, response.Data.Catalog.ProductCatalog.Paging.After)
			if queryErr != nil {
				if errors.Is(queryErr, errCatalogAuthentication) {
					c.invalidateCatalogAccessToken(token)
				}
				return types.Catalog{}, fmt.Errorf("failed to query business catalog: %w", queryErr)
			}
		}
		page := response.Data.Catalog.ProductCatalog
		if page.ID != "" {
			catalog.ID = page.ID
		}
		if page.Name != "" {
			catalog.Name = page.Name
		}
		for _, item := range page.Products {
			if bool(item.IsHidden) || bool(item.IsSanctioned) {
				continue
			}
			price, _ := strconv.ParseInt(strings.TrimSpace(item.Price), 10, 64)
			product := types.Product{
				ID:           item.ID,
				RetailerID:   item.RetailerID,
				Name:         item.Name,
				Description:  item.Description,
				Price:        price,
				Currency:     item.Currency,
				Availability: item.Availability,
				URL:          item.URL,
			}
			for _, image := range item.Media.Images {
				imageURL := image.OriginalURL
				if imageURL == "" {
					imageURL = image.RequestURL
				}
				if imageURL != "" {
					product.ImageURLs = append(product.ImageURLs, imageURL)
				}
			}
			if product.ID != "" {
				catalog.Products = append(catalog.Products, product)
			}
		}
		after := page.Paging.After
		if after == "" {
			for _, product := range catalog.Products {
				if product.Currency != "" {
					catalog.Currency = product.Currency
					break
				}
			}
			return catalog, nil
		}
		if _, seen := seenCursors[after]; seen {
			return types.Catalog{}, fmt.Errorf("catalog pagination repeated cursor")
		}
		seenCursors[after] = struct{}{}
	}
	return types.Catalog{}, fmt.Errorf("catalog pagination exceeded %d pages", catalogMaxPages)
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

// CommandLedger exposes the connection-scoped durable command result store.
func (c *Client) CommandLedger() *store.PGContainer {
	return c.container
}

// EventOutbox exposes the connection-scoped durable worker event queue.
func (c *Client) EventOutbox() *store.PGContainer {
	return c.container
}

// DownloadMedia downloads media from a message.
func (c *Client) DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error) {
	return c.client.Download(ctx, msg)
}

// DownloadMediaWithPath downloads media using its direct path and keys.
func (c *Client) DownloadMediaWithPath(ctx context.Context, directPath string, encFileHash, fileHash, mediaKey []byte, fileLength int, mediaType whatsmeow.MediaType, mmsType string) ([]byte, error) {
	// fileLength is retained in this wrapper for compatibility with callers;
	// current whatsmeow validates downloads using hashes rather than this value.
	_ = fileLength
	return c.client.DownloadMediaWithPath(ctx, directPath, encFileHash, fileHash, mediaKey, mediaType, mmsType, true)
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

// blocklistTargetJID turns a stored contact JID into the argument
// whatsmeow.Client.UpdateBlocklist expects.
//
// WhatsApp's blocklist namespace is addressed by link-ID, not by phone number.
// Upstream whatsmeow does that translation itself as of 8d023aa ("user: switch
// UpdateBlocklist to use LIDs", 2026-08-14), which this service now builds
// against: a phone-number argument is resolved through Store.LIDs with a
// GetUserInfo fallback and sent as `jid=<lid>`, with `pn_jid=<pn>` added for
// block. Nothing here may second-guess that - the stanza is built by private
// code, and the earlier attempt to reproduce it from outside is what this
// replaces.
//
// What is still this layer's job is handing upstream an argument it can act on:
//
//   - Non-AD. A blocklist entry names a person, not one of their devices, and
//     Store.LIDs preserves the device number of whatever it is asked about, so a
//     device-qualified argument produces a device-qualified `jid`.
//   - One of the exactly two servers UpdateBlocklist branches on. It resolves
//     types.DefaultUserServer and types.HiddenUserServer and has no else: every
//     other address - a group, a broadcast, a newsletter, and notably
//     types.HostedLIDServer - leaves its `lidJID` at the zero value and is sent
//     as `jid=""`, which the server answers with the same opaque
//     `400 bad-request` this change is fixing.
//
// hosted.lid is the trap there, because it is a link-ID address and reads like
// one this function should pass through. Upstream does not accept it, so
// neither may this: the mapping to something upstream would accept is not ours
// to invent. The API already refuses the rest, but a command queued before that
// check must not reach the wire to find out.
func blocklistTargetJID(jidStr string) (waTypes.JID, error) {
	parsed, err := waTypes.ParseJID(jidStr)
	if err != nil {
		return waTypes.EmptyJID, fmt.Errorf("failed to parse JID %s: %w", jidStr, err)
	}

	target := parsed.ToNonAD()
	if target.User == "" {
		return waTypes.EmptyJID, fmt.Errorf("JID %q has no user part", jidStr)
	}
	if target.Server != waTypes.DefaultUserServer && target.Server != waTypes.HiddenUserServer {
		return waTypes.EmptyJID, fmt.Errorf(
			"JID %q is not an individual contact: %s addresses cannot be blocked", jidStr, target.Server)
	}
	return target, nil
}

// blocklistNeedsLIDStore reports whether UpdateBlocklist will have to consult
// Store.LIDs for this target and action: GetLIDForPN for every phone number, and
// GetPNForLID for a block of a LID, which needs the reverse mapping for the
// `pn_jid` attribute. Only unblocking a LID needs no lookup. Upstream
// dereferences the store unguarded, so a connection wired without one would
// panic inside the NATS command goroutine rather than fail the command.
func blocklistNeedsLIDStore(target waTypes.JID, action events.BlocklistChangeAction) bool {
	return target.Server == waTypes.DefaultUserServer || action == events.BlocklistChangeActionBlock
}

// updateBlocklistWithRetry is the internal helper that handles blocklist updates with retry logic.
func (c *Client) updateBlocklistWithRetry(ctx context.Context, jidStr string, action string) error {
	if c.client == nil {
		return fmt.Errorf("client not initialized")
	}

	var blocklistAction events.BlocklistChangeAction
	switch action {
	case "block":
		blocklistAction = events.BlocklistChangeActionBlock
	case "unblock":
		blocklistAction = events.BlocklistChangeActionUnblock
	default:
		return fmt.Errorf("unknown blocklist action: %s", action)
	}

	target, err := blocklistTargetJID(jidStr)
	if err != nil {
		return err
	}
	if blocklistNeedsLIDStore(target, blocklistAction) &&
		(c.client.Store == nil || c.client.Store.LIDs == nil) {
		return fmt.Errorf("no LID store available to %s %s", action, target)
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
		_, err := c.client.UpdateBlocklist(attemptCtx, target, blocklistAction)
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
