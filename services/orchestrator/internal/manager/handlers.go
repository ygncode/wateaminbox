package manager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	natsclient "github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

// Handlers handles NATS command messages for worker management.
type Handlers struct {
	manager *Manager
	nats    *natsclient.Client
	sub     *nats.Subscription
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(mgr *Manager, nc *natsclient.Client) *Handlers {
	return &Handlers{
		manager: mgr,
		nats:    nc,
	}
}

// StartSubscription starts listening for commands on the WHATSAPP_COMMANDS stream.
func (h *Handlers) StartSubscription(ctx context.Context) error {
	log.Println("Starting NATS command subscription...")

	sub, err := h.nats.SubscribeToCommands(nil)
	if err != nil {
		return err
	}
	h.sub = sub

	// Start the command processing loop
	go h.processCommands(ctx)

	log.Println("NATS command subscription started")
	return nil
}

// StopSubscription stops the command subscription.
func (h *Handlers) StopSubscription() error {
	if h.sub != nil {
		return h.sub.Drain()
	}
	return nil
}

// processCommands continuously processes commands from the stream.
func (h *Handlers) processCommands(ctx context.Context) {
	log.Println("Command processing loop started, waiting for messages on WHATSAPP.commands...")

	for {
		select {
		case <-ctx.Done():
			log.Println("Stopping command processing")
			return
		default:
			// Fetch messages with timeout
			msgs, err := h.sub.Fetch(10, nats.MaxWait(5*time.Second))
			if err != nil {
				if err == nats.ErrTimeout {
					continue
				}
				// During shutdown, subscription is drained which causes connection closed errors
				// These are expected and should exit gracefully
				if err == nats.ErrConnectionClosed || err == nats.ErrBadSubscription ||
					strings.Contains(err.Error(), "connection closed") ||
					strings.Contains(err.Error(), "bad subscription") {
					log.Println("Subscription closed, stopping command processing")
					return
				}
				log.Printf("Error fetching messages: %v", err)
				continue
			}

			if len(msgs) > 0 {
				log.Printf("Fetched %d message(s) from NATS commands stream", len(msgs))
			}

			for _, msg := range msgs {
				h.handleMessage(ctx, msg)
			}
		}
	}
}

// handleMessage routes a message to the appropriate handler.
func (h *Handlers) handleMessage(ctx context.Context, msg *nats.Msg) {
	// Parse the command type from the message
	var envelope struct {
		Type string `json:"type"`
	}

	if err := json.Unmarshal(msg.Data, &envelope); err != nil {
		log.Printf("Failed to parse command envelope: %v", err)
		msg.Nak()
		return
	}

	var handlerErr error

	switch envelope.Type {
	case types.CommandSpawn:
		handlerErr = h.handleSpawnCommand(ctx, msg.Data)
	case types.CommandKill:
		handlerErr = h.handleKillCommand(ctx, msg.Data)
	case types.CommandStatus:
		handlerErr = h.handleStatusCommand(ctx, msg.Data)
	default:
		// Unknown command types (e.g., "text", "image", "reaction") are handled by
		// WhatsApp worker consumers, not the orchestrator. ACK to prevent redelivery
		// to this consumer while allowing the worker consumer to process them.
		msg.Ack()
		return
	}

	if handlerErr != nil {
		log.Printf("Error handling command %s: %v", envelope.Type, handlerErr)
		msg.Nak()
		return
	}

	// Acknowledge successful processing
	if err := msg.Ack(); err != nil {
		log.Printf("Failed to ack message: %v", err)
	}
}

// handleSpawnCommand handles a spawn worker command.
func (h *Handlers) handleSpawnCommand(ctx context.Context, data []byte) error {
	var cmd types.SpawnWorkerCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return err
	}

	log.Printf("Received spawn command for company %s, connection %s", cmd.CompanyID, cmd.ConnectionID)

	// A reconnect is an explicit request for a fresh pairing attempt. Replace a
	// worker that is still starting/erroring rather than reporting it as active:
	// an unpaired worker cannot generate a new QR from a duplicate spawn alone.
	if worker, exists := h.manager.GetWorkerStatus(cmd.ConnectionID); exists && worker.Status != types.StatusConnected && worker.PID > 0 {
		if err := h.manager.StopWorker(ctx, cmd.CompanyID, cmd.ConnectionID, "restart requested for pairing"); err != nil {
			log.Printf("Warning: failed to stop stale worker %s: %v", cmd.ConnectionID, err)
		}
	}

	databaseURL := h.manager.config.WorkerDatabaseURL
	if h.manager.registry == nil && databaseURL == "" {
		databaseURL = cmd.DatabaseURL // Persistence-free local compatibility only.
		if databaseURL == "" {
			databaseURL = h.manager.config.DatabaseURL
		}
	}
	if databaseURL == "" {
		return fmt.Errorf("orchestrator WORKER_DATABASE_URL is required to spawn workers")
	}

	// Spawn the worker with the restricted URL from manager configuration. A
	// command payload can never select or smuggle database credentials.
	err := h.manager.SpawnWorker(ctx, cmd.CompanyID, cmd.ConnectionID, cmd.TenantSchema, databaseURL)
	if err != nil {
		log.Printf("Failed to spawn worker for company %s, connection %s: %v", cmd.CompanyID, cmd.ConnectionID, err)

		// Publish error response
		h.publishStatusResponse(cmd.CompanyID, cmd.ConnectionID, types.StatusError, err.Error())
		return err
	}

	return nil
}

