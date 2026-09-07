package store

import (
	"context"
	"database/sql"
)

type decryptionTransactionKey struct{}
type decryptionTransaction struct {
	owner *PGContainer
	tx    *sql.Tx
}
type decryptionQueryExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *PGSQLStore) decryptionExecutor(ctx context.Context) decryptionQueryExecutor {
	if tx, ok := ctx.Value(decryptionTransactionKey{}).(decryptionTransaction); ok && tx.owner == s.PGContainer {
		return tx.tx
	}
	return s.db
}
