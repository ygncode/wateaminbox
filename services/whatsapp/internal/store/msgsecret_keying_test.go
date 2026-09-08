package store

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// msgSecretContainer builds a PGSQLStore backed by sqlmock for the message
// secret keying tests. All expectations must be met before the test ends.
func msgSecretContainer(t *testing.T) (*PGSQLStore, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
		_ = db.Close()
	})
	s := &PGSQLStore{
		PGContainer: &PGContainer{
			db:           db,
			connectionID: "11111111-1111-1111-1111-111111111111",
			log:          waLog.Noop,
		},
		JID: "9999999999@s.whatsapp.net",
	}
	return s, mock
}

// deviceJID returns a JID that carries a device number, the shape whatsmeow's
// FromMe-sync path hands the store (e.g. "12345:7@s.whatsapp.net").
func deviceJID(user string, device uint16) types.JID {
	return types.JID{User: user, Device: device, Server: types.DefaultUserServer}
}

// PutMessageSecret must key rows on the device-less JID so that a secret
// stored for a device-bearing sender (e.g. 12345:7@s.whatsapp.net) is still
// reachable by a device-less reader (e.g. 12345@s.whatsapp.net). whatsmeow's
// built-in SQLStore applies ToNonAD() on both put and get; this re-implementation
// must match it.
func TestPutMessageSecretStripsDeviceFromChatAndSenderJIDs(t *testing.T) {
	s, mock := msgSecretContainer(t)
	chat := deviceJID("12025550010", 3)
	sender := deviceJID("12025550011", 7)
	secret := []byte("secret")

	mock.ExpectExec("INSERT INTO whatsmeow_message_secrets").
		WithArgs(
			s.connectionID,
			s.JID,
			"12025550010@s.whatsapp.net",
			"12025550011@s.whatsapp.net",
			"msg-1",
			secret,
		).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.PutMessageSecret(context.Background(), chat, sender, "msg-1", secret))
}

// The batch path must normalize exactly like the single-row path, otherwise a
// history-sync batch keyed by device-bearing senders stranding the same way.
func TestPutMessageSecretsBatchStripsDeviceFromChatAndSenderJIDs(t *testing.T) {
	s, mock := msgSecretContainer(t)
	chat := deviceJID("12025550010", 3)
	sender := deviceJID("12025550011", 7)
	secret := []byte("secret")
	inserts := []store.MessageSecretInsert{
		{Chat: chat, Sender: sender, ID: "msg-1", Secret: secret},
	}

	mock.ExpectBegin()
	mock.ExpectPrepare("INSERT INTO whatsmeow_message_secrets")
	mock.ExpectExec("INSERT INTO whatsmeow_message_secrets").
		WithArgs(
			s.connectionID,
			s.JID,
			"12025550010@s.whatsapp.net",
			"12025550011@s.whatsapp.net",
			"msg-1",
			secret,
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	require.NoError(t, s.PutMessageSecrets(context.Background(), inserts))
}

// GetMessageSecret must query with the device-less JID, matching the row written
// by the (now normalized) put path regardless of which side carried a device.
func TestGetMessageSecretStripsDeviceFromChatAndSenderJIDs(t *testing.T) {
	s, mock := msgSecretContainer(t)
	chat := deviceJID("12025550010", 3)
	sender := deviceJID("12025550011", 7)
	secret := []byte("secret")
	storedSender := "12025550011@s.whatsapp.net"

	mock.ExpectQuery("SELECT secret, sender_jid FROM whatsmeow_message_secrets").
		WithArgs(
			s.connectionID,
			s.JID,
			"12025550010@s.whatsapp.net",
			"12025550011@s.whatsapp.net",
			"msg-1",
		).
		WillReturnRows(sqlmock.NewRows([]string{"secret", "sender_jid"}).
			AddRow(secret, storedSender))

	gotSecret, gotSender, err := s.GetMessageSecret(context.Background(), chat, sender, "msg-1")
	require.NoError(t, err)
	require.Equal(t, secret, gotSecret)
	require.Equal(t, "12025550011@s.whatsapp.net", gotSender.String())
}
