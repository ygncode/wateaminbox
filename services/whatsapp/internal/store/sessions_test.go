package store

import (
	"bytes"
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestGetManySessionsIncludesMissingAddresses(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	const (
		connectionID = "cbfae2af-19f7-4101-a401-197cce398ac5"
		ourJID       = "959428203611:47@s.whatsapp.net"
	)
	addresses := []string{
		"190288643534904_1:0",
		"190288643534904_1:17",
		"190288643534904_1:20",
	}
	storedSession := []byte("stored-signal-session")

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT their_id, session FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = ANY($3)`)).
		WithArgs(connectionID, ourJID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"their_id", "session"}).
			AddRow(addresses[1], storedSession))

	store := &PGSQLStore{
		PGContainer: &PGContainer{db: db, connectionID: connectionID},
		JID:         ourJID,
	}
	result, err := store.GetManySessions(context.Background(), addresses)
	if err != nil {
		t.Fatal(err)
	}

	if len(result) != len(addresses) {
		t.Fatalf("expected %d session results, got %d", len(addresses), len(result))
	}
	for _, address := range []string{addresses[0], addresses[2]} {
		session, exists := result[address]
		if !exists {
			t.Fatalf("missing address %s must be returned so whatsmeow fetches its pre-key", address)
		}
		if session != nil {
			t.Fatalf("expected missing address %s to have a nil session", address)
		}
	}
	if !bytes.Equal(result[addresses[1]], storedSession) {
		t.Fatalf("stored session was not returned unchanged")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetManySessionsWithNoAddressesSkipsDatabase(t *testing.T) {
	store := &PGSQLStore{}
	result, err := store.GetManySessions(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if result != nil {
		t.Fatalf("expected nil result for an empty address list")
	}
}
