package store

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

// TestMessageSecretKeyingRoundTrip reproduces the device-number JID keying
// mismatch against the production whatsmeow_message_secrets table and primary
// key. whatsmeow's FromMe-sync put path (storeMessageSecret) hands the store an
// info.Sender that carries a device number (e.g. 12345:7@s.whatsapp.net), while
// the decrypt-side DM branch resolves the original sender via a device-less
// ParseJID(key.GetRemoteJID()) (e.g. 12345@s.whatsapp.net). Upstream's SQLStore
// collapses both sides with ToNonAD(); this store must do the same or the
// SELECT ... WHERE sender_jid = ... misses and the caller raises
// ErrOriginalMessageSecretNotFound.
//
// Pre-fix: the stored sender_jid kept the device and the device-less get
// returned no row. Post-fix: both sides normalize and the round trip hits.
//
// Requires a migrated local Postgres with the wateaminbox_worker_runtime role
// and the whatsapp_sessions schema (see decryption_integration_test.go).
func TestMessageSecretKeyingRoundTrip(t *testing.T) {
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

	s := &PGSQLStore{
		PGContainer: &PGContainer{db: conn, connectionID: uuid.NewString()},
		JID:         "own@s.whatsapp.net",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	defer conn.Exec("DELETE FROM whatsmeow_message_secrets WHERE connection_id=$1", s.connectionID)

	// Put side: pass device-bearing JIDs for both chat and sender, mirroring the
	// FromMe-sync writer. Both edges are exercised even though the real DM flow
	// only carries a device on the sender; the fix must strip the device from
	// every keying column to match upstream's ToNonAD() semantics.
	chat := types.JID{User: "67890", Device: 3, Server: types.DefaultUserServer}
	sender := types.JID{User: "12345", Device: 7, Server: types.DefaultUserServer}
	const msgID = "msg-1"
	secret := []byte("poll-secret")
	require.NoError(t, s.PutMessageSecret(ctx, chat, sender, msgID, secret))

	// The persisted keying columns must be device-less. Pre-fix these held
	// "67890:3@s.whatsapp.net" / "12345:7@s.whatsapp.net" and the read below
	// missed.
	var storedChat, storedSender string
	require.NoError(t, conn.QueryRowContext(ctx, `
		SELECT chat_jid, sender_jid FROM whatsmeow_message_secrets
		WHERE connection_id = $1 AND our_jid = $2 AND message_id = $3
	`, s.connectionID, s.JID, msgID).Scan(&storedChat, &storedSender))
	require.Equal(t, "67890@s.whatsapp.net", storedChat, "chat_jid must be device-less so a device-stripping reader still hits")
	require.Equal(t, "12345@s.whatsapp.net", storedSender, "sender_jid must be device-less to match upstream SQLStore keying")

	// Read side: the DM branch of getOrigSenderFromKey passes device-less JIDs.
	// Pre-fix this returned (nil, EmptyJID, nil); post-fix it returns the secret.
	devicelessChat := types.JID{User: "67890", Server: types.DefaultUserServer}
	devicelessSender := types.JID{User: "12345", Server: types.DefaultUserServer}
	gotSecret, gotSender, err := s.GetMessageSecret(ctx, devicelessChat, devicelessSender, msgID)
	require.NoError(t, err)
	require.Equal(t, secret, gotSecret)
	require.Equal(t, "12345@s.whatsapp.net", gotSender.String())

	// The device-bearing JIDs used at put time must also resolve the row, because
	// the key is now device-less on both read and write: NodeToAD() collapses both
	// sides of the round trip to the same key regardless of which device carried.
	gotSecretAgain, _, err := s.GetMessageSecret(ctx, chat, sender, msgID)
	require.NoError(t, err)
	require.Equal(t, secret, gotSecretAgain)

	// The batch put path used by history sync must normalize identically. A
	// device-bearing batch insert must be readable through device-less JIDs.
	batchChat := types.JID{User: "67890", Device: 4, Server: types.DefaultUserServer}
	batchSender := types.JID{User: "12345", Device: 9, Server: types.DefaultUserServer}
	const batchMsgID = "msg-2"
	batchSecret := []byte("batch-secret")
	require.NoError(t, s.PutMessageSecrets(ctx, []store.MessageSecretInsert{
		{Chat: batchChat, Sender: batchSender, ID: batchMsgID, Secret: batchSecret},
	}))
	gotBatchSecret, _, err := s.GetMessageSecret(ctx, devicelessChat, devicelessSender, batchMsgID)
	require.NoError(t, err)
	require.Equal(t, batchSecret, gotBatchSecret)
}
