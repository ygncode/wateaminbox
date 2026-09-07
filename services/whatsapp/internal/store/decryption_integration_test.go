package store

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestDecryptionTransactionWithPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable local database")
	}
	parsed, err := url.Parse(dsn)
	require.NoError(t, err)
	require.Contains(t, []string{"localhost", "127.0.0.1"}, parsed.Hostname())
	q := parsed.Query()
	q.Set("search_path", "whatsapp_sessions")
	parsed.RawQuery = q.Encode()
	conn, err := sql.Open("postgres", parsed.String())
	require.NoError(t, err)
	defer conn.Close()
	conn.SetMaxOpenConns(1) // Any accidental use of the pool inside the transaction times out.
	_, err = conn.Exec("SET ROLE wateaminbox_worker_runtime")
	require.NoError(t, err)
	s := &PGSQLStore{PGContainer: &PGContainer{db: conn, connectionID: uuid.NewString()}, JID: "test@local"}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	defer conn.Exec("DELETE FROM whatsmeow_event_buffer WHERE connection_id=$1", s.connectionID)
	defer conn.Exec("DELETE FROM whatsmeow_sessions WHERE connection_id=$1", s.connectionID)
	hash := [32]byte{1}
	write := func(ctx context.Context) error {
		if err := s.PutSession(ctx, "sender", []byte("ratchet")); err != nil {
			return err
		}
		return s.PutBufferedEvent(ctx, hash, []byte("plaintext"), time.Now())
	}
	require.Error(t, s.DoDecryptionTxn(ctx, func(ctx context.Context) error {
		if err := write(ctx); err != nil {
			return err
		}
		return errors.New("crash before commit")
	}))
	session, err := s.GetSession(ctx, "sender")
	require.NoError(t, err)
	require.Empty(t, session)
	buffered, err := s.GetBufferedEvent(ctx, hash)
	require.NoError(t, err)
	require.Nil(t, buffered)
	require.NoError(t, s.DoDecryptionTxn(ctx, write))
	session, err = s.GetSession(ctx, "sender")
	require.NoError(t, err)
	require.Equal(t, []byte("ratchet"), session)
	buffered, err = s.GetBufferedEvent(ctx, hash)
	require.NoError(t, err)
	require.Equal(t, []byte("plaintext"), buffered.Plaintext)
	// Housekeeping must retain unprocessed plaintext even when it is old.
	_, err = conn.Exec("UPDATE whatsmeow_event_buffer SET insert_timestamp=$1 WHERE connection_id=$2", time.Now().Add(-15*24*time.Hour).UnixMilli(), s.connectionID)
	require.NoError(t, err)
	require.NoError(t, s.DeleteOldBufferedHashes(ctx))
	buffered, err = s.GetBufferedEvent(ctx, hash)
	require.NoError(t, err)
	require.NotNil(t, buffered)
	require.NoError(t, s.ClearBufferedEventPlaintext(ctx, hash))
	require.NoError(t, s.DeleteOldBufferedHashes(ctx))
	buffered, err = s.GetBufferedEvent(ctx, hash)
	require.NoError(t, err)
	require.Nil(t, buffered)

}
