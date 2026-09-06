package nats

import (
	"context"
	"encoding/json"
	"errors"
	natsgo "github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
	"sync/atomic"
	"testing"
	"time"
)

type uncertainPublisher struct {
	recordingCommandPublisher
	unknown   int
	messageID string
}

func (p *uncertainPublisher) PublishSendUncertain(_, id, _ string) error {
	p.unknown++
	p.messageID = id
	return nil
}

func TestUncertainSendIsNeverRetriedAndKeepsDurableIdentity(t *testing.T) {
	ledger := &memoryCommandLedger{results: map[string][]byte{}}
	publisher := &uncertainPublisher{}
	calls := 0
	sender := &mockMessageSender{sendMessageFunc: func(ctx context.Context, _, _, _, _ string, _ []string) (types.SendResponse, error) {
		calls++
		op := types.SendOperationFromContext(ctx)
		require.NotEmpty(t, op.ID)
		require.NoError(t, op.BeforeSend(ctx))
		var intent storedCommandResult
		require.NoError(t, json.Unmarshal(ledger.results["send-1"], &intent))
		require.True(t, intent.InFlight)
		require.Equal(t, op.ID, intent.WhatsAppMessageID)
		return types.SendResponse{}, &types.UnknownSendOutcome{Err: context.DeadlineExceeded}
	}}
	subscriber := &Subscriber{ctx: context.Background(), companyID: "company", connectionID: "session", ledger: ledger, publisher: publisher, sender: sender}
	payload := []byte(`{"type":"text","command_id":"send-1","message_id":"pending-1","to":"a@s.whatsapp.net"}`)
	subscriber.handleSendCommand(&natsgo.Msg{Data: payload})
	subscriber.handleSendCommand(&natsgo.Msg{Data: payload})
	require.Equal(t, 1, calls)
	require.Equal(t, 2, publisher.unknown)
	require.Equal(t, types.CommandMessageID("company", "session", "send-1"), publisher.messageID)
}

func TestCrashAfterIntentReportsUncertaintyWithoutTransport(t *testing.T) {
	intent, err := json.Marshal(storedCommandResult{InFlight: true, PendingMessageID: "pending-1", WhatsAppMessageID: "stable-id", CommandType: "text"})
	require.NoError(t, err)
	ledger := &memoryCommandLedger{results: map[string][]byte{"send-1": intent}}
	publisher := &uncertainPublisher{}
	sender := &mockMessageSender{sendMessageFunc: func(context.Context, string, string, string, string, []string) (types.SendResponse, error) {
		t.Fatal("must not resend")
		return types.SendResponse{}, nil
	}}
	subscriber := &Subscriber{ctx: context.Background(), ledger: ledger, publisher: publisher, sender: sender}
	subscriber.handleSendCommand(&natsgo.Msg{Data: []byte(`{"type":"text","command_id":"send-1","to":"a@s.whatsapp.net"}`)})
	require.Equal(t, 1, publisher.unknown)
}

func TestTransportDeliveryCountDoesNotExhaustPreparationAttempts(t *testing.T) {
	calls := 0
	sender := &mockMessageSender{sendMessageFunc: func(context.Context, string, string, string, string, []string) (types.SendResponse, error) {
		calls++
		if calls == 1 {
			return types.SendResponse{}, errors.New("preparation temporarily unavailable")
		}
		return types.SendResponse{ID: "real-id"}, nil
	}}
	subscriber := &Subscriber{ctx: context.Background(), ledger: &memoryCommandLedger{results: map[string][]byte{}}, publisher: &recordingCommandPublisher{}, sender: sender}
	subscriber.handleSendCommand(deliveredMsg(`{"type":"text","command_id":"send-1","to":"a@s.whatsapp.net"}`, 10))
	require.Equal(t, 2, calls)
}

func TestCommandHeartbeatCoversWaitAndStops(t *testing.T) {
	var calls atomic.Int64
	stop := keepCommandAlive(context.Background(), 2*time.Millisecond, func() error { calls.Add(1); return nil })
	require.Eventually(t, func() bool { return calls.Load() >= 3 }, time.Second, time.Millisecond)
	stop()
	count := calls.Load()
	time.Sleep(10 * time.Millisecond)
	require.Equal(t, count, calls.Load())
	stop()
}

func TestStableSendIdentityIsScopedAndRepeatable(t *testing.T) {
	id := types.CommandMessageID("company", "session", "command")
	require.Equal(t, id, types.CommandMessageID("company", "session", "command"))
	require.NotEqual(t, id, types.CommandMessageID("other", "session", "command"))
	require.NotEqual(t, id, types.CommandMessageID("company", "other", "command"))
}
