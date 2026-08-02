package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/api"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/manager"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/shared/config"
)

func main() {
	log.Println("Starting WhatsApp Orchestrator...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Get configuration from environment using shared config utilities
	natsURL := config.GetEnv("NATS_URL", "nats://localhost:4222")
	httpAddr := config.GetEnv("HTTP_ADDR", "127.0.0.1:8080")
	httpBearerToken := config.GetEnv("HTTP_BEARER_TOKEN", "")
	whatsappBinaryPath := config.GetEnv("WHATSAPP_BINARY_PATH", "/usr/local/bin/whatsapp-worker")
	healthCheckInterval := config.GetDurationEnv("HEALTH_CHECK_INTERVAL", 30*time.Second)

	// Auto-restart configuration
	databaseURL := config.GetEnv("DATABASE_URL", "")
	autoRestartEnabled := config.GetBoolEnv("AUTO_RESTART_ENABLED", true)
	autoRestartMaxRetries := config.GetIntEnv("AUTO_RESTART_MAX_RETRIES", 5)
	autoRestartBackoff := config.GetDurationEnv("AUTO_RESTART_BACKOFF", 5*time.Second)

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
		NATSClient:            natsClient,
		WhatsAppBinaryPath:    whatsappBinaryPath,
		DefaultNATSURL:        natsURL,
		HealthCheckInterval:   healthCheckInterval,
		DatabaseURL:           databaseURL,
		AutoRestartEnabled:    autoRestartEnabled,
		AutoRestartMaxRetries: autoRestartMaxRetries,
		AutoRestartBackoff:    autoRestartBackoff,
	})

	// Start the manager
	if err := mgr.Start(ctx); err != nil {
		log.Fatalf("Failed to start manager: %v", err)
	}

	// Initialize and start HTTP server
	httpServer, err := api.NewServer(api.Config{
		Address:     httpAddr,
		BearerToken: httpBearerToken,
		Manager:     mgr,
	})
	if err != nil {
		log.Fatalf("Invalid HTTP server configuration: %v", err)
	}
	if err := httpServer.Start(); err != nil {
		log.Fatalf("Failed to start HTTP server: %v", err)
	}

	log.Println("Orchestrator started successfully")
	log.Printf("HTTP server listening on %s", httpAddr)
	log.Printf("NATS connected to %s", natsURL)

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
