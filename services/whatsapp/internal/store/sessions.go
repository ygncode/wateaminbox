package store

import (
	"context"
	"database/sql"

	"github.com/lib/pq"
	"go.mau.fi/whatsmeow/types"
)

// ===============================
// IdentityStore Implementation
// ===============================

// PutIdentity stores an identity key.
func (s *PGSQLStore) PutIdentity(ctx context.Context, address string, key [32]byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_identity_keys (connection_id, our_jid, their_id, identity)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET identity = EXCLUDED.identity
	`, s.connectionID, s.JID, address, key[:])
	return err
}

// IsTrustedIdentity checks if an identity key is trusted.
func (s *PGSQLStore) IsTrustedIdentity(ctx context.Context, address string, key [32]byte) (bool, error) {
	var storedKey []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT identity FROM whatsmeow_identity_keys
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address).Scan(&storedKey)

	if err == sql.ErrNoRows {
		// No identity stored, trust this one
		return true, nil
	}
	if err != nil {
		return false, err
	}

	// Compare stored key with provided key
	if len(storedKey) != 32 {
		return true, nil
	}

	var stored [32]byte
	copy(stored[:], storedKey)
	return stored == key, nil
}

// DeleteIdentity removes an identity.
func (s *PGSQLStore) DeleteIdentity(ctx context.Context, address string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_identity_keys
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address)
	return err
}

// DeleteAllIdentities removes all identities for a phone.
func (s *PGSQLStore) DeleteAllIdentities(ctx context.Context, phone string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_identity_keys
		WHERE connection_id = $1 AND our_jid = $2 AND their_id LIKE $3
	`, s.connectionID, s.JID, phone+":%")
	return err
}

// ===============================
// SessionStore Implementation
// ===============================

// GetSession retrieves a session.
func (s *PGSQLStore) GetSession(ctx context.Context, address string) ([]byte, error) {
	var session []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT session FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address).Scan(&session)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return session, err
}

// GetManySessions retrieves multiple sessions.
func (s *PGSQLStore) GetManySessions(ctx context.Context, addresses []string) (map[string][]byte, error) {
	result := make(map[string][]byte)
	if len(addresses) == 0 {
		return result, nil
	}

	// Build query with placeholders
	query := `SELECT their_id, session FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = ANY($3)`

	rows, err := s.db.QueryContext(ctx, query, s.connectionID, s.JID, pq.Array(addresses))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var theirID string
		var session []byte
		if err := rows.Scan(&theirID, &session); err != nil {
			return nil, err
		}
		result[theirID] = session
	}

	return result, rows.Err()
}

// HasSession checks if a session exists.
func (s *PGSQLStore) HasSession(ctx context.Context, address string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3)
	`, s.connectionID, s.JID, address).Scan(&exists)
	return exists, err
}

// PutSession stores a session.
func (s *PGSQLStore) PutSession(ctx context.Context, address string, session []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_sessions (connection_id, our_jid, their_id, session)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET session = EXCLUDED.session
	`, s.connectionID, s.JID, address, session)
	return err
}

// PutManySessions stores multiple sessions.
func (s *PGSQLStore) PutManySessions(ctx context.Context, sessions map[string][]byte) error {
	if len(sessions) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_sessions (connection_id, our_jid, their_id, session)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET session = EXCLUDED.session
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for address, session := range sessions {
		if _, err := stmt.ExecContext(ctx, s.connectionID, s.JID, address, session); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// DeleteSession removes a session.
func (s *PGSQLStore) DeleteSession(ctx context.Context, address string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address)
	return err
}

// DeleteAllSessions removes all sessions for a phone.
func (s *PGSQLStore) DeleteAllSessions(ctx context.Context, phone string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id LIKE $3
	`, s.connectionID, s.JID, phone+":%")
	return err
}

// MigratePNToLID migrates sessions from phone number to LID.
func (s *PGSQLStore) MigratePNToLID(ctx context.Context, pn, lid types.JID) error {
	pnUser := pn.User
	lidUser := lid.User

	// Migrate sessions
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_sessions (connection_id, our_jid, their_id, session)
		SELECT connection_id, our_jid, REPLACE(their_id, $2, $3), session
		FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $4 AND their_id LIKE $2 || ':%'
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET session = EXCLUDED.session
	`, s.connectionID, pnUser, lidUser, s.JID)

	return err
}