// handleKillCommand handles a kill worker command.
func (h *Handlers) handleKillCommand(ctx context.Context, data []byte) error {
	var cmd types.KillWorkerCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return err
	}

	log.Printf("Received kill command for company %s, connection %s: %s", cmd.CompanyID, cmd.ConnectionID, cmd.Reason)

	// Unlink performs a WhatsApp logout and credential purge before the worker
	// exits. A normal kill preserves credentials for reconnect.
	var err error
	if cmd.Unlink {
		databaseURL := h.manager.config.WorkerDatabaseURL
		if h.manager.registry == nil && databaseURL == "" {
			databaseURL = h.manager.config.DatabaseURL
		}
		err = h.manager.UnlinkWorker(
			ctx,
			cmd.CompanyID,
			cmd.ConnectionID,
			cmd.TenantSchema,
			databaseURL,
			cmd.Reason,
		)
	} else {
		err = h.manager.StopWorker(ctx, cmd.CompanyID, cmd.ConnectionID, cmd.Reason)
	}
	if err != nil {
		log.Printf("Failed to stop worker for company %s, connection %s: %v", cmd.CompanyID, cmd.ConnectionID, err)
		if errors.Is(err, ErrWorkerNotFound) {
			// Idempotent kill: the desired end state already holds.
			return nil
		}
		// Persistence and process-control failures must be redelivered. ACKing
		// here can lose stop/unlink intent before it becomes durable.
		return err
	}

	return nil
}

// handleStatusCommand handles a worker status request.
func (h *Handlers) handleStatusCommand(ctx context.Context, data []byte) error {
	var cmd types.WorkerStatusCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return err
	}

	log.Printf("Received status command for company %s, connection %s", cmd.CompanyID, cmd.ConnectionID)

	worker, exists := h.manager.GetWorkerStatus(cmd.ConnectionID)
	if !exists {
		h.publishStatusResponse(cmd.CompanyID, cmd.ConnectionID, types.StatusStopped, "worker not found")
		return nil
	}

	// Publish status response
	response := types.WorkerStatusResponse{
		CompanyID:    worker.CompanyID,
		ConnectionID: worker.ConnectionID,
		Status:       worker.Status,
		ConnectedAt:  worker.StartedAt,
		LastActivity: worker.LastActivity,
		PID:          worker.PID,
	}

	responseData, err := json.Marshal(response)
	if err != nil {
		return err
	}

	return h.nats.PublishEvent(types.SubjectEvents, responseData)
}

// publishStatusResponse publishes a worker status response event.
func (h *Handlers) publishStatusResponse(companyID, connectionID, status, errorMsg string) {
	response := types.WorkerStatusResponse{
		CompanyID:    companyID,
		ConnectionID: connectionID,
		Status:       status,
		Error:        errorMsg,
	}

	data, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal status response: %v", err)
		return
	}

	if err := h.nats.PublishEvent(types.SubjectEvents, data); err != nil {
		log.Printf("Failed to publish status response: %v", err)
	}
}

// PublishConnectionStatus publishes a connection status event using WhatsAppEvent format.
// This format matches what the whatsapp worker uses and what the API expects.
func (h *Handlers) PublishConnectionStatus(companyID, connectionID, status, reason string) {
	// Use WhatsAppEvent format (same as whatsapp worker) for API compatibility
	event := sharednats.WhatsAppEvent{
		Type:         sharednats.EventTypeConnectionStatus, // "connection_status"
		CompanyID:    companyID,
		ConnectionID: connectionID,
		Payload: sharednats.ConnectionStatusPayload{
			Status: status,
			Reason: reason,
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("Failed to marshal connection status event: %v", err)
		return
	}

	// Use correct subject format: WHATSAPP.events.{companyId}.{connectionId}.connection_status
	// This matches the API's subscription pattern: WHATSAPP.events.>
	subject := fmt.Sprintf(sharednats.SubjectConnectionStatus, companyID, connectionID)
	if err := h.nats.PublishEvent(subject, data); err != nil {
		log.Printf("Failed to publish connection status event to %s: %v", subject, err)
	} else {
		log.Printf("Published connection status event: company=%s connection=%s status=%s", companyID, connectionID, status)
	}
}

// PublishQRCodeEvent publishes a QR code event.
func (h *Handlers) PublishQRCodeEvent(companyID, connectionID, qrData string) {
	event := types.QRCodeEvent{
		CompanyID:    companyID,
		ConnectionID: connectionID,
		QRData:       qrData,
		Timestamp:    time.Now(),
	}

	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("Failed to marshal QR code event: %v", err)
		return
	}

	if err := h.nats.PublishEvent(types.SubjectEvents, data); err != nil {
		log.Printf("Failed to publish QR code event: %v", err)
	}
}

// PublishMessageEvent publishes a WhatsApp message event.
func (h *Handlers) PublishMessageEvent(event types.MessageEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("Failed to marshal message event: %v", err)
		return
	}

	if err := h.nats.PublishEvent(types.SubjectEvents, data); err != nil {
		log.Printf("Failed to publish message event: %v", err)
	}
}
