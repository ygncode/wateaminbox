package manager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
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
	nodeSub *nats.Subscription

	// forwardCommand republishes a command onto another node's subject. It is a
	// field rather than a direct client call so ownership routing can be
	// exercised without a NATS connection.
	forwardCommand func(nodeID, companyID, connectionID string, data []byte, hops int) error

	// publishEvent publishes to the events stream. It is a field rather than a
	// direct client call so registry-answered status can be exercised without a
	// NATS connection.
	publishEvent func(subject string, data []byte) error
}

// maxForwardHops bounds ownership forwarding between orchestrator nodes. A
// command normally forwards at most once; repeated hops mean ownership is
// moving under the command, and redelivery should retry from the registry
// rather than bouncing the message forever.
const maxForwardHops = 3

// NewHandlers creates a new Handlers instance.
func NewHandlers(mgr *Manager, nc *natsclient.Client) *Handlers {
	h := &Handlers{
		manager: mgr,
		nats:    nc,
	}
	if nc != nil {
		h.forwardCommand = nc.ForwardCommandToNode
		h.publishEvent = nc.PublishEvent
	}
	return h
}

// StartSubscription starts listening for commands on the WHATSAPP_COMMANDS
// stream: the shared placement consumer that any orchestrator instance may
// serve, and — when a node identity is configured — this node's own consumer
// for commands whose connections it owns.
func (h *Handlers) StartSubscription(ctx context.Context) error {
	log.Println("Starting NATS command subscription...")

	if h.manager.config.ConnectionScope == nil {
		sub, err := h.nats.SubscribeToCommands(nil)
		if err != nil {
			return err
		}
		h.sub = sub
		go h.processCommands(ctx, sub, "WHATSAPP.commands", true)
	}

	if nodeID := h.manager.config.NodeID; nodeID != "" {
		nodeSub, err := h.nats.SubscribeToNodeCommands(nodeID)
		if err != nil {
			return err
		}
		h.nodeSub = nodeSub
		go h.processCommands(ctx, nodeSub, natsclient.NodeCommandSubjectPrefix+nodeID, false)
	}

	log.Println("NATS command subscription started")
	return nil
}

// StopSubscription stops the command subscriptions.
func (h *Handlers) StopSubscription() error {
	var err error
	if h.sub != nil {
		err = h.sub.Drain()
	}
	if h.nodeSub != nil {
		if nodeErr := h.nodeSub.Drain(); err == nil {
			err = nodeErr
		}
	}
	return err
}

// processCommands continuously processes commands from one subscription.
// sharedConsumer marks the placement consumer, whose filter overlaps the
// node-addressed subjects that only the node consumers may execute.
func (h *Handlers) processCommands(ctx context.Context, sub *nats.Subscription, label string, sharedConsumer bool) {
	log.Printf("Command processing loop started, waiting for messages on %s...", label)

	for {
		select {
		case <-ctx.Done():
			log.Println("Stopping command processing")
			return
		default:
			// Fetch messages with timeout
			msgs, err := sub.Fetch(10, nats.MaxWait(5*time.Second))
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
				log.Printf("Fetched %d message(s) from NATS commands stream (%s)", len(msgs), label)
			}

			for _, msg := range msgs {
				h.handleMessage(ctx, msg, sharedConsumer)
			}
		}
	}
}

// forwardHops reads how many times a command has already been forwarded
// between nodes. Absent or malformed headers count as zero.
func forwardHops(msg *nats.Msg) int {
	raw := msg.Header.Get(natsclient.ForwardHopsHeader)
	if raw == "" {
		return 0
	}
	hops, err := strconv.Atoi(raw)
	if err != nil || hops < 0 {
		return 0
	}
	return hops
}

// sharedConsumerSkips reports whether the shared placement consumer must
// ack-and-skip a subject. Every node-addressed subject qualifies — including
// this node's own: the node consumer receives an independent copy of the same
// message, so executing it here as well would run each forwarded command
// twice (a forwarded spawn's second run would stop the just-spawned worker as
// a "restart requested for pairing").
func (h *Handlers) sharedConsumerSkips(subject string) bool {
	return h.manager.config.NodeID != "" && natsclient.IsNodeCommandSubject(subject)
}

