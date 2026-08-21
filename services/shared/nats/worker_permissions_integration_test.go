package nats

import (
	"os"
	"strings"
	"testing"
	"time"

	gnats "github.com/nats-io/nats.go"
)

func TestRestrictedWorkerNATSPermissionMatrix(t *testing.T) {
	serviceURL := os.Getenv("NATS_SERVICE_TEST_URL")
	workerURL := os.Getenv("NATS_WORKER_TEST_URL")
	if serviceURL == "" || workerURL == "" {
		t.Skip("set NATS_SERVICE_TEST_URL and NATS_WORKER_TEST_URL")
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
	for _, cfg := range []StreamConfig{
		DefaultCommandsStreamConfig(), DefaultEventsStreamConfig(), DefaultDownloadsStreamConfig(),
	} {
		if err = EnsureStream(serviceJS, cfg); err != nil {
			t.Fatalf("ensure %s: %v", cfg.Name, err)
		}
	}

	for _, subject := range []string{
		"WHATSAPP.events.company.connection.message",
		"WHATSAPP.workers.company.connection.launch.status",
		"$JS.API.STREAM.INFO.WHATSAPP_COMMANDS",
		"$JS.API.STREAM.INFO.WHATSAPP_DOWNLOADS",
	} {
		expectNATSPublish(t, workerURL, subject, true)
	}
	for _, subject := range []string{
		"WHATSAPP.commands",
		"WHATSAPP.commands.company.connection",
		"WHATSAPP.control.stop",
		"WHATSAPP.lifecycle.unlink",
		"WHATSAPP.rollouts.start",
		"$JS.API.STREAM.NAMES",
		"$JS.API.STREAM.INFO.WHATSAPP_EVENTS",
		"$JS.API.STREAM.INFO.WHATSAPP_DEAD_LETTERS",
		"$JS.API.CONSUMER.INFO.WHATSAPP_DOWNLOADS.unrelated-consumer",
		"$JS.API.CONSUMER.DURABLE.CREATE.WHATSAPP_COMMANDS.unrelated-consumer",
		"$JS.API.STREAM.CREATE.WHATSAPP_EVENTS",
		"$JS.API.STREAM.UPDATE.WHATSAPP_EVENTS",
		"$JS.API.STREAM.DELETE.WHATSAPP_COMMANDS",
		"$JS.API.CONSUMER.DELETE.WHATSAPP_COMMANDS.worker-permission-test",
		"$JS.API.CONSUMER.MSG.NEXT.WHATSAPP_COMMANDS.orchestrator-commands",
		"$JS.API.CONSUMER.INFO.WHATSAPP_EVENTS.whatsapp-api-events-v1",
		"$JS.API.CONSUMER.CREATE.WHATSAPP_EVENTS.whatsapp-api-events-v1",
		"$JS.API.CONSUMER.DELETE.WHATSAPP_EVENTS.whatsapp-api-events-v1",
		"$JS.API.CONSUMER.DELETE.WHATSAPP_EVENTS.unrelated-consumer",
		"unrelated.subject",
	} {
		expectNATSPublish(t, workerURL, subject, false)
	}

	for _, subject := range []string{
		"WHATSAPP.commands.company.connection",
		"WHATSAPP.download.company.connection.request",
		"_INBOX.permission.test",
	} {
		expectNATSSubscribe(t, workerURL, subject, true)
	}
	for _, subject := range []string{
		"WHATSAPP.events.>",
		"WHATSAPP.workers.>",
		"WHATSAPP.control.>",
		"unrelated.>",
	} {
		expectNATSSubscribe(t, workerURL, subject, false)
	}

	worker, err := gnats.Connect(workerURL)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	workerJS, err := worker.JetStream()
	if err != nil {
		t.Fatal(err)
	}
	privilegedConsumer := "orchestrator-commands"
	_ = serviceJS.DeleteConsumer(StreamCommands, privilegedConsumer)
	privilegedConfig := &gnats.ConsumerConfig{
		Durable: privilegedConsumer, FilterSubject: "WHATSAPP.commands.>",
		AckPolicy: gnats.AckExplicitPolicy, DeliverPolicy: gnats.DeliverAllPolicy,
		AckWait: 30 * time.Second, MaxDeliver: 5,
	}
	if _, err = serviceJS.AddConsumer(StreamCommands, privilegedConfig); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = serviceJS.DeleteConsumer(StreamCommands, privilegedConsumer) })

	if _, err = workerJS.ConsumerInfo(StreamCommands, privilegedConsumer, gnats.MaxWait(300*time.Millisecond)); err == nil {
		t.Fatal("worker read privileged orchestrator consumer configuration")
	}
	mutatedPrivileged := *privilegedConfig
	mutatedPrivileged.AckWait = time.Millisecond
	if _, err = workerJS.AddConsumer(StreamCommands, &mutatedPrivileged, gnats.MaxWait(300*time.Millisecond)); err == nil {
		t.Fatal("worker updated privileged orchestrator consumer")
	}
	if err = workerJS.DeleteConsumer(StreamCommands, privilegedConsumer, gnats.MaxWait(300*time.Millisecond)); err == nil {
		t.Fatal("worker deleted privileged orchestrator consumer")
	}
	privilegedInfo, err := serviceJS.ConsumerInfo(StreamCommands, privilegedConsumer)
	if err != nil {
		t.Fatalf("privileged consumer disappeared after worker exploit probes: %v", err)
	}
	if privilegedInfo.Config.AckWait != privilegedConfig.AckWait || privilegedInfo.Config.MaxDeliver != privilegedConfig.MaxDeliver {
		t.Fatalf("worker changed privileged consumer config: %+v", privilegedInfo.Config)
	}

	consumer := "worker-permission-test"
	_ = serviceJS.DeleteConsumer(StreamCommands, consumer)
	_, err = workerJS.AddConsumer(StreamCommands, &gnats.ConsumerConfig{
		Durable: consumer, FilterSubject: "WHATSAPP.commands.company.connection",
		AckPolicy: gnats.AckExplicitPolicy, DeliverPolicy: gnats.DeliverNewPolicy,
	})
	if err != nil {
		t.Fatalf("worker could not create its command consumer: %v", err)
	}
	t.Cleanup(func() { _ = serviceJS.DeleteConsumer(StreamCommands, consumer) })
	sub, err := workerJS.PullSubscribe(
		"WHATSAPP.commands.company.connection", consumer, gnats.BindStream(StreamCommands),
	)
	if err != nil {
		t.Fatalf("worker could not bind command consumer: %v", err)
	}
	if _, err = serviceJS.Publish("WHATSAPP.commands.company.connection", []byte("command")); err != nil {
		t.Fatal(err)
	}
	messages, err := sub.Fetch(1, gnats.MaxWait(2*time.Second))
	if err != nil || len(messages) != 1 {
		t.Fatalf("worker could not consume command: messages=%d err=%v", len(messages), err)
	}
	if err = messages[0].AckSync(); err != nil {
		t.Fatalf("worker could not ack command: %v", err)
	}
	privilegedSub, err := serviceJS.PullSubscribe(
		"WHATSAPP.commands.>", privilegedConsumer, gnats.BindStream(StreamCommands),
	)
	if err != nil {
		t.Fatal(err)
	}
	privilegedMessages, err := privilegedSub.Fetch(1, gnats.MaxWait(2*time.Second))
	if err != nil || len(privilegedMessages) != 1 {
		t.Fatalf("worker alternate consumer affected privileged delivery: messages=%d err=%v", len(privilegedMessages), err)
	}
	if err = privilegedMessages[0].AckSync(); err != nil {
		t.Fatal(err)
	}
	if _, err = workerJS.Publish("WHATSAPP.events.company.connection.message", []byte("event")); err != nil {
		t.Fatalf("worker could not publish event through JetStream: %v", err)
	}

	downloads := make(chan *gnats.Msg, 1)
	downloadSub, err := workerJS.Subscribe(
		"WHATSAPP.download.company.connection.request",
		func(message *gnats.Msg) { downloads <- message },
		gnats.BindStream(StreamDownloads), gnats.DeliverNew(), gnats.AckExplicit(),
		gnats.ManualAck(), gnats.MaxDeliver(3),
	)
	if err != nil {
		t.Fatalf("worker could not create media-download consumer: %v", err)
	}
	var downloadConsumerName string
	if _, err = serviceJS.Publish("WHATSAPP.download.company.connection.request", []byte("download")); err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-downloads:
		metadata, metadataErr := message.Metadata()
		if metadataErr != nil {
			t.Fatalf("worker could not read media-download metadata: %v", metadataErr)
		}
		downloadConsumerName = metadata.Consumer
		if err = message.AckSync(); err != nil {
			t.Fatalf("worker could not ack media download: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not receive media-download request")
	}
	if err = downloadSub.Unsubscribe(); err != nil {
		t.Fatalf("worker could not clean up its ephemeral media-download consumer: %v", err)
	}
	if _, err = serviceJS.ConsumerInfo(StreamDownloads, downloadConsumerName); err != gnats.ErrConsumerNotFound {
		t.Fatalf("media-download consumer was not deleted on unsubscribe: %v", err)
	}
}

