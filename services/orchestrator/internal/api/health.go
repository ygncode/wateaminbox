package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/manager"
)

// Server provides HTTP endpoints for health checks and worker status.
type Server struct {
	manager    *manager.Manager
	httpServer *http.Server
	addr       string
	startedAt  time.Time
}

// Config holds the configuration for the HTTP server.
type Config struct {
	Address string
	Manager *manager.Manager
}

// HealthResponse represents the health check response.
type HealthResponse struct {
	Status      string    `json:"status"`
	Service     string    `json:"service"`
	Version     string    `json:"version"`
	Uptime      string    `json:"uptime"`
	WorkerCount int       `json:"worker_count"`
	Timestamp   time.Time `json:"timestamp"`
}

// WorkerResponse represents a worker in the API response.
type WorkerResponse struct {
	ID           string    `json:"id"`
	CompanyID    string    `json:"company_id"`
	TenantSchema string    `json:"tenant_schema,omitempty"`
	Status       string    `json:"status"`
	PID          int       `json:"pid,omitempty"`
	StartedAt    time.Time `json:"started_at,omitempty"`
	LastActivity time.Time `json:"last_activity,omitempty"`
}

// WorkersListResponse represents the workers list response.
type WorkersListResponse struct {
	Workers []WorkerResponse `json:"workers"`
	Count   int              `json:"count"`
}

// ErrorResponse represents an error response.
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}

// NewServer creates a new HTTP server.
func NewServer(cfg Config) *Server {
	if cfg.Address == "" {
		cfg.Address = ":8080"
	}

	s := &Server{
		manager:   cfg.Manager,
		addr:      cfg.Address,
		startedAt: time.Now(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/workers", s.handleWorkers)
	mux.HandleFunc("/workers/", s.handleWorkerByID)

	s.httpServer = &http.Server{
		Addr:         cfg.Address,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return s
}

// Start starts the HTTP server.
func (s *Server) Start() error {
	log.Printf("Starting HTTP server on %s", s.addr)

	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()

	return nil
}

// Stop gracefully stops the HTTP server.
func (s *Server) Stop(ctx context.Context) error {
	log.Println("Stopping HTTP server...")
	return s.httpServer.Shutdown(ctx)
}

// handleHealth handles GET /health requests.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeError(w, http.StatusMethodNotAllowed, "method not allowed", "")
		return
	}

	uptime := time.Since(s.startedAt)

	response := HealthResponse{
		Status:      "healthy",
		Service:     "orchestrator",
		Version:     "1.0.0",
		Uptime:      uptime.String(),
		WorkerCount: s.manager.WorkerCount(),
		Timestamp:   time.Now(),
	}

	s.writeJSON(w, http.StatusOK, response)
}

// handleWorkers handles GET /workers requests.
func (s *Server) handleWorkers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeError(w, http.StatusMethodNotAllowed, "method not allowed", "")
		return
	}

	workers := s.manager.ListWorkers()
	workerResponses := make([]WorkerResponse, len(workers))

	for i, w := range workers {
		workerResponses[i] = WorkerResponse{
			ID:           w.ID,
			CompanyID:    w.CompanyID,
			TenantSchema: w.TenantSchema,
			Status:       w.Status,
			PID:          w.PID,
			StartedAt:    w.StartedAt,
			LastActivity: w.LastActivity,
		}
	}

	response := WorkersListResponse{
		Workers: workerResponses,
		Count:   len(workerResponses),
	}

	s.writeJSON(w, http.StatusOK, response)
}

// handleWorkerByID handles GET /workers/:id requests.
func (s *Server) handleWorkerByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeError(w, http.StatusMethodNotAllowed, "method not allowed", "")
		return
	}

	// Extract worker ID from path
	path := strings.TrimPrefix(r.URL.Path, "/workers/")
	workerID := strings.TrimSpace(path)

	if workerID == "" {
		s.writeError(w, http.StatusBadRequest, "worker ID required", "")
		return
	}

	worker, exists := s.manager.GetWorkerStatus(workerID)
	if !exists {
		s.writeError(w, http.StatusNotFound, "worker not found", workerID)
		return
	}

	response := WorkerResponse{
		ID:           worker.ID,
		CompanyID:    worker.CompanyID,
		TenantSchema: worker.TenantSchema,
		Status:       worker.Status,
		PID:          worker.PID,
		StartedAt:    worker.StartedAt,
		LastActivity: worker.LastActivity,
	}

	s.writeJSON(w, http.StatusOK, response)
}

// writeJSON writes a JSON response.
func (s *Server) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Failed to encode JSON response: %v", err)
	}
}

// writeError writes an error response.
func (s *Server) writeError(w http.ResponseWriter, status int, message, details string) {
	response := ErrorResponse{
		Error:   http.StatusText(status),
		Code:    status,
		Message: message,
	}

	if details != "" {
		response.Message = message + ": " + details
	}

	s.writeJSON(w, status, response)
}
