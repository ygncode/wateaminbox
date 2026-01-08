package store

import (
	"context"
	"database/sql"
	"encoding/hex"

	"github.com/lib/pq"
	"go.mau.fi/whatsmeow/store"
)

// ===============================
// AppStateStore Implementation
// ===============================

// PutAppStateVersion stores the app state version.
func (s *PGSQLStore) PutAppStateVersion(ctx context.Context, name string, version uint64, hash [128]byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_app_state_version (connection_id, jid, name, version, hash)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (connection_id, jid, name) DO UPDATE SET
			version = EXCLUDED.version,
			hash = EXCLUDED.hash
	`, s.connectionID, s.JID, name, version, hash[:])
	return err
}

// GetAppStateVersion retrieves the app state version.
func (s *PGSQLStore) GetAppStateVersion(ctx context.Context, name string) (uint64, [128]byte, error) {
	var version uint64
	var hashBytes []byte
	var hash [128]byte

	err := s.db.QueryRowContext(ctx, `
		SELECT version, hash FROM whatsmeow_app_state_version
		WHERE connection_id = $1 AND jid = $2 AND name = $3
	`, s.connectionID, s.JID, name).Scan(&version, &hashBytes)

	if err == sql.ErrNoRows {
		return 0, hash, nil
	}
	if err != nil {
		return 0, hash, err
	}

	if len(hashBytes) == 128 {
		copy(hash[:], hashBytes)
	}
	return version, hash, nil
}

// DeleteAppStateVersion deletes the app state version.
func (s *PGSQLStore) DeleteAppStateVersion(ctx context.Context, name string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_app_state_version
		WHERE connection_id = $1 AND jid = $2 AND name = $3
	`, s.connectionID, s.JID, name)
	return err
}

// PutAppStateMutationMACs stores mutation MACs.
func (s *PGSQLStore) PutAppStateMutationMACs(ctx context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	if len(mutations) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_app_state_mutation_macs (connection_id, jid, name, version, index_mac, value_mac)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (connection_id, jid, name, version, index_mac) DO UPDATE SET value_mac = EXCLUDED.value_mac
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, mutation := range mutations {
		if _, err := stmt.ExecContext(ctx, s.connectionID, s.JID, name, version, mutation.IndexMAC, mutation.ValueMAC); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// DeleteAppStateMutationMACs deletes mutation MACs.
func (s *PGSQLStore) DeleteAppStateMutationMACs(ctx context.Context, name string, indexMACs [][]byte) error {
	if len(indexMACs) == 0 {
		return nil
	}

	// Convert to hex strings for the query
	hexMACs := make([]string, len(indexMACs))
	for i, mac := range indexMACs {
		hexMACs[i] = hex.EncodeToString(mac)
	}

	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_app_state_mutation_macs
		WHERE connection_id = $1 AND jid = $2 AND name = $3 AND encode(index_mac, 'hex') = ANY($4)
	`, s.connectionID, s.JID, name, pq.Array(hexMACs))
	return err
}

// GetAppStateMutationMAC retrieves a mutation MAC.
func (s *PGSQLStore) GetAppStateMutationMAC(ctx context.Context, name string, indexMAC []byte) ([]byte, error) {
	var valueMAC []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT value_mac FROM whatsmeow_app_state_mutation_macs
		WHERE connection_id = $1 AND jid = $2 AND name = $3 AND index_mac = $4
		ORDER BY version DESC LIMIT 1
	`, s.connectionID, s.JID, name, indexMAC).Scan(&valueMAC)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return valueMAC, err
}
