package store

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

// The worker's PostgreSQL store must satisfy every whatsmeow store interface
// it is used for; a missing method fails here at compile time instead of in a
// worker Pod.
var _ store.ChatSettingsStore = (*PGSQLStore)(nil)

func TestPutWASARootSecretIDUpsertsPerConnectionAndChat(t *testing.T) {
	s, mock := msgSecretContainer(t)
	chat := types.JID{User: "13135550002", Server: types.BotServer}

	mock.ExpectExec("INSERT INTO whatsmeow_chat_settings").
		WithArgs(s.connectionID, s.JID, chat.String(), "3EB0ROOTSECRET").
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.PutWASARootSecretID(context.Background(), chat, "3EB0ROOTSECRET"))
}

func TestGetWASARootSecretIDReturnsStoredID(t *testing.T) {
	s, mock := msgSecretContainer(t)
	chat := types.JID{User: "13135550002", Server: types.BotServer}

	mock.ExpectQuery("SELECT wasa_root_secret_id").
		WithArgs(s.connectionID, s.JID, chat.String()).
		WillReturnRows(sqlmock.NewRows([]string{"wasa_root_secret_id"}).AddRow("3EB0ROOTSECRET"))

	id, err := s.GetWASARootSecretID(context.Background(), chat)
	require.NoError(t, err)
	require.Equal(t, types.MessageID("3EB0ROOTSECRET"), id)
}

// Upstream sqlstore treats a missing row as "no secret", not as an error;
// whatsmeow relies on that when deciding whether to distribute a new one.
func TestGetWASARootSecretIDMissingRowIsEmptyNotError(t *testing.T) {
	s, mock := msgSecretContainer(t)
	chat := types.JID{User: "13135550002", Server: types.BotServer}

	mock.ExpectQuery("SELECT wasa_root_secret_id").
		WithArgs(s.connectionID, s.JID, chat.String()).
		WillReturnError(sql.ErrNoRows)

	id, err := s.GetWASARootSecretID(context.Background(), chat)
	require.NoError(t, err)
	require.Equal(t, types.MessageID(""), id)
}