func expectNATSPublish(t *testing.T, url, subject string, allowed bool) {
	t.Helper()
	errorsCh := make(chan error, 2)
	nc, err := gnats.Connect(url, gnats.ErrorHandler(func(_ *gnats.Conn, _ *gnats.Subscription, err error) {
		errorsCh <- err
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	if err = nc.Publish(subject, []byte("test")); err != nil && allowed {
		t.Fatalf("publish %s: %v", subject, err)
	}
	_ = nc.FlushTimeout(time.Second)
	permissionErr := awaitPermissionError(errorsCh)
	if allowed && permissionErr != nil {
		t.Fatalf("publish %s unexpectedly denied: %v", subject, permissionErr)
	}
	if !allowed && permissionErr == nil {
		t.Fatalf("publish %s unexpectedly allowed", subject)
	}
}

func expectNATSSubscribe(t *testing.T, url, subject string, allowed bool) {
	t.Helper()
	errorsCh := make(chan error, 2)
	nc, err := gnats.Connect(url, gnats.ErrorHandler(func(_ *gnats.Conn, _ *gnats.Subscription, err error) {
		errorsCh <- err
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	_, err = nc.Subscribe(subject, func(*gnats.Msg) {})
	if err != nil && allowed {
		t.Fatalf("subscribe %s: %v", subject, err)
	}
	_ = nc.FlushTimeout(time.Second)
	permissionErr := awaitPermissionError(errorsCh)
	if allowed && permissionErr != nil {
		t.Fatalf("subscribe %s unexpectedly denied: %v", subject, permissionErr)
	}
	if !allowed && permissionErr == nil {
		t.Fatalf("subscribe %s unexpectedly allowed", subject)
	}
}

func awaitPermissionError(errorsCh <-chan error) error {
	timer := time.NewTimer(200 * time.Millisecond)
	defer timer.Stop()
	for {
		select {
		case err := <-errorsCh:
			if err != nil && strings.Contains(strings.ToLower(err.Error()), "permissions violation") {
				return err
			}
		case <-timer.C:
			return nil
		}
	}
}