// handleMessage routes a message to the appropriate handler.
func (h *Handlers) handleMessage(ctx context.Context, msg *nats.Msg, sharedConsumer bool) {
	// The shared consumer's filter also matches node-addressed subjects. Those
	// are executed exclusively by the owning node's consumer, which receives
	// them independently; here they are acknowledged without action.
	if sharedConsumer && h.sharedConsumerSkips(msg.Subject) {
		msg.Ack()
		return
	}

	// Parse the command type from the message
	var envelope struct {
		Type string `json:"type"`
	}

	if err := json.Unmarshal(msg.Data, &envelope); err != nil {
		log.Printf("Failed to parse command envelope: %v", err)
		msg.Nak()
		return
	}

	hops := forwardHops(msg)

	var handlerErr error

	switch envelope.Type {
	case types.CommandSpawn:
		handlerErr = h.handleSpawnCommand(ctx, msg.Data, hops)
	case types.CommandKill:
		handlerErr = h.handleKillCommand(ctx, msg.Data, hops)
	case types.CommandStatus:
		handlerErr = h.handleStatusCommand(ctx, msg.Data, hops)
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

// resolveOwnership reads the durable record deciding which node must execute a
// command. It returns the record (nil when no durable row exists) and whether
// a different node owns the connection. Without a registry every command is
// local: a persistence-free orchestrator is single-instance by definition.
func (h *Handlers) resolveOwnership(ctx context.Context, companyID, connectionID string) (*WorkerRecord, bool, error) {
	if !h.manager.connectionInScope(companyID, connectionID) {
		return nil, false, ErrConnectionOutsideScope
	}
	if h.manager.registry == nil || h.manager.config.NodeID == "" {
		return nil, false, nil
	}
	record, err := h.manager.registry.GetWorker(ctx, connectionID)
	if err != nil {
		return nil, false, fmt.Errorf("resolve owner for connection %s: %w", connectionID, err)
	}
	if record == nil {
		return nil, false, nil
	}
	if record.CompanyID != companyID {
		return nil, false, fmt.Errorf("worker %s belongs to another company", connectionID)
	}
	ownedElsewhere := record.NodeID != "" && record.NodeID != h.manager.config.NodeID
	return record, ownedElsewhere, nil
}

// forwardToNode republishes a command onto another node's subject. The
// returned error (past the hop bound) surfaces as a NAK, so redelivery
// re-resolves routing from the registry instead of looping between nodes.
func (h *Handlers) forwardToNode(nodeID, companyID, connectionID string, data []byte, hops int) error {
	if hops >= maxForwardHops {
		return fmt.Errorf("command for connection %s exceeded %d forwarding hops", connectionID, maxForwardHops)
	}
	if h.forwardCommand == nil {
		return fmt.Errorf("cannot forward command for connection %s: no NATS forwarding configured", connectionID)
	}
	if err := h.forwardCommand(nodeID, companyID, connectionID, data, hops+1); err != nil {
		return err
	}
	log.Printf("Forwarded command for connection %s to node %s", connectionID, nodeID)
	return nil
}

// forwardToOwner routes a command to the node the registry names as owner.
func (h *Handlers) forwardToOwner(record *WorkerRecord, data []byte, hops int) error {
	return h.forwardToNode(record.NodeID, record.CompanyID, record.ConnectionID, data, hops)
}

// handleSpawnCommand handles a spawn worker command.
func (h *Handlers) handleSpawnCommand(ctx context.Context, data []byte, hops int) error {
	var cmd types.SpawnWorkerCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return err
	}

	log.Printf("Received spawn command for company %s, connection %s", cmd.CompanyID, cmd.ConnectionID)
	if !h.manager.connectionInScope(cmd.CompanyID, cmd.ConnectionID) {
		return ErrConnectionOutsideScope
	}

	// A connection owned by another node must be (re)spawned there: its session
	// affinity, durable launch generation, and any live process are that node's.
	// A connection with no durable row is claimed under this node by the
	// registry CAS inside SpawnWorker.
	record, ownedElsewhere, err := h.resolveOwnership(ctx, cmd.CompanyID, cmd.ConnectionID)
	if err != nil {
		return err
	}
	if ownedElsewhere {
		return h.forwardToOwner(record, data, hops)
	}

	// Placement: a brand-new connection lands on the node that pulled it from
	// the shared consumer, unless that node is at local capacity and a live
	// peer has free slots. Existing connections are never moved here — node
	// affinity is the default because a worker's outbound IP is part of its
	// WhatsApp identity.
	if record == nil && h.manager.registry != nil && h.manager.config.NodeID != "" &&
		h.manager.config.MaxWorkers > 0 && h.manager.WorkerCount() >= h.manager.config.MaxWorkers {
		target, found, placementErr := h.manager.registry.SelectSpawnNode(ctx)
		if placementErr != nil {
			return placementErr
		}
		if found {
			log.Printf("Node at local capacity; placing new connection %s on node %s", cmd.ConnectionID, target)
			return h.forwardToNode(target, cmd.CompanyID, cmd.ConnectionID, data, hops)
		}
		// No peer has capacity either: fall through so the local spawn fails
		// with the ordinary worker-limit error and reports it to the API.
	}

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
	err = h.manager.SpawnWorker(ctx, cmd.CompanyID, cmd.ConnectionID, cmd.TenantSchema, databaseURL)
	if err != nil {
		log.Printf("Failed to spawn worker for company %s, connection %s: %v", cmd.CompanyID, cmd.ConnectionID, err)

		// Publish error response
		h.publishStatusResponse(cmd.CompanyID, cmd.ConnectionID, types.StatusError, err.Error())
		return err
	}

	return nil
}

// handleKillCommand handles a kill worker command.
func (h *Handlers) handleKillCommand(ctx context.Context, data []byte, hops int) error {
	var cmd types.KillWorkerCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return err
	}

	log.Printf("Received kill command for company %s, connection %s: %s", cmd.CompanyID, cmd.ConnectionID, cmd.Reason)

	// "Not mine" and "no such connection" are different answers. A kill for a
	// connection owned by another node must reach that node rather than being
	// acknowledged as already satisfied here — acking it would silently discard
	// stop intent for a live worker on another host. A registry read failure
	// surfaces as an error so redelivery retries; only an authoritative "no
	// durable row anywhere" may fall through to the idempotent local path.
	record, ownedElsewhere, err := h.resolveOwnership(ctx, cmd.CompanyID, cmd.ConnectionID)
	if err != nil {
		return err
	}
	if ownedElsewhere {
		return h.forwardToOwner(record, data, hops)
	}

	// Unlink performs a WhatsApp logout and credential purge before the worker
	// exits. A normal kill preserves credentials for reconnect.
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
func (h *Handlers) handleStatusCommand(ctx context.Context, data []byte, hops int) error {
	var cmd types.WorkerStatusCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return err
	}
	_ = hops // status is answered from the registry, never forwarded

	log.Printf("Received status command for company %s, connection %s", cmd.CompanyID, cmd.ConnectionID)

	// A remotely-owned connection is answered from the registry: the owning
	// node writes status and heartbeats there, and a registry answer stays
	// available even while that node is down.
	record, ownedElsewhere, err := h.resolveOwnership(ctx, cmd.CompanyID, cmd.ConnectionID)
	if err != nil {
		return err
	}
	if ownedElsewhere {
		status := record.Status
		if status == WorkerStatusRecovering {
			// Registry-only lifecycle state; the API vocabulary has no
			// "recovering", and the owner is about to bring the worker back.
			status = types.StatusConnecting
		}
		response := types.WorkerStatusResponse{
			CompanyID:    record.CompanyID,
			ConnectionID: record.ConnectionID,
			Status:       status,
			ConnectedAt:  record.StartedAt,
			LastActivity: record.LastHeartbeat,
			PID:          record.PID,
		}
		responseData, err := json.Marshal(response)
		if err != nil {
			return err
		}
		if h.publishEvent == nil {
			return errors.New("cannot publish registry-answered status: no NATS client configured")
		}
		return h.publishEvent(types.SubjectEvents, responseData)
	}

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
