package nats

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	natsgo "github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
	"os"
	"sync"
	"testing"
	"time"
)

type schedulerLedger struct {
	mu sync.Mutex
	memoryCommandLedger
}

func (l *schedulerLedger) BeginSendCommand(ctx context.Context, id, typ string, intent []byte) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.memoryCommandLedger.BeginSendCommand(ctx, id, typ, intent)
}
func (l *schedulerLedger) GetProcessedCommand(ctx context.Context, id string) ([]byte, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.memoryCommandLedger.GetProcessedCommand(ctx, id)
}
func (l *schedulerLedger) SaveProcessedCommand(ctx context.Context, id, typ string, result []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.memoryCommandLedger.SaveProcessedCommand(ctx, id, typ, result)
}
func (l *schedulerLedger) MarkCommandEventPublished(ctx context.Context, id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.memoryCommandLedger.MarkCommandEventPublished(ctx, id)
}

type gatedMediaStore struct {
	started chan struct{}
	release chan struct{}
}

func (s *gatedMediaStore) DownloadMediaObject(ctx context.Context, _ string, _ int64, _ string) ([]byte, error) {
	close(s.started)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.release:
		return []byte{1}, nil
	}
}

func TestSchedulerSendsOtherContactWhileMediaPrepares(t *testing.T) {
	url := os.Getenv("TEST_NATS_URL")
	if url == "" {
		t.Skip("set TEST_NATS_URL to an isolated JetStream server")
	}
	nc, err := natsgo.Connect(url)
	require.NoError(t, err)
	defer nc.Close()
	js, err := nc.JetStream()
	require.NoError(t, err)
	if _, err := js.StreamInfo(CommandsStreamName); err != nil {
		_, err = js.AddStream(&natsgo.StreamConfig{Name: CommandsStreamName, Subjects: []string{"WHATSAPP.commands.>"}})
		require.NoError(t, err)
	}
	company, connection := uuid.NewString(), uuid.NewString()
	store := &gatedMediaStore{started: make(chan struct{}), release: make(chan struct{})}
	sent := make(chan string, 4)
	sender := &mockMessageSender{
		sendMessageFunc: func(_ context.Context, to, text, _, _ string, _ []string) (types.SendResponse, error) {
			sent <- to + ":" + text
			return types.SendResponse{ID: uuid.NewString()}, nil
		},
		sendMediaMessageFunc: func(_ context.Context, to, _ string, _ []byte, _, _, _, _, _ string) (types.SendResponse, error) {
			sent <- to + ":media"
			return types.SendResponse{ID: uuid.NewString()}, nil
		},
	}
	ledger := &schedulerLedger{memoryCommandLedger: memoryCommandLedger{results: map[string][]byte{}}}
	sub, err := NewSubscriber(SubscriberConfig{NATSURL: url, CompanyID: company, ConnectionID: connection, Sender: sender, Storage: store, Ledger: ledger, Publisher: &recordingCommandPublisher{}})
	require.NoError(t, err)
	require.NoError(t, sub.Start())
	defer sub.Stop()
	subject := "WHATSAPP.commands." + company + "." + connection
	publish := func(cmd SendMessageCommand) {
		cmd.CommandID = uuid.NewString()
		data, err := json.Marshal(cmd)
		require.NoError(t, err)
		_, err = js.Publish(subject, data)
		require.NoError(t, err)
	}
	publish(SendMessageCommand{Type: "document", To: "a", MediaObjectKey: "media/" + company + "/document", MediaSize: 1})
	select {
	case <-store.started:
	case <-time.After(3 * time.Second):
		t.Fatal("media preparation did not start")
	}
	publish(SendMessageCommand{Type: "text", To: "a", Content: "after media"})
	publish(SendMessageCommand{Type: "text", To: "b", Content: "ready"})
	select {
	case value := <-sent:
		require.Equal(t, "b:ready", value)
	case <-time.After(3 * time.Second):
		t.Fatal("unrelated contact was blocked by media")
	}
	close(store.release)
	for _, expected := range []string{"a:media", "a:after media"} {
		select {
		case value := <-sent:
			require.Equal(t, expected, value)
		case <-time.After(3 * time.Second):
			t.Fatal("contact queue did not drain")
		}
	}
}

type boundedMediaStore struct {
	started chan struct{}
	release chan struct{}
}

func (s *boundedMediaStore) DownloadMediaObject(ctx context.Context, _ string, _ int64, _ string) ([]byte, error) {
	s.started <- struct{}{}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.release:
		return []byte{1}, nil
	}
}

func TestSchedulerBoundsMediaPreparationAndStillSendsText(t *testing.T) {
	url := os.Getenv("TEST_NATS_URL")
	if url == "" {
		t.Skip("set TEST_NATS_URL")
	}
	nc, err := natsgo.Connect(url)
	require.NoError(t, err)
	defer nc.Close()
	js, err := nc.JetStream()
	require.NoError(t, err)
	if _, err = js.StreamInfo(CommandsStreamName); err != nil {
		_, err = js.AddStream(&natsgo.StreamConfig{Name: CommandsStreamName, Subjects: []string{"WHATSAPP.commands.>"}})
		require.NoError(t, err)
	}
	company, connection := uuid.NewString(), uuid.NewString()
	media := &boundedMediaStore{started: make(chan struct{}, 8), release: make(chan struct{})}
	sent := make(chan string, 8)
	sender := &mockMessageSender{
		sendMessageFunc: func(context.Context, string, string, string, string, []string) (types.SendResponse, error) {
			sent <- "text"
			return types.SendResponse{ID: uuid.NewString()}, nil
		},
		sendMediaMessageFunc: func(context.Context, string, string, []byte, string, string, string, string, string) (types.SendResponse, error) {
			sent <- "media"
			return types.SendResponse{ID: uuid.NewString()}, nil
		},
	}
	sub, err := NewSubscriber(SubscriberConfig{NATSURL: url, CompanyID: company, ConnectionID: connection, Sender: sender, Storage: media, Ledger: &schedulerLedger{memoryCommandLedger: memoryCommandLedger{results: map[string][]byte{}}}, Publisher: &recordingCommandPublisher{}})
	require.NoError(t, err)
	require.NoError(t, sub.Start())
	defer sub.Stop()
	publish := func(cmd SendMessageCommand) {
		cmd.CommandID = uuid.NewString()
		data, err := json.Marshal(cmd)
		require.NoError(t, err)
		_, err = js.Publish("WHATSAPP.commands."+company+"."+connection, data)
		require.NoError(t, err)
	}
	for i := 0; i < 5; i++ {
		publish(SendMessageCommand{Type: "document", To: uuid.NewString(), MediaObjectKey: "media/" + company + "/document", MediaSize: 1})
	}
	for i := 0; i < mediaPreparationLimit; i++ {
		select {
		case <-media.started:
		case <-time.After(3 * time.Second):
			t.Fatal("preparation did not start")
		}
	}
	publish(SendMessageCommand{Type: "text", To: "ready-contact"})
	select {
	case value := <-sent:
		require.Equal(t, "text", value)
	case <-time.After(3 * time.Second):
		t.Fatal("media preparation blocked text")
	}
	select {
	case <-media.started:
		t.Fatal("more than two media buffers preparing/ready")
	case <-time.After(30 * time.Millisecond):
	}
	close(media.release)
	for i := 0; i < 5; i++ {
		select {
		case value := <-sent:
			require.Equal(t, "media", value)
		case <-time.After(3 * time.Second):
			t.Fatal("media queue did not drain")
		}
	}
}
