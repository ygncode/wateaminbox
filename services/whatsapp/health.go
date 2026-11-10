package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

// healthState is what the HTTP health endpoints report. It is deliberately
// small: the worker's authoritative status still travels over NATS, and the
// endpoint exists so a container runtime can probe the process without
// holding NATS credentials. Nothing here identifies the tenant or the phone.
type healthState struct {
	// Ready is set once every process-level dependency is initialized, the
	// same moment the signed process-ready runtime signal is published.
	Ready bool `json:"ready"`
	// Connected reports the live WhatsApp socket.
	Connected bool `json:"connected"`
	// LoggedIn reports whether a paired device identity is present and
	// authenticated; false while QR pairing is pending.
	LoggedIn bool `json:"loggedIn"`
}

// connectionProbe is the subset of the WhatsApp client the health server reads.
type connectionProbe interface {
	IsConnected() bool
	IsLoggedIn() bool
}

// healthServer serves two endpoints:
//
//	GET /healthz/live   200 once the server is up; the process is alive.
//	GET /healthz/ready  200 when the worker is ready, connected and logged in,
//	                    otherwise 503. The JSON body carries the three flags.
//
// Readiness returns 503 during QR pairing on purpose: a probe-driven supervisor
// should not route or count an unpaired worker as healthy, and the orchestrator
// path (which does not enable this server) keeps its own semantics.
type healthServer struct {
	probe connectionProbe
	ready atomic.Bool
	srv   *http.Server
}

func newHealthServer(probe connectionProbe) *healthServer {
	h := &healthServer{probe: probe}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz/live", h.handleLive)
	mux.HandleFunc("GET /healthz/ready", h.handleReady)
	h.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	return h
}

// markReady flips readiness; it is called once, after the process-ready
// runtime signal has been published.
func (h *healthServer) markReady() { h.ready.Store(true) }

func (h *healthServer) state() healthState {
	s := healthState{Ready: h.ready.Load()}
	if h.probe != nil {
		s.Connected = h.probe.IsConnected()
		s.LoggedIn = h.probe.IsLoggedIn()
	}
	return s
}

func (h *healthServer) handleLive(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

func (h *healthServer) handleReady(w http.ResponseWriter, _ *http.Request) {
	s := h.state()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if s.Ready && s.Connected && s.LoggedIn {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(s)
}

// serve listens on addr until ctx is cancelled. It returns the bound address
// so callers (and tests) can use port 0.
func (h *healthServer) serve(ctx context.Context, addr string) (string, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", err
	}
	go func() {
		if err := h.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Health server stopped: %v", err)
		}
	}()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = h.srv.Shutdown(shutdownCtx)
	}()
	return ln.Addr().String(), nil
}
