package store

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestResetAppStateClearsMutationMACsAndVersionAtomically(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	const jid = "15551234567:2@s.whatsapp.net"
	store := &PGSQLStore{
		PGContainer: &PGContainer{
			db:           db,
			connectionID: "8100e5a0-08d9-479a-b046-99a3aa28275e",
		},
		JID: jid,
	}

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM whatsmeow_app_state_mutation_macs`).
		WithArgs(store.connectionID, jid, "regular").
		WillReturnResult(sqlmock.NewResult(0, 11))
	mock.ExpectExec(`DELETE FROM whatsmeow_app_state_version`).
		WithArgs(store.connectionID, jid, "regular").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, store.ResetAppState(context.Background(), "regular"))
	require.NoError(t, mock.ExpectationsWereMet())
}
