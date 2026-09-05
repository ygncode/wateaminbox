package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/api"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/manager"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/shared/config"
)

func loadHTTPBearerToken() (string, error) {
	direct := strings.TrimSpace(os.Getenv("HTTP_BEARER_TOKEN"))
	path := strings.TrimSpace(os.Getenv("HTTP_BEARER_TOKEN_FILE"))
	// Neither the authority nor its location may enter a worker environment.
	_ = os.Unsetenv("HTTP_BEARER_TOKEN")
	_ = os.Unsetenv("HTTP_BEARER_TOKEN_FILE")
	if path == "" {
		return direct, nil
	}
	if direct != "" {
		return "", fmt.Errorf("configure HTTP bearer authority by value or file, not both")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", fmt.Errorf("inspect HTTP bearer token file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return "", fmt.Errorf("HTTP bearer token file must be a root-only regular file")
	}
	if strings.HasPrefix(path, "/run/wateaminbox-control/") {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return "", fmt.Errorf("ephemeral HTTP bearer token file must be owned by root")
		}
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read HTTP bearer token file: %w", err)
	}
	return strings.TrimSpace(string(contents)), nil
}

type managerStopper interface {
	Stop(context.Context) error
}

// stopManagerAfterStartupFailure releases durable ownership and terminates any
// recovered workers before main exits. log.Fatalf skips defers, so calling it
// directly after a partially successful startup would otherwise leave the node
// lease live until its TTL and make the replacement container fail to register.
func stopManagerAfterStartupFailure(mgr managerStopper) {
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := mgr.Stop(shutdownCtx); err != nil {
		log.Printf("Error cleaning up manager after startup failure: %v", err)
	}
}

