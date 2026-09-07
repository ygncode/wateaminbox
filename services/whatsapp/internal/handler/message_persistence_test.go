package handler

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestLiveMessageAcknowledgementRequiresPersistence(t *testing.T) {
	attempts := 0
	h := New(Config{})
	h.publishMessage = func(event natsClient.MessageEvent) error {
		attempts++
		require.Equal(t, "hello", event.Content)
		if attempts == 1 {
			return errors.New("database unavailable")
		}
		return nil
	}
	msg := &events.Message{
		Info: types.MessageInfo{ID: "incoming-1", MessageSource: types.MessageSource{
			Sender: types.NewJID("123", types.DefaultUserServer), Chat: types.NewJID("123", types.DefaultUserServer),
		}},
		Message: &waE2E.Message{Conversation: proto.String("hello")},
	}
	require.False(t, h.HandleEventWithSuccessStatus(msg))
	require.True(t, h.HandleEventWithSuccessStatus(msg))
	require.Equal(t, 2, attempts)
}
