// Package types provides type aliases for the shared NATS event types.
// These are re-exported from the shared module for backwards compatibility.
package types

import (
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

// Command subjects - re-exported from shared module
const (
	SubjectCommands = sharednats.SubjectCommands
	SubjectEvents   = "WHATSAPP.events"

	// Command types
	CommandSpawn  = sharednats.CommandSpawn
	CommandKill   = sharednats.CommandKill
	CommandStatus = sharednats.CommandStatus

	// Event types
	EventQRCode           = "qr_code"
	EventConnectionStatus = "connection_status"
	EventMessage          = "message"
)

// Type aliases for shared types (for backwards compatibility)
type (
	SpawnWorkerCommand    = sharednats.SpawnWorkerCommand
	KillWorkerCommand     = sharednats.KillWorkerCommand
	WorkerStatusCommand   = sharednats.WorkerStatusCommand
	WorkerStatusResponse  = sharednats.WorkerStatusResponse
	QRCodeEvent           = sharednats.QRCodeEvent
	ConnectionStatusEvent = sharednats.ConnectionStatusEvent
	MessageEvent          = sharednats.MessageEvent
	CommandEnvelope       = sharednats.CommandEnvelope
)

// WorkerStatus constants - re-exported from shared module
const (
	StatusStarting     = sharednats.StatusStarting
	StatusConnecting   = sharednats.StatusConnecting
	StatusConnected    = sharednats.StatusConnected
	StatusDisconnected = sharednats.StatusDisconnected
	StatusStopping     = sharednats.StatusStopping
	StatusStopped      = sharednats.StatusStopped
	StatusError        = sharednats.StatusError
)
