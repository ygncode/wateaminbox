package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/manager"
)

// Server provides HTTP endpoints for health checks and worker status.
type Server struct {
	manager     *manager.Manager
	httpServer  *http.Server
	listener    net.Listener
	addr        string
	bearerToken string
	startedAt   time.Time
}

// Config holds the configuration for the HTTP server.
type Config struct {
	Address     string
	BearerToken string
	Manager     *manager.Manager
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

// NewServer creates a new HTTP server. Non-loopback listeners must configure a
// bearer token because worker responses expose tenant and process metadata.
func NewServer(cfg Config) (*Server, error) {
	if cfg.Address == "" {
		cfg.Address = "127.0.0.1:8080"
	}

	cfg.BearerToken = strings.TrimSpace(cfg.BearerToken)
	loopback, err := isLoopbackAddress(cfg.Address)
	if err != nil {
		return nil, fmt.Errorf("invalid HTTP address %q: %w", cfg.Address, err)
	}
	if !loopback && cfg.BearerToken == "" {
		return nil, fmt.Errorf("HTTP_BEARER_TOKEN is required for non-loopback HTTP_ADDR")
	}
	if cfg.BearerToken != "" && len(cfg.BearerToken) < 32 {
		return nil, fmt.Errorf("HTTP_BEARER_TOKEN must contain at least 32 characters")
	}

	s := &Server{
		manager:     cfg.Manager,
		addr:        cfg.Address,
		bearerToken: cfg.BearerToken,
		startedAt:   time.Now(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.Handle("/workers", s.requireBearer(http.HandlerFunc(s.handleWorkers)))
	mux.Handle("/workers/", s.requireBearer(http.HandlerFunc(s.handleWorkerByID)))

	s.httpServer = &http.Server{
		Addr:         cfg.Address,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return s, nil
}

func isLoopbackAddress(address string) (bool, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false, err
	}
	if strings.EqualFold(host, "localhost") {
		return true, nil
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback(), nil
}

func (s *Server) requireBearer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.bearerToken == "" {
			next.ServeHTTP(w, r)
			return
		}

		scheme, token, found := strings.Cut(strings.TrimSpace(r.Header.Get("Authorization")), " ")
		providedHash := sha256.Sum256([]byte(strings.TrimSpace(token)))
		expectedHash := sha256.Sum256([]byte(s.bearerToken))
		valid := found && strings.EqualFold(scheme, "Bearer") &&
			subtle.ConstantTimeCompare(providedHash[:], expectedHash[:]) == 1
		if !valid {
			w.Header().Set("WWW-Authenticate", `Bearer realm="orchestrator"`)
			s.writeError(w, http.StatusUnauthorized, "valid bearer token required", "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Start starts the HTTP server.
func (s *Server) Start() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", s.addr, err)
	}
	s.listener = listener
	log.Printf("Starting HTTP server on %s", listener.Addr())

	go func() {
		if err := s.httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
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
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
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
