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
)

func main() {
	log.Println("Starting WhatsApp Orchestrator...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Get configuration from environment
	natsURL := getEnv("NATS_URL", "nats://localhost:4222")
	httpAddr := getEnv("HTTP_ADDR", ":8080")
	whatsappBinaryPath := getEnv("WHATSAPP_BINARY_PATH", "/usr/local/bin/whatsapp-worker")
	healthCheckInterval := getDurationEnv("HEALTH_CHECK_INTERVAL", 30*time.Second)

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
		NATSClient:          natsClient,
		WhatsAppBinaryPath:  whatsappBinaryPath,
		DefaultNATSURL:      natsURL,
		HealthCheckInterval: healthCheckInterval,
	})

	// Start the manager
	if err := mgr.Start(ctx); err != nil {
		log.Fatalf("Failed to start manager: %v", err)
	}

	// Initialize and start HTTP server
	httpServer := api.NewServer(api.Config{
		Address: httpAddr,
		Manager: mgr,
	})
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

// getEnv returns the value of an environment variable or a default value.
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getDurationEnv returns a duration from an environment variable or a default value.
func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		d, err := time.ParseDuration(value)
		if err != nil {
			log.Printf("Invalid duration for %s: %v, using default", key, err)
			return defaultValue
		}
		return d
	}
	return defaultValue
}
