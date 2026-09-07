package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestDecryptionRatchetRollsBackWhenReplayBufferFails(t *testing.T) {
	conn, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer conn.Close()
	s := &PGSQLStore{PGContainer: &PGContainer{db: conn, connectionID: "session"}, JID: "ours"}
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO whatsmeow_sessions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO whatsmeow_event_buffer").WillReturnError(errors.New("storage failed"))
	mock.ExpectRollback()
	err = s.DoDecryptionTxn(context.Background(), func(ctx context.Context) error {
		require.NoError(t, s.PutSession(ctx, "sender", []byte("advanced ratchet")))
		return s.PutBufferedEvent(ctx, [32]byte{}, []byte("plaintext"), time.Now())
	})
	require.ErrorContains(t, err, "storage failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDecryptionCommitsRatchetAndReplayBufferTogether(t *testing.T) {
	conn, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer conn.Close()
	s := &PGSQLStore{PGContainer: &PGContainer{db: conn, connectionID: "session"}, JID: "ours"}
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO whatsmeow_sessions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO whatsmeow_event_buffer").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	require.NoError(t, s.DoDecryptionTxn(context.Background(), func(ctx context.Context) error {
		require.NoError(t, s.PutSession(ctx, "sender", []byte("advanced ratchet")))
		return s.PutBufferedEvent(ctx, [32]byte{}, []byte("plaintext"), time.Now())
	}))
	require.NoError(t, mock.ExpectationsWereMet())
}
