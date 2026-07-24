// Package handler implements WhatsApp event processing with robust media download handling.
//
// Media Download Retry Mechanism:
//
// All media downloads (images, videos, audio, documents, stickers) use exponential backoff
// retry logic to handle transient network failures. The retry configuration is controlled
// by package-level constants:
//
//   - mediaDownloadMaxRetries (4): Maximum number of total download attempts (initial + retries)
//   - mediaDownloadBaseDelay (1s): Initial backoff, doubling each retry (1s, 2s, 4s)
//   - mediaDownloadAttemptTimeout (30s): Per-attempt timeout to prevent indefinite blocking
//
// Retry Behavior:
//  1. First attempt starts immediately with a 30s timeout
//  2. On failure, waits 1s before second attempt (30s timeout)
//  3. On failure, waits 2s before third attempt (30s timeout)
//  4. On failure, waits 4s before fourth attempt (30s timeout)
//  5. If all attempts fail, returns the last error
//
// Maximum additional delay: ~7 seconds (1s + 2s + 4s backoff)
//
// Context cancellation is checked before each attempt and during backoff delays,
// allowing graceful shutdown when the service is stopping.
//
// Functions using retry logic:
//   - handleMediaMessage: Real-time message media (timeout: 135s)
//   - downloadHistoryMedia: History sync media (timeout: 75s)
package handler

import (
	"context"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"golang.org/x/sync/singleflight"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/storage"
)

// Number of parallel workers for history sync processing
const historySyncWorkers = 10

// Media download retry configuration constants.
const (
	// mediaDownloadMaxRetries is the maximum number of total attempts (initial + retries)
	// for media downloads. 4 attempts allow for 3 backoff intervals (1s, 2s, 4s).
	mediaDownloadMaxRetries = 4

	// mediaDownloadBaseDelay is the initial delay between retry attempts.
	// Subsequent delays follow exponential backoff: 1s, 2s, 4s.
	mediaDownloadBaseDelay = 1 * time.Second

	// mediaDownloadAttemptTimeout is the timeout for each individual download attempt.
	mediaDownloadAttemptTimeout = 30 * time.Second
)

// WhatsAppClient defines the interface for the WhatsApp client.
// This allows for mocking the client in tests.
type WhatsAppClient interface {
	DownloadMedia(ctx context.Context, msg whatsmeow.DownloadableMessage) ([]byte, error)
	GetClient() *whatsmeow.Client
	HandleReconnect(ctx context.Context)
	SendPresence(ctx context.Context, state types.Presence) error
	SubscribePresence(ctx context.Context, jid types.JID) error
	BlockContact(ctx context.Context, jid string) error
	UnblockContact(ctx context.Context, jid string) error
}

// Config holds handler configuration.
type Config struct {
	WorkerID     string
	CompanyID    string
	ConnectionID string
	NATSUrl      string
	Client       WhatsAppClient
	Publisher    *natsClient.Publisher
	Storage      *storage.Client
	Ctx          context.Context
}

// Handler processes WhatsApp events.
type Handler struct {
	config                 Config
	publisher              *natsClient.Publisher
	profilePictureCache    sync.Map
	profilePictureRequests singleflight.Group
}

// New creates a new message handler.
func New(cfg Config) *Handler {
	return &Handler{
		config:    cfg,
		publisher: cfg.Publisher,
	}
}

// HandleEvent processes incoming WhatsApp events.
func (h *Handler) HandleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		h.handleMessage(v)
	case *events.Receipt:
		h.handleReceipt(v)
	case *events.Presence:
		h.handlePresence(v)
	case *events.ChatPresence:
		h.handleChatPresence(v)
	case *events.Connected:
		h.handleConnected(v)
	case *events.Disconnected:
		h.handleDisconnected(v)
	case *events.LoggedOut:
		h.handleLoggedOut(v)
	case *events.QR:
		h.handleQR(v)
	case *events.PairSuccess:
		h.handlePairSuccess(v)
	case *events.HistorySync:
		h.handleHistorySync(v)
	case *events.Contact:
		h.handleContactName(v)
	case *events.PushName:
		h.handlePushName(v)
	case *events.BusinessName:
		h.handleBusinessName(v)
	case *events.AppStateSyncComplete:
		if v.Name == appstate.WAPatchCriticalUnblockLow {
			go h.syncKnownContactNames()
		}
	case *events.StreamReplaced:
		h.handleStreamReplaced(v)
	case *events.Picture:
		h.handlePicture(v)
	case *events.OfflineSyncPreview:
		h.handleOfflineSyncPreview(v)
	case *events.OfflineSyncCompleted:
		h.handleOfflineSyncCompleted(v)
	default:
		// Ignore other events silently
	}
}
