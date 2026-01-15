package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.mau.fi/whatsmeow/types"

	"github.com/ygncode-lab/whatsapp-web/services/shared/config"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/client"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/handler"
	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/storage"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Get worker configuration from environment using shared config utilities
	workerID := config.GetEnv("WORKER_ID", "default")
	companyID := config.GetEnv("COMPANY_ID", "")
	connectionID := config.GetEnv("CONNECTION_ID", "")
	tenantSchema := config.GetEnv("TENANT_SCHEMA", "")
	databaseURL := config.GetEnv("DATABASE_URL", "")
	natsURL := config.GetEnv("NATS_URL", "nats://localhost:4222")
	logLevel := config.GetEnv("LOG_LEVEL", "info")

	// Storage configuration (S3-compatible - works with MinIO and Cloudflare R2)
	// Check both STORAGE_* and S3_* env vars for compatibility with .env convention
	storageEndpoint := config.GetEnv("STORAGE_ENDPOINT", config.GetEnv("S3_ENDPOINT", "http://localhost:4450"))
	storageAccessKey := config.GetEnv("STORAGE_ACCESS_KEY", config.GetEnv("S3_ACCESS_KEY", "minioadmin"))
	storageSecretKey := config.GetEnv("STORAGE_SECRET_KEY", config.GetEnv("S3_SECRET_KEY", "minioadmin"))
	storageBucket := config.GetEnv("STORAGE_BUCKET", config.GetEnv("S3_BUCKET", "whatsapp-media"))
	storageRegion := config.GetEnv("STORAGE_REGION", config.GetEnv("S3_REGION", "us-east-1"))
	storagePublicURL := config.GetEnv("STORAGE_PUBLIC_URL", config.GetEnv("S3_PUBLIC_URL", ""))

	// Validate required configuration
	if companyID == "" {
		log.Fatal("COMPANY_ID environment variable is required")
	}
	if connectionID == "" {
		log.Fatal("CONNECTION_ID environment variable is required")
	}
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	log.Printf("Starting WhatsApp worker: %s for company: %s, connection: %s", workerID, companyID, connectionID)
	if tenantSchema != "" {
		log.Printf("Tenant schema: %s", tenantSchema)
	}
	log.Printf("Database URL configured")

	// Initialize storage client (non-blocking - bucket check runs in background)
	var storageClient *storage.Client
	if storageEndpoint != "" {
		var err error
		storageClient, err = storage.New(storage.Config{
			Endpoint:        storageEndpoint,
			AccessKeyID:     storageAccessKey,
			SecretAccessKey: storageSecretKey,
			Bucket:          storageBucket,
			Region:          storageRegion,
			PublicURL:       storagePublicURL,
			UsePathStyle:    true, // Required for MinIO
		})
		if err != nil {
			log.Printf("Warning: Failed to initialize storage client: %v", err)
			log.Println("Media files will not be persisted")
		} else {
			// Ensure bucket exists in background to not delay QR code flow
			go func() {
				if err := storageClient.EnsureBucketExists(ctx); err != nil {
					log.Printf("Warning: Failed to ensure bucket exists: %v", err)
				} else {
					log.Printf("Storage client connected to %s, bucket: %s", storageEndpoint, storageBucket)
				}
			}()
		}
	}

	// Initialize NATS publisher
	publisher, err := natsClient.NewPublisher(natsClient.PublisherConfig{
		NATSURL:      natsURL,
		CompanyID:    companyID,
		ConnectionID: connectionID,
	})
	if err != nil {
		log.Fatalf("Failed to initialize NATS publisher: %v", err)
	}
	defer publisher.Close()
	log.Printf("NATS publisher connected to %s", natsURL)

	// Initialize WhatsApp client
	waClient, err := client.New(ctx, client.Config{
		WorkerID:     workerID,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		DatabaseURL:  databaseURL,
		LogLevel:     logLevel,
	})
	if err != nil {
		log.Fatalf("Failed to initialize WhatsApp client: %v", err)
	}
	defer waClient.Disconnect()

	// Set up QR code callback to publish to NATS
	waClient.SetQRCallback(func(qrCode string) {
		if err := publisher.PublishQRCode(qrCode); err != nil {
			log.Printf("Failed to publish QR code: %v", err)
		}
	})

	// Set up status callback to publish to NATS
	waClient.SetStatusCallback(func(status, reason string) {
		if err := publisher.PublishConnectionStatus(status, reason, "", ""); err != nil {
			log.Printf("Failed to publish status: %v", err)
		}
	})

	// Initialize message handler with NATS publisher and storage
	msgHandler := handler.New(handler.Config{
		WorkerID:     workerID,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		NATSUrl:      natsURL,
		Client:       waClient,
		Publisher:    publisher,
		Storage:      storageClient,
		Ctx:          ctx,
	})

	// Register event handlers
	waClient.RegisterEventHandler(msgHandler.HandleEvent)

	// Initialize on-demand download handler
	downloadHandler, err := handler.NewDownloadHandler(msgHandler)
	if err != nil {
		log.Printf("Warning: Failed to initialize download handler: %v", err)
		log.Println("On-demand media downloads will not be available")
	} else {
		defer downloadHandler.Close()
		log.Printf("Download handler initialized for on-demand media downloads")
	}

	// Initialize NATS subscriber for send commands
	subscriber, err := natsClient.NewSubscriber(natsClient.SubscriberConfig{
		NATSURL:      natsURL,
		CompanyID:    companyID,
		ConnectionID: connectionID,
		Sender:       waClient,
		Blocker:      waClient,
		TypingSender: waClient,
		Publisher:    publisher,
	})
	if err != nil {
		log.Fatalf("Failed to initialize NATS subscriber: %v", err)
	}
	defer subscriber.Stop()

	// Start the subscriber
	if err := subscriber.Start(); err != nil {
		log.Fatalf("Failed to start NATS subscriber: %v", err)
	}
	log.Printf("NATS subscriber listening for send commands")

	// Connect to WhatsApp
	if err := waClient.Connect(ctx); err != nil {
		log.Fatalf("Failed to connect to WhatsApp: %v", err)
	}

	// Explicitly mark as available to receive typing indicators (ChatPresence events)
	// This is a fallback - the Connected event handler also calls this, but we do it here
	// to ensure it happens even if the Connected event fires before handlers are registered
	go func() {
		time.Sleep(2 * time.Second) // Wait for connection to stabilize
		if err := waClient.SendPresence(ctx, types.PresenceAvailable); err != nil {
			log.Printf("Warning: Failed to send presence available: %v", err)
		} else {
			log.Printf("Sent presence available after connect (fallback)")
		}
	}()

	log.Printf("WhatsApp worker %s is running for company %s, connection %s", workerID, companyID, connectionID)

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down WhatsApp worker...")

	// Cancel context to stop any active reconnection loops
	cancel()

	// Explicitly stop reconnection loop (in case it's still active)
	waClient.StopReconnect()
}