func main() {
	log.Println("Starting WhatsApp Orchestrator...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Get configuration from environment using shared config utilities
	natsURL := config.GetEnv("NATS_URL", "nats://localhost:4222")
	httpAddr := config.GetEnv("HTTP_ADDR", "127.0.0.1:8080")
	httpBearerToken, err := loadHTTPBearerToken()
	if err != nil {
		log.Fatalf("Invalid HTTP bearer authority: %v", err)
	}
	whatsappBinaryPath := config.GetEnv("WHATSAPP_BINARY_PATH", "/usr/local/bin/whatsapp-worker")
	healthCheckInterval := config.GetDurationEnv("HEALTH_CHECK_INTERVAL", 30*time.Second)

	// Auto-restart configuration
	databaseURL := config.GetEnv("DATABASE_URL", "")
	workerDatabaseURL := config.GetEnv("WORKER_DATABASE_URL", "")
	workerNATSURL := config.GetEnv("WORKER_NATS_URL", "")
	autoRestartEnabled := config.GetBoolEnv("AUTO_RESTART_ENABLED", true)
	autoRestartMaxRetries := config.GetIntEnv("AUTO_RESTART_MAX_RETRIES", 5)
	autoRestartBackoff := config.GetDurationEnv("AUTO_RESTART_BACKOFF", 5*time.Second)
	maxWorkers := config.GetIntEnv("ORCHESTRATOR_MAX_WORKERS", 15)
	scopeValue, scopeConfigured := os.LookupEnv("ORCHESTRATOR_CONNECTION_SCOPE")
	connectionScope, err := manager.ParseConnectionScope(scopeValue, scopeConfigured)
	if err != nil {
		log.Fatalf("Invalid runtime connection scope: %v", err)
	}
	artifactRoot := config.GetEnv("WORKER_ARTIFACT_ROOT", "/var/lib/wateaminbox/worker-artifacts")
	defaultArtifactVersion := config.GetEnv("WORKER_DEFAULT_ARTIFACT_VERSION", "embedded")
	defaultArtifactSHA256 := config.GetEnv("WORKER_DEFAULT_ARTIFACT_SHA256", "")
	rolloutReadyTimeout := config.GetDurationEnv("WORKER_ROLLOUT_READY_TIMEOUT", 2*time.Minute)
	rootManagerApproved := config.GetBoolEnv("ORCHESTRATOR_ROOT_MANAGER_APPROVED", false)
	// The node identity scopes durable worker ownership and per-node command
	// routing. It must be stable across restarts of the same instance, so it is
	// explicit configuration rather than a derived value like the container
	// hostname, which changes on recreate and would strand owned records.
	nodeID := strings.TrimSpace(config.GetEnv("ORCHESTRATOR_NODE_ID", ""))
	if databaseURL != "" && nodeID == "" {
		log.Fatalf("ORCHESTRATOR_NODE_ID is required when DATABASE_URL is configured")
	}
	// Fleet-wide connection ceiling enforced atomically inside the registry
	// claim; per-process ORCHESTRATOR_MAX_WORKERS remains host capacity.
	fleetMaxConnections := config.GetIntEnv("ORCHESTRATOR_FLEET_MAX_CONNECTIONS", 15)
	nodeLeaseDuration := config.GetDurationEnv("ORCHESTRATOR_NODE_LEASE_DURATION", 60*time.Second)
	nodeTakeoverMargin := config.GetDurationEnv("ORCHESTRATOR_NODE_TAKEOVER_MARGIN", 60*time.Second)
	if maxWorkers < 0 {
		log.Fatalf("ORCHESTRATOR_MAX_WORKERS must be non-negative, got %d", maxWorkers)
	}
	if fleetMaxConnections < 0 {
		log.Fatalf("ORCHESTRATOR_FLEET_MAX_CONNECTIONS must be non-negative, got %d", fleetMaxConnections)
	}
	if nodeLeaseDuration <= 0 || nodeTakeoverMargin <= 0 {
		log.Fatalf("ORCHESTRATOR_NODE_LEASE_DURATION and ORCHESTRATOR_NODE_TAKEOVER_MARGIN must be positive")
	}
	if rolloutReadyTimeout <= 0 {
		log.Fatalf("WORKER_ROLLOUT_READY_TIMEOUT must be positive, got %s", rolloutReadyTimeout)
	}

	// Initialize NATS client
	natsClient, err := nats.NewClient(ctx, nats.Config{
		URL: natsURL,
	})
	if err != nil {
		log.Fatalf("Failed to connect to NATS: %v", err)
	}
	defer natsClient.Close()

	// Create JetStream streams
	if err := natsClient.CreateStreams(); err != nil {
		log.Fatalf("Failed to create NATS streams: %v", err)
	}

	// Initialize process manager
	mgr := manager.New(manager.Config{
		ConnectionScope:        connectionScope,
		NewConnectionAdmission: config.GetBoolEnv("ORCHESTRATOR_NEW_CONNECTION_ADMISSION", false),
		NATSClient:             natsClient,
		WhatsAppBinaryPath:     whatsappBinaryPath,
		DefaultNATSURL:         natsURL,
		HealthCheckInterval:    healthCheckInterval,
		DatabaseURL:            databaseURL,
		WorkerDatabaseURL:      workerDatabaseURL,
		WorkerNATSURL:          workerNATSURL,
		AutoRestartEnabled:     autoRestartEnabled,
		AutoRestartMaxRetries:  autoRestartMaxRetries,
		AutoRestartBackoff:     autoRestartBackoff,
		MaxWorkers:             maxWorkers,
		ArtifactRoot:           artifactRoot,
		DefaultArtifactVersion: defaultArtifactVersion,
		DefaultArtifactSHA256:  defaultArtifactSHA256,
		RolloutReadyTimeout:    rolloutReadyTimeout,
		RootManagerApproved:    rootManagerApproved,
		NodeID:                 nodeID,
		FleetMaxConnections:    fleetMaxConnections,
		NodeLeaseDuration:      nodeLeaseDuration,
		NodeTakeoverMargin:     nodeTakeoverMargin,
	})

	// Validate the HTTP server before the manager registers its node lease or
	// recovers workers. Configuration errors can then fail without any durable
	// or process cleanup.
	httpServer, err := api.NewServer(api.Config{
		Address:     httpAddr,
		BearerToken: httpBearerToken,
		Manager:     mgr,
	})
	if err != nil {
		log.Fatalf("Invalid HTTP server configuration: %v", err)
	}

	// Start the manager only after all static HTTP configuration is valid. Start
	// can fail after registering the lease (for example while creating command
	// subscriptions), so run the same bounded cleanup on every error.
	if err := mgr.Start(ctx); err != nil {
		stopManagerAfterStartupFailure(mgr)
		log.Fatalf("Failed to start manager: %v", err)
	}
	if err := httpServer.Start(); err != nil {
		stopManagerAfterStartupFailure(mgr)
		log.Fatalf("Failed to start HTTP server: %v", err)
	}

	log.Println("Orchestrator started successfully")
	log.Printf("HTTP server listening on %s", httpAddr)
	log.Printf("NATS connected to %s", config.RedactURL(natsURL))

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh

	log.Printf("Received signal %v, shutting down orchestrator...", sig)

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Stop HTTP server
	if err := httpServer.Stop(shutdownCtx); err != nil {
		log.Printf("Error stopping HTTP server: %v", err)
	}

	// Stop manager (this will stop all workers)
	if err := mgr.Stop(shutdownCtx); err != nil {
		log.Printf("Error during manager shutdown: %v", err)
	}

	log.Println("Orchestrator shutdown complete")
}
