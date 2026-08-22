package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
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
	ID                string    `json:"id"`
	CompanyID         string    `json:"company_id"`
	TenantSchema      string    `json:"tenant_schema,omitempty"`
	Status            string    `json:"status"`
	PID               int       `json:"pid,omitempty"`
	StartedAt         time.Time `json:"started_at,omitempty"`
	LastActivity      time.Time `json:"last_activity,omitempty"`
	LaunchID          string    `json:"launch_id"`
	DesiredState      string    `json:"desired_state"`
	ArtifactVersion   string    `json:"artifact_version"`
	ArtifactSHA256    string    `json:"artifact_sha256"`
	WorkerUID         int       `json:"worker_uid,omitempty"`
	WorkerGID         int       `json:"worker_gid,omitempty"`
	ProcessReady      bool      `json:"process_ready"`
	WhatsAppConnected bool      `json:"whatsapp_connected"`
	Authenticated     bool      `json:"authenticated"`
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
	mux.Handle("/rollouts", s.requireRolloutBearer(http.HandlerFunc(s.handleRollouts)))
	mux.Handle("/rollouts/", s.requireRolloutBearer(http.HandlerFunc(s.handleRolloutByID)))

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

func (s *Server) requireRolloutBearer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Rollout mutation/status is authenticated even on a loopback listener.
		// A missing token disables this operational API rather than turning local
		// network placement into authorization.
		if s.bearerToken == "" {
			s.writeError(w, http.StatusServiceUnavailable, "rollout API authentication is not configured", "")
			return
		}
		s.requireBearer(next).ServeHTTP(w, r)
	})
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
			ID:                w.ID,
			CompanyID:         w.CompanyID,
			TenantSchema:      w.TenantSchema,
			Status:            w.Status,
			PID:               w.PID,
			StartedAt:         w.StartedAt,
			LastActivity:      w.LastActivity,
			LaunchID:          w.LaunchID,
			DesiredState:      w.DesiredState,
			ArtifactVersion:   w.ArtifactVersion,
			ArtifactSHA256:    w.ArtifactSHA256,
			WorkerUID:         w.WorkerUID,
			WorkerGID:         w.WorkerGID,
			ProcessReady:      w.ProcessReady,
			WhatsAppConnected: w.RuntimeConnected,
			Authenticated:     w.Authenticated,
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
		ID:                worker.ID,
		CompanyID:         worker.CompanyID,
		TenantSchema:      worker.TenantSchema,
		Status:            worker.Status,
		PID:               worker.PID,
		StartedAt:         worker.StartedAt,
		LastActivity:      worker.LastActivity,
		LaunchID:          worker.LaunchID,
		DesiredState:      worker.DesiredState,
		ArtifactVersion:   worker.ArtifactVersion,
		ArtifactSHA256:    worker.ArtifactSHA256,
		WorkerUID:         worker.WorkerUID,
		WorkerGID:         worker.WorkerGID,
		ProcessReady:      worker.ProcessReady,
		WhatsAppConnected: worker.RuntimeConnected,
		Authenticated:     worker.Authenticated,
	}

	s.writeJSON(w, http.StatusOK, response)
}

// writeJSON writes a JSON response.
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func (s *Server) handleRollouts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		body := http.MaxBytesReader(w, r.Body, 64<<10)
		decoder := json.NewDecoder(body)
		decoder.DisallowUnknownFields()
		var request manager.WorkerUpgradeRequest
		if err := decoder.Decode(&request); err != nil {
			s.writeError(w, http.StatusBadRequest, "invalid rollout request", "")
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			s.writeError(w, http.StatusBadRequest, "request body must contain one JSON object", "")
			return
		}
		if request.CompanyID != "" && !uuidPattern.MatchString(request.CompanyID) {
			s.writeError(w, http.StatusBadRequest, "company_id must be a UUID", "")
			return
		}
		if request.ConnectionID != "" && !uuidPattern.MatchString(request.ConnectionID) {
			s.writeError(w, http.StatusBadRequest, "connection_id must be a UUID", "")
			return
		}
		batch, err := s.manager.StartWorkerUpgrade(r.Context(), request)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, manager.ErrUpgradeUnavailable) {
				status = http.StatusServiceUnavailable
			} else if errors.Is(err, manager.ErrWorkerUpgradeBatchActive) {
				status = http.StatusConflict
			} else if errors.Is(err, manager.ErrUpgradeNoWorkers) {
				status = http.StatusUnprocessableEntity
			}
			s.writeError(w, status, "rollout was not started", err.Error())
			return
		}
		s.writeJSON(w, http.StatusAccepted, batch)
	case http.MethodGet:
		batch, err := s.manager.GetActiveWorkerUpgrade(r.Context())
		if err != nil {
			s.writeError(w, http.StatusServiceUnavailable, "rollout status unavailable", "")
			return
		}
		if batch == nil {
			s.writeError(w, http.StatusNotFound, "no active rollout", "")
			return
		}
		s.writeJSON(w, http.StatusOK, batch)
	default:
		s.writeError(w, http.StatusMethodNotAllowed, "method not allowed", "")
	}
}

func (s *Server) handleRolloutByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/rollouts/"))
	if strings.HasSuffix(path, "/retry-rollback") {
		if r.Method != http.MethodPost {
			s.writeError(w, http.StatusMethodNotAllowed, "method not allowed", "")
			return
		}
		id := strings.TrimSuffix(path, "/retry-rollback")
		if !uuidPattern.MatchString(id) {
			s.writeError(w, http.StatusBadRequest, "rollout ID must be a UUID", "")
			return
		}
		body := http.MaxBytesReader(w, r.Body, 16<<10)
		decoder := json.NewDecoder(body)
		decoder.DisallowUnknownFields()
		var request struct {
			ConnectionID string `json:"connection_id"`
		}
		if err := decoder.Decode(&request); err != nil || !uuidPattern.MatchString(request.ConnectionID) {
			s.writeError(w, http.StatusBadRequest, "connection_id must be a UUID", "")
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			s.writeError(w, http.StatusBadRequest, "request body must contain one JSON object", "")
			return
		}
		batch, err := s.manager.RetryWorkerUpgradeRollback(r.Context(), id, request.ConnectionID)
		if err != nil {
			status := http.StatusConflict
			if errors.Is(err, manager.ErrUpgradeUnavailable) {
				status = http.StatusServiceUnavailable
			}
			s.writeError(w, status, "rollback retry was not started", err.Error())
			return
		}
		s.writeJSON(w, http.StatusAccepted, batch)
		return
	}

	if r.Method != http.MethodGet {
		s.writeError(w, http.StatusMethodNotAllowed, "method not allowed", "")
		return
	}
	if !uuidPattern.MatchString(path) {
		s.writeError(w, http.StatusBadRequest, "rollout ID must be a UUID", "")
		return
	}
	batch, err := s.manager.GetWorkerUpgrade(r.Context(), path)
	if err != nil {
		s.writeError(w, http.StatusServiceUnavailable, "rollout status unavailable", "")
		return
	}
	if batch == nil {
		s.writeError(w, http.StatusNotFound, "rollout not found", "")
		return
	}
	s.writeJSON(w, http.StatusOK, batch)
}

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
