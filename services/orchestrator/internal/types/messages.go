package types

import "time"

// Command subjects
const (
	SubjectCommands = "WHATSAPP.commands"
	SubjectEvents   = "WHATSAPP.events"

	// Command types
	CommandSpawn  = "spawn"
	CommandKill   = "kill"
	CommandStatus = "status"

	// Event types
	EventQRCode           = "qr_code"
	EventConnectionStatus = "connection_status"
	EventMessage          = "message"
)

// SpawnWorkerCommand requests spawning a new WhatsApp worker process.
type SpawnWorkerCommand struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
	TenantSchema string `json:"tenant_schema"`
	DatabaseURL  string `json:"database_url"`
}

// KillWorkerCommand requests termination of a WhatsApp worker process.
type KillWorkerCommand struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
	Reason       string `json:"reason,omitempty"`
}

// WorkerStatusCommand requests the status of a WhatsApp worker.
type WorkerStatusCommand struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id"`
	ConnectionID string `json:"connection_id"`
}

// WorkerStatusResponse contains the status information of a worker.
type WorkerStatusResponse struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	Status       string    `json:"status"`
	ConnectedAt  time.Time `json:"connected_at,omitempty"`
	LastActivity time.Time `json:"last_activity,omitempty"`
	PID          int       `json:"pid,omitempty"`
	Error        string    `json:"error,omitempty"`
}

// QRCodeEvent is published when a QR code is generated for WhatsApp login.
type QRCodeEvent struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	QRData       string    `json:"qr_data"`
	Timestamp    time.Time `json:"timestamp"`
}

// ConnectionStatusEvent is published when the WhatsApp connection status changes.
type ConnectionStatusEvent struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	Status       string    `json:"status"`
	Reason       string    `json:"reason,omitempty"`
	Timestamp    time.Time `json:"timestamp"`
}

// MessageEvent is published when a WhatsApp message is received.
type MessageEvent struct {
	CompanyID    string    `json:"company_id"`
	ConnectionID string    `json:"connection_id"`
	MessageID    string    `json:"message_id"`
	From         string    `json:"from"`
	Content      string    `json:"content"`
	Type         string    `json:"type"`
	Timestamp    time.Time `json:"timestamp"`
}

// CommandEnvelope wraps any command with its type for routing.
type CommandEnvelope struct {
	Type    string `json:"type"`
	Payload []byte `json:"payload"`
}

// WorkerStatus constants
const (
	StatusStarting     = "starting"
	StatusConnecting   = "connecting"
	StatusConnected    = "connected"
	StatusDisconnected = "disconnected"
	StatusStopping     = "stopping"
	StatusStopped      = "stopped"
	StatusError        = "error"
)
