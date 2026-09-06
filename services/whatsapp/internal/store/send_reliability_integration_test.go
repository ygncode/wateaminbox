package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
	"net/url"
	"os"
	"testing"
)

func TestDurableIntentAndHistoryRetentionWithPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a migrated disposable database")
	}
	parsed, err := url.Parse(dsn)
	require.NoError(t, err)
	q := parsed.Query()
	q.Set("search_path", "whatsapp_sessions")
	parsed.RawQuery = q.Encode()
	conn, err := sql.Open("postgres", parsed.String())
	require.NoError(t, err)
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	_, err = conn.Exec("SET ROLE wateaminbox_worker_runtime")
	require.NoError(t, err)
	container := &PGContainer{db: conn, connectionID: uuid.NewString()}
	ctx := context.Background()
	defer conn.Exec("DELETE FROM processed_commands WHERE connection_id=$1", container.connectionID)
	defer conn.Exec("DELETE FROM worker_event_outbox WHERE connection_id=$1", container.connectionID)
	command := uuid.NewString()
	claimed, err := container.BeginSendCommand(ctx, command, "text", []byte(`{"in_flight":true,"whatsapp_message_id":"stable"}`))
	require.NoError(t, err)
	require.True(t, claimed)
	claimed, err = container.BeginSendCommand(ctx, command, "text", []byte(`{"in_flight":true}`))
	require.NoError(t, err)
	require.False(t, claimed)
	require.NoError(t, container.SaveProcessedCommand(ctx, command, "text", []byte(`{"response":{"ID":"stable"}}`)))
	// Terminal success must not be replaced by a stale failure or another intent.
	require.NoError(t, container.SaveProcessedCommand(ctx, command, "text", []byte(`{"failed":true}`)))
	result, found, err := container.GetProcessedCommand(ctx, command)
	require.NoError(t, err)
	require.True(t, found)
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(result, &decoded))
	require.Contains(t, decoded, "response")
	historyID := uuid.NewString()
	history := natsClient.PendingEvent{ID: historyID, Subject: "WHATSAPP.events.company." + container.connectionID + ".history_message", Payload: []byte(`{"eventId":"` + historyID + `"}`)}
	require.NoError(t, container.SavePendingEvent(ctx, history))
	require.NoError(t, container.MarkEventPublished(ctx, historyID))
	pending, err := container.ListPendingEvents(ctx, 100)
	require.NoError(t, err)
	require.Empty(t, pending)
	var count int
	require.NoError(t, conn.QueryRow("SELECT count(*) FROM worker_event_outbox WHERE connection_id=$1", container.connectionID).Scan(&count))
	require.Equal(t, 1, count)
	// A legacy worker event lacks an API receipt identity and must keep its old
	// broker-delivery retention, otherwise rolling upgrades strand old records.
	legacyID := uuid.NewString()
	require.NoError(t, container.SavePendingEvent(ctx, natsClient.PendingEvent{ID: legacyID, Subject: history.Subject, Payload: []byte(`{}`)}))
	require.NoError(t, container.MarkEventPublished(ctx, legacyID))
	require.NoError(t, conn.QueryRow("SELECT count(*) FROM worker_event_outbox WHERE connection_id=$1", container.connectionID).Scan(&count))
	require.Equal(t, 1, count)
}
