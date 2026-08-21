package handler

import (
	"fmt"
	"os"
	"testing"
	"time"

	gnats "github.com/nats-io/nats.go"
	workernats "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// TestRestrictedWorkerNATSStartsProductionClients exercises the constructors
// and cleanup paths used by a real worker. Stream provisioning is intentionally
// absent: the privileged orchestrator must have completed it before launch.
func TestRestrictedWorkerNATSStartsProductionClients(t *testing.T) {
	workerURL := os.Getenv("NATS_WORKER_TEST_URL")
	serviceURL := os.Getenv("NATS_SERVICE_TEST_URL")
	if workerURL == "" || serviceURL == "" {
		t.Skip("set NATS_WORKER_TEST_URL and NATS_SERVICE_TEST_URL")
	}
	service, err := gnats.Connect(serviceURL)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	serviceJS, err := service.JetStream()
	if err != nil {
		t.Fatal(err)
	}
	commandConsumer := fmt.Sprintf(workernats.ConsumerSend, "permission-company", "permission-connection")
	_ = serviceJS.DeleteConsumer(workernats.CommandsStreamName, commandConsumer)
	_, err = serviceJS.AddConsumer(workernats.CommandsStreamName, &gnats.ConsumerConfig{
		Durable: commandConsumer, FilterSubject: "WHATSAPP.commands.permission-company.permission-connection",
		AckPolicy: gnats.AckExplicitPolicy, DeliverPolicy: gnats.DeliverNewPolicy,
		AckWait: time.Second, MaxDeliver: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer serviceJS.DeleteConsumer(workernats.CommandsStreamName, commandConsumer)

	publisher, err := workernats.NewPublisher(workernats.PublisherConfig{
		NATSURL: workerURL, CompanyID: "permission-company",
		ConnectionID: "permission-connection", LaunchID: "permission-launch",
		ArtifactVersion: "permission-artifact", ReadinessToken: "permission-readiness-token",
	})
	if err != nil {
		t.Fatalf("restricted worker publisher startup: %v", err)
	}
	defer publisher.Close()

	subscriber, err := workernats.NewSubscriber(workernats.SubscriberConfig{
		NATSURL: workerURL, CompanyID: "permission-company", ConnectionID: "permission-connection",
	})
	if err != nil {
		t.Fatalf("restricted worker subscriber startup: %v", err)
	}
	if err = subscriber.Start(); err != nil {
		subscriber.Stop()
		t.Fatalf("restricted worker subscriber consumer startup: %v", err)
	}
	defer subscriber.Stop()
	commandInfo, err := serviceJS.ConsumerInfo(workernats.CommandsStreamName, commandConsumer)
	if err != nil {
		t.Fatal(err)
	}
	if commandInfo.Config.AckWait < 2*time.Minute || commandInfo.Config.MaxDeliver < 10 {
		t.Fatalf("restricted subscriber did not update its durable retry policy: %+v", commandInfo.Config)
	}

	h := New(Config{
		CompanyID: "permission-company", ConnectionID: "permission-connection",
		NATSUrl: workerURL, Publisher: publisher,
	})
	downloads, err := NewDownloadHandler(h)
	if err != nil {
		t.Fatalf("restricted worker download startup: %v", err)
	}
	downloadConsumerName := ""
	for name := range serviceJS.ConsumerNames("WHATSAPP_DOWNLOADS") {
		info, infoErr := serviceJS.ConsumerInfo("WHATSAPP_DOWNLOADS", name)
		if infoErr == nil && info.Config.FilterSubject == "WHATSAPP.download.permission-company.permission-connection.request" {
			downloadConsumerName = name
			break
		}
	}
	if downloadConsumerName == "" {
		t.Fatal("privileged inspection could not find production download consumer")
	}
	downloads.Close() // Unsubscribe must delete the library-owned ephemeral consumer.
	if _, err = serviceJS.ConsumerInfo("WHATSAPP_DOWNLOADS", downloadConsumerName); err != gnats.ErrConsumerNotFound {
		t.Fatalf("production download unsubscribe did not clean up consumer: %v", err)
	}
}
