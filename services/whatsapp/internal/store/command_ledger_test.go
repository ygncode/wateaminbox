package store

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func ledgerContainer(t *testing.T) (*PGContainer, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
		db.Close()
	})
	return &PGContainer{
		db:           db,
		connectionID: "11111111-1111-1111-1111-111111111111",
		log:          waLog.Noop,
	}, mock
}

// The delivery flag is what lets a redelivery be acknowledged instead of
// republishing an outcome the workspace already applied.
func TestGetProcessedCommandStateReportsDelivery(t *testing.T) {
	container, mock := ledgerContainer(t)
	mock.ExpectQuery("SELECT result, event_published FROM processed_commands").
		WithArgs(container.connectionID, "cmd-1").
		WillReturnRows(sqlmock.NewRows([]string{"result", "event_published"}).
			AddRow([]byte(`{"command_type":"group_leave"}`), true))

	result, published, found, err := container.GetProcessedCommandState(context.Background(), "cmd-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found || !published {
		t.Fatalf("expected a delivered record, got found=%v published=%v", found, published)
	}
	if string(result) != `{"command_type":"group_leave"}` {
		t.Fatalf("unexpected result: %s", result)
	}
}

func TestGetProcessedCommandStateReportsAnUndeliveredRecord(t *testing.T) {
	container, mock := ledgerContainer(t)
	mock.ExpectQuery("SELECT result, event_published FROM processed_commands").
		WithArgs(container.connectionID, "cmd-2").
		WillReturnRows(sqlmock.NewRows([]string{"result", "event_published"}).
			AddRow([]byte(`{}`), false))

	_, published, found, err := container.GetProcessedCommandState(context.Background(), "cmd-2")
	if err != nil || !found {
		t.Fatalf("expected the record, got found=%v err=%v", found, err)
	}
	if published {
		t.Fatal("an undelivered record must not report as delivered")
	}
}

func TestGetProcessedCommandStateReportsAMissingRecord(t *testing.T) {
	container, mock := ledgerContainer(t)
	mock.ExpectQuery("SELECT result, event_published FROM processed_commands").
		WithArgs(container.connectionID, "cmd-3").
		WillReturnRows(sqlmock.NewRows([]string{"result", "event_published"}))

	_, _, found, err := container.GetProcessedCommandState(context.Background(), "cmd-3")
	if err != nil {
		t.Fatalf("a missing record is not an error: %v", err)
	}
	if found {
		t.Fatal("expected no record")
	}
}

// Scrubbing empties a delivered payload while keeping the row, because the row
// is what stops a redelivery from repeating the mutation.
func TestScrubOnlyTouchesDeliveredRecords(t *testing.T) {
	container, mock := ledgerContainer(t)
	mock.ExpectExec("UPDATE processed_commands SET result").
		WithArgs(container.connectionID, "cmd-4").
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := container.ScrubProcessedCommandResult(context.Background(), "cmd-4"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// Both classes are bounded, on separate windows. An undelivered record is the
// guard that stops a redelivery repeating the mutation, so it is kept far
// longer than a delivered one whose only job is already done.
func TestPruneBoundsDeliveredAndUndeliveredSeparately(t *testing.T) {
	container, mock := ledgerContainer(t)
	mock.ExpectExec("DELETE FROM processed_commands").
		WithArgs(container.connectionID, "86400 seconds", "604800 seconds").
		WillReturnResult(sqlmock.NewResult(0, 7))

	removed, err := container.PruneProcessedCommands(
		context.Background(), 24*time.Hour, 7*24*time.Hour,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if removed != 7 {
		t.Fatalf("expected 7 pruned rows, got %d", removed)
	}
}

// The delete must key each class off its own flag; a single undifferentiated
// window would either strand delivered rows or drop undelivered guards early.
func TestPruneSeparatesTheTwoRetentionClassesInSQL(t *testing.T) {
	container, mock := ledgerContainer(t)
	mock.ExpectExec(`event_published = true AND processed_at < now\(\) - \$2`).
		WithArgs(container.connectionID, "60 seconds", "120 seconds").
		WillReturnResult(sqlmock.NewResult(0, 0))

	if _, err := container.PruneProcessedCommands(
		context.Background(), time.Minute, 2*time.Minute,
	); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
