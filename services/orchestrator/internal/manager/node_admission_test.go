package manager

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNewConnectionAdmission(t *testing.T) {
	for _, tc := range []struct {
		name                           string
		existing, allowed, unavailable bool
	}{
		{name: "new denied"}, {name: "new allowed", allowed: true},
		{name: "new unavailable", unavailable: true},
		{name: "existing bypasses unavailable admission", existing: true, unavailable: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer db.Close()
			r := &WorkerRegistry{db: db, nodeID: "node", newConnectionAdmission: true}
			mock.ExpectBegin()
			mock.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(fleetCapacityAdvisoryLockID).WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("SELECT EXISTS").WithArgs("connection").WillReturnRows(sqlmock.NewRows([]string{"exists", "count"}).AddRow(tc.existing, 1))
			if !tc.existing {
				q := mock.ExpectQuery("SELECT accepting_new").WithArgs("node")
				if tc.unavailable {
					q.WillReturnError(errors.New("unavailable"))
				} else {
					q.WillReturnRows(sqlmock.NewRows([]string{"allowed"}).AddRow(tc.allowed))
				}
			}
			admitted := tc.existing || (tc.allowed && !tc.unavailable)
			if admitted {
				mock.ExpectQuery("INSERT INTO worker_registry").WillReturnRows(sqlmock.NewRows([]string{"worker_uid", "worker_gid"}).AddRow(100123, 100123))
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			err = r.ClaimWorkerLaunch(context.Background(), &WorkerProcess{ConnectionID: "connection"}, "")
			if admitted {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
